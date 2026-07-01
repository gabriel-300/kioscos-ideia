import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { StaffList } from "./_components/staff-list";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Staff — Kioscos IDEIA" };
export const revalidate = 0;

export default async function StaffPage() {
  const admin   = createAdminClient();
  const supabase = await createClient();

  const [
    { data: { users }, error },
    { data: sucursales },
    profilesResult,
  ] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 200 }),
    supabase.from("sucursales").select("id, nombre, encargado_user_id").order("nombre"),
    (supabase as any)
      .from("profiles")
      .select("id, sucursal_id") as unknown as Promise<{ data: { id: string; sucursal_id: string | null }[] | null }>,
  ]);

  if (error) {
    return (
      <div className="p-4 md:p-8 max-w-3xl">
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          Error al cargar usuarios: {error.message}
        </div>
      </div>
    );
  }

  const profileMap: Record<string, string | null> = {};
  for (const p of profilesResult.data ?? []) profileMap[p.id] = p.sucursal_id;

  const staff = (users ?? [])
    .filter((u) => {
      const role = u.app_metadata?.role as string | undefined;
      return role === "admin" || role === "encargado" || role === "vendedor";
    })
    .sort((a, b) => {
      const order: Record<string, number> = { admin: 0, encargado: 1, vendedor: 2 };
      const ra = (a.app_metadata?.role as string) ?? "";
      const rb = (b.app_metadata?.role as string) ?? "";
      if (order[ra] !== order[rb]) return (order[ra] ?? 9) - (order[rb] ?? 9);
      return (a.email ?? "").localeCompare(b.email ?? "");
    })
    .map((u) => ({
      id:            u.id,
      email:         u.email,
      nombre:        u.user_metadata?.full_name as string | undefined,
      role:          u.app_metadata?.role as string | undefined,
      sucursalIdProfile: profileMap[u.id] ?? null,
      lastSignIn:    u.last_sign_in_at
        ? new Date(u.last_sign_in_at).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })
        : null,
    }));

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Staff</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Usuarios con acceso al panel de administración</p>
      </div>

      <StaffList staff={staff} sucursales={sucursales ?? []} />
    </div>
  );
}
