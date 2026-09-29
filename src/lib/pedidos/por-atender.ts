import type { createAdminClient } from "@/lib/supabase/server";

// Qué pedidos online esperan una acción del local y a qué sucursales puede
// mirar cada usuario. Lo comparten la pantalla de pedidos online y el aviso de
// pedido nuevo del menú, para que el contador y la lista digan lo mismo.
// Sin "use server": solo lo llaman Server Actions y páginas que ya validaron
// el rol.

type Admin = ReturnType<typeof createAdminClient>;

// Pedidos que entraron y el local todavía no aceptó: efectivo confirmado (se
// cobra en la puerta) y Mercado Pago ya pagado.
const ESTADOS_NUEVOS = ["confirmado", "pagado"];

export type PedidoParaContar = { estado: string; medio_pago: string | null; expira_en: string | null };

// Un pago por link solo importa mientras no venció: el local tiene que mandar
// el link y confirmar a mano cuando ve la plata. Vencido o con otro medio de
// pago (QR abandonado) es ruido.
export function pagoPorLinkVigente(p: PedidoParaContar, ahora = Date.now()): boolean {
  return p.estado === "pendiente_pago"
    && p.medio_pago === "mercadopago_link"
    && (!p.expira_en || new Date(p.expira_en).getTime() > ahora);
}

export function cuentaComoPorAtender(p: PedidoParaContar, ahora = Date.now()): boolean {
  return ESTADOS_NUEVOS.includes(p.estado) || pagoPorLinkVigente(p, ahora);
}

// null = todas las sucursales (admin). Lista vacía = el usuario no tiene ninguna
// asignada. Un vendedor puede estar en varias (profile_sucursales); la columna
// vieja profiles.sucursal_id se usa solo si todavía no tiene filas ahí.
export async function sucursalesVisibles(admin: Admin, userId: string, role: string): Promise<string[] | null> {
  if (role === "admin") return null;

  if (role === "encargado" || role === "concesionario") {
    const { data } = await admin.from("sucursales").select("id").eq("encargado_user_id", userId);
    return ((data ?? []) as { id: string }[]).map((s) => s.id);
  }

  if (role === "vendedor") {
    const { data: asignadas } = await (admin as any).from("profile_sucursales").select("sucursal_id").eq("profile_id", userId);
    const ids = ((asignadas ?? []) as { sucursal_id: string }[]).map((r) => r.sucursal_id);
    if (ids.length > 0) return ids;
    const { data: perfil } = await (admin as any).from("profiles").select("sucursal_id").eq("id", userId).single();
    return perfil?.sucursal_id ? [perfil.sucursal_id as string] : [];
  }

  return [];
}

export async function contarPedidosPorAtender(admin: Admin, userId: string, role: string): Promise<number> {
  const sucursales = await sucursalesVisibles(admin, userId, role);
  if (sucursales && sucursales.length === 0) return 0;

  let query = (admin as any)
    .from("pedidos")
    .select("estado, medio_pago, expira_en")
    .in("estado", [...ESTADOS_NUEVOS, "pendiente_pago"])
    .limit(500);
  if (sucursales) query = query.in("sucursal_id", sucursales);

  const { data } = await query;
  const ahora = Date.now();
  return ((data ?? []) as PedidoParaContar[]).filter((p) => cuentaComoPorAtender(p, ahora)).length;
}
