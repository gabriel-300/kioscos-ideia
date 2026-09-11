import type { createAdminClient } from "@/lib/supabase/server";

// Consolidado desde 3 formas distintas del mismo chequeo que había
// repetidas por el código (una copia local en nichos/actions.ts que
// bloqueaba vendedor entero, dos copias byte-idénticas de
// checkAccesoSucursal en termos/actions.ts y
// sucursales/[id]/mercadopago-actions.ts, y ~9 inlines sin función local).
// No lleva "use server" -- solo se llama desde otros módulos server-side,
// nunca se invoca directo desde el cliente, así que no hace falta que el
// cliente admin que recibe como parámetro sea serializable.
export async function requireSucursalAccess(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  role: string,
  sucursalId: string
): Promise<string | null> {
  // "concesionario" (Encargado Concesionario -- dueño económico de UNA sola
  // sucursal a cambio de un % de lo que vende, ver conversación con Gabriel
  // set. 2026) se scopea con el mismo mecanismo que encargado: la persona
  // asignada en sucursales.encargado_user_id. La diferencia entre los dos
  // roles no vive acá -- vive en qué páginas/acciones lo dejan entrar
  // (concesionario tiene bastante más, ver costo/margen y los informes de
  // su propia sucursal).
  if (role === "encargado" || role === "concesionario") {
    const { data: suc } = await admin.from("sucursales").select("encargado_user_id").eq("id", sucursalId).single();
    if (suc?.encargado_user_id !== userId) return "No tenés permisos para esta sucursal";
  }
  if (role === "vendedor") {
    const { data } = await (admin as any)
      .from("profile_sucursales").select("id").eq("profile_id", userId).eq("sucursal_id", sucursalId).maybeSingle();
    if (!data) return "No tenés permisos para esta sucursal";
  }
  return null;
}

// Resuelve la ÚNICA sucursal de un concesionario (misma columna
// encargado_user_id que usa un encargado normal) -- lo usan las páginas de
// informes que hoy dejan a admin elegir sucursal por query param, para
// forzar el filtro a la suya en vez de confiar en lo que llegue en la URL.
export async function resolverSucursalConcesionario(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<string | null> {
  const { data } = await admin.from("sucursales").select("id").eq("encargado_user_id", userId).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
