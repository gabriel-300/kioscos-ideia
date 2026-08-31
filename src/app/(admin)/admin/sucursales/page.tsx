import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SucursalesList } from "./_components/sucursales-list";
import { SucursalesPickerList } from "./_components/sucursales-picker-list";

export const metadata: Metadata = { title: "Sucursales — Kioscos IDEIA" };
export const revalidate = 0;

export default async function SucursalesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;
  const admin = createAdminClient();

  // Un vendedor llega acá solo cuando tiene 2+ sucursales asignadas (ver
  // auth/redirect/page.tsx) -- SucursalesList es una pantalla de admin
  // completa (crear/editar/activar), nunca pensada para que la vea un
  // vendedor, así que se le muestra una vista de solo lectura aparte.
  if (role === "vendedor") {
    const { data: asignadas } = await (admin as any)
      .from("profile_sucursales")
      .select("sucursal:sucursales(id, nombre)")
      .eq("profile_id", user.id) as { data: { sucursal: { id: string; nombre: string } | null }[] | null };
    const sucursalesVendedor = (asignadas ?? [])
      .map((a) => a.sucursal)
      .filter((s): s is { id: string; nombre: string } => !!s)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

    return (
      <div className="p-4 md:p-8 max-w-5xl">
        <div className="mb-6">
          <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Tus sucursales</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Elegí dónde vas a trabajar hoy</p>
        </div>
        <SucursalesPickerList sucursales={sucursalesVendedor} />
      </div>
    );
  }

  const [{ data: sucursales }, { data: { users } }] = await Promise.all([
    supabase.from("sucursales").select("*").order("nombre"),
    admin.auth.admin.listUsers({ perPage: 200 }),
  ]);

  const encargadoUsers = (users ?? [])
    .filter((u) => u.app_metadata?.role === "encargado")
    .map((u) => ({
      id:     u.id,
      email:  u.email ?? "",
      nombre: (u.user_metadata?.full_name as string | null) ?? u.email ?? u.id,
    }));

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Sucursales</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Kioscos y puntos de reventa atendidos por IDEIA</p>
      </div>

      <SucursalesList sucursales={sucursales ?? []} encargadoUsers={encargadoUsers} />
    </div>
  );
}
