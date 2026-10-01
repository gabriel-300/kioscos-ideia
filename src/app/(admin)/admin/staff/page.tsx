import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { StaffList } from "./_components/staff-list";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import { esPersonal, sistemasDe, sistemasFijos, tieneSistemasGuardados, rolDe } from "@/lib/auth/acceso";

export const metadata: Metadata = { title: "Staff — Kioscos IDEIA" };
export const revalidate = 0;

export default async function StaffPage() {
  // Es la página más sensible del sistema (email/rol/límite de crédito de todo
  // el personal) -- antes dependía 100% de que el middleware la bloqueara, a
  // diferencia de cada otra página admin-only, que tiene su propio chequeo
  // como respaldo (ver auditoría 15/07).
  await requireAdmin();
  const admin   = createAdminClient();
  const supabase = await createClient();

  const [
    { data: { users }, error },
    { data: sucursales },
    profilesResult,
    profileSucursalesResult,
  ] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 200 }),
    // (as any): pedidos_online_habilitado no está en los tipos generados. Es solo para
    // avisar al asignar Tenteo a alguien de una sucursal con pedidos online apagado.
    (admin as any).from("sucursales").select("id, nombre, encargado_user_id, pedidos_online_habilitado").order("nombre") as unknown as Promise<{
      data: { id: string; nombre: string; encargado_user_id: string | null; pedidos_online_habilitado: boolean | null }[] | null;
    }>,
    (supabase as any)
      .from("profiles")
      .select("id, sucursal_id, credito_limite, es_socio") as unknown as Promise<{
        data: { id: string; sucursal_id: string | null; credito_limite: number | null; es_socio: boolean | null }[] | null;
      }>,
    (admin as any)
      .from("profile_sucursales")
      .select("profile_id, sucursal_id") as unknown as Promise<{
        data: { profile_id: string; sucursal_id: string }[] | null;
      }>,
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

  type ProfileEntry = { sucursalId: string | null; creditoLimite: number | null; esSocio: boolean };
  const profileMap: Record<string, ProfileEntry> = {};
  for (const p of profilesResult.data ?? []) {
    profileMap[p.id] = { sucursalId: p.sucursal_id, creditoLimite: p.credito_limite ?? null, esSocio: !!p.es_socio };
  }

  // Conjunto de sucursales donde cada vendedor está habilitado (distinto de
  // sucursalIdProfile, que es solo la sucursal ACTIVA ahora -- ver
  // migración 082 y sucursal-access.ts).
  const sucursalIdsVendedorMap: Record<string, string[]> = {};
  for (const ps of profileSucursalesResult.data ?? []) {
    (sucursalIdsVendedorMap[ps.profile_id] ??= []).push(ps.sucursal_id);
  }

  const staff = (users ?? [])
    .filter((u) => esPersonal(u))
    .sort((a, b) => {
      const order: Record<string, number> = { admin: 0, encargado: 1, concesionario: 2, vendedor: 3, repartidor: 4 };
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
      sucursalIdProfile: profileMap[u.id]?.sucursalId ?? null,
      sucursalIdsVendedor: sucursalIdsVendedorMap[u.id] ?? [],
      creditoLimite: profileMap[u.id]?.creditoLimite ?? null,
      esSocio: profileMap[u.id]?.esSocio ?? false,
      sistemas: sistemasDe(u),
      sistemasPorDefecto: !sistemasFijos(rolDe(u)) && !tieneSistemasGuardados(u),
      isSuspended:   !!(u as any).banned_until && (u as any).banned_until !== "none",
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
