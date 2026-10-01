import type { createAdminClient } from "@/lib/supabase/server";
import { puertoKiosco } from "@/lib/tenteo/puerto-kiosco";

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
// asignada. Qué sucursales tiene cada persona lo sabe el kiosco: se pregunta por el puerto.
export function sucursalesVisibles(admin: Admin, userId: string, role: string): Promise<string[] | null> {
  return puertoKiosco(admin).sucursalesDelUsuario(userId, role);
}

// El aviso consulta cada pocos segundos desde cada pestaña abierta; las sucursales
// de una persona casi nunca cambian, así que se recuerdan un rato (por instancia del
// servidor) para no repetir 2-3 consultas por ciclo. Si le cambian los permisos, el
// contador se ajusta en a lo sumo este tiempo. La pantalla de pedidos NO usa este
// caché: sigue leyendo los permisos reales.
const VIDA_SUCURSALES_MS = 90_000;
const sucursalesRecordadas = new Map<string, { hasta: number; ids: string[] | null }>();

async function sucursalesParaAviso(admin: Admin, userId: string, role: string): Promise<string[] | null> {
  const clave = `${userId}:${role}`;
  const ahora = Date.now();
  const guardado = sucursalesRecordadas.get(clave);
  if (guardado && guardado.hasta > ahora) return guardado.ids;

  const ids = await sucursalesVisibles(admin, userId, role);
  if (sucursalesRecordadas.size > 200) sucursalesRecordadas.clear();
  sucursalesRecordadas.set(clave, { hasta: ahora + VIDA_SUCURSALES_MS, ids });
  return ids;
}

export async function contarPedidosPorAtender(admin: Admin, userId: string, role: string): Promise<number> {
  const sucursales = await sucursalesParaAviso(admin, userId, role);
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
