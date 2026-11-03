import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { sucursalConCatalogoPropio } from "@/lib/auth/catalogo-propio";
import { PersonalLocal, type VendedorFila } from "./_components/personal-local";

export const metadata: Metadata = { title: "Mi personal — Kioscos IDEIA" };
export const revalidate = 0;

export default async function MiPersonalPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  const role = user.app_metadata?.role as string | undefined;
  // Respaldo del middleware: solo el dueño de un local con catálogo propio (migración 131).
  const sucursalId = role === "concesionario" ? await sucursalConCatalogoPropio(user.id) : null;
  if (!sucursalId) redirect("/admin/dashboard");

  const admin = createAdminClient();
  const { data: filas } = await (admin as any)
    .from("profile_sucursales").select("profile_id, sucursal_id");
  const porPersona = new Map<string, string[]>();
  for (const f of (filas ?? []) as { profile_id: string; sucursal_id: string }[]) {
    porPersona.set(f.profile_id, [...(porPersona.get(f.profile_id) ?? []), f.sucursal_id]);
  }
  // Solo quienes trabajan únicamente en este local (los habilitados también en otros kioscos son de IDEIA).
  const propios = [...porPersona.entries()].filter(([, s]) => s.length > 0 && s.every((id) => id === sucursalId)).map(([id]) => id);

  const vendedores: VendedorFila[] = [];
  for (const id of propios) {
    const { data } = await admin.auth.admin.getUserById(id);
    const u = data?.user;
    if (!u || u.app_metadata?.role !== "vendedor") continue;
    vendedores.push({
      id,
      nombre: (u.user_metadata?.full_name as string | undefined) ?? "(sin nombre)",
      email: u.email ?? "",
      suspendido: !!(u as { banned_until?: string | null }).banned_until && new Date((u as { banned_until: string }).banned_until) > new Date(),
    });
  }
  vendedores.sort((a, b) => a.nombre.localeCompare(b.nombre));

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Mi personal</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Vendedores de tu local. Podés darlos de alta, suspenderlos y cambiarles la contraseña.</p>
      </div>
      <PersonalLocal vendedores={vendedores} />
    </div>
  );
}
