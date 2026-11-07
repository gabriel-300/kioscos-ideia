import type { createAdminClient } from "@/lib/supabase/server";

// Un local independiente (sucursales.catalogo_propio, migración 131) es de otra persona: no paga a IDEIA y su caja,
// sus ventas y su stock NO se mezclan con los de los kioscos de IDEIA. Los administradores de IDEIA ven sus informes
// y su Tesorería SIN esas sucursales; el dueño, en cambio, sigue viendo la suya (ahí `ids` queda vacío).

type Admin = ReturnType<typeof createAdminClient>;

/** Ids de los locales independientes que hay que dejar afuera para este rol (solo el admin; para el resto, vacío). */
export async function independientesParaAdmin(admin: Admin, role: string | undefined): Promise<string[]> {
  if (role !== "admin") return [];
  const { data } = await (admin as any).from("sucursales").select("id").eq("catalogo_propio", true);
  return ((data ?? []) as { id: string }[]).map((s) => s.id);
}

/** Saca de una consulta (PostgREST) las filas de esas sucursales. Las filas sin sucursal (null) también se descartan. */
export function sinIndependientes<Q>(consulta: Q, ids: string[], columna = "sucursal_id"): Q {
  if (ids.length === 0) return consulta;
  return (consulta as any).not(columna, "in", `(${ids.join(",")})`) as Q;
}

/** Saca de una lista de sucursales las independientes. */
export function sinIndependientesLista<T extends { id: string }>(lista: T[] | null | undefined, ids: string[]): T[] {
  return (lista ?? []).filter((s) => !ids.includes(s.id));
}
