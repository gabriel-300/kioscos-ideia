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
  if (role === "encargado") {
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
