import type { createAdminClient } from "@/lib/supabase/server";
import { redondearDestino, segundosDesde, frescuraPosicion, validarPosicion } from "./posicion-repartidor";

// Ubicación en vivo del repartidor, lado servidor. Sin "use server": no son endpoints, las llaman las Server
// Actions de posicion-actions.ts (que antes hacen su chequeo de rol) y la pantalla del personal. Reciben el
// cliente admin por parámetro (la tabla no se toca desde el navegador: RLS sin policies, migración 125).

type Admin = ReturnType<typeof createAdminClient>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PEDIDOS_POR_ENVIO = 20;

// El repartidor manda SU posición. Va a los pedidos que se le pasan (los que ve en pantalla), pero solo se
// guarda en los que de verdad son suyos Y siguen en reparto: no se puede escribir la posición de un pedido
// ajeno, ni de uno ya entregado/cancelado. Un admin tampoco escribe en pedidos de otro repartidor.
export async function guardarPosicion(
  admin: Admin,
  args: { userId: string; pedidoIds: unknown; lat: unknown; lng: unknown; precision?: unknown; ahora?: Date },
): Promise<{ error?: string; pedidos?: number }> {
  const v = validarPosicion(args.lat, args.lng, args.precision);
  if ("error" in v) return { error: v.error };

  const ids = Array.isArray(args.pedidoIds)
    ? [...new Set(args.pedidoIds.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, MAX_PEDIDOS_POR_ENVIO)
    : [];
  if (ids.length === 0) return { error: "No hay entregas para compartir" };

  const { data } = await (admin as any).from("pedidos").select("id, estado, repartidor_id").in("id", ids);
  const propios = ((data ?? []) as { id: string; estado: string; repartidor_id: string | null }[])
    .filter((p) => ids.includes(p.id) && p.estado === "en_reparto" && p.repartidor_id === args.userId);
  if (propios.length === 0) return { error: "No tenés entregas en reparto para compartir la ubicación" };

  const actualizado_en = (args.ahora ?? new Date()).toISOString();
  const filas = propios.map((p) => ({ pedido_id: p.id, repartidor_id: args.userId, ...v.valor, actualizado_en }));
  const { error } = await (admin as any).from("repartidor_posiciones").upsert(filas, { onConflict: "pedido_id" });
  if (error) return { error: "No se pudo guardar la ubicación" };
  return { pedidos: propios.length };
}

// El repartidor apaga "Compartir mi ubicación": se borra lo que había guardado de él.
export async function borrarPosicionesDe(admin: Admin, userId: string): Promise<{ error?: string }> {
  const { error } = await (admin as any).from("repartidor_posiciones").delete().eq("repartidor_id", userId);
  return error ? { error: "No se pudo apagar" } : {};
}

export type PosicionParaCliente =
  | { estado: "no_aplica" }                      // el pedido no existe o no está en reparto: no se muestra nada
  | { estado: "sin_posicion" }                   // en reparto, pero el repartidor todavía no compartió
  | { estado: "vieja"; haceSeg: number }         // compartió hace más de POSICION_VIEJA_SEG: no se muestra el punto
  | { estado: "vigente"; haceSeg: number; repartidor: { lat: number; lng: number }; destino: { lat: number; lng: number } | null };

// Lo que ve el CLIENTE. Se identifica igual que la página de seguimiento: el id del pedido (uuid aleatorio,
// solo lo conoce quien lo hizo) más la sucursal. Solo se lee la posición DE ESE pedido y solo si sigue en
// reparto; no se devuelve nada del repartidor (ni nombre ni teléfono), y el punto de entrega va redondeado.
export async function posicionParaCliente(admin: Admin, sucursalId: string, pedidoId: string, ahora: Date = new Date()): Promise<PosicionParaCliente> {
  if (!UUID.test(sucursalId) || !UUID.test(pedidoId)) return { estado: "no_aplica" };

  const { data: pedido } = await (admin as any)
    .from("pedidos")
    .select("id, estado, tipo_entrega, entrega_latitud, entrega_longitud")
    .eq("id", pedidoId)
    .eq("sucursal_id", sucursalId)
    .maybeSingle();
  if (!pedido || pedido.estado !== "en_reparto") return { estado: "no_aplica" };

  const { data: pos } = await (admin as any)
    .from("repartidor_posiciones")
    .select("latitud, longitud, actualizado_en")
    .eq("pedido_id", pedidoId)
    .maybeSingle();
  if (!pos) return { estado: "sin_posicion" };

  const haceSeg = segundosDesde(pos.actualizado_en, ahora);
  if (frescuraPosicion(haceSeg) === "vieja") return { estado: "vieja", haceSeg };

  const dLat = pedido.entrega_latitud != null ? Number(pedido.entrega_latitud) : NaN;
  const dLng = pedido.entrega_longitud != null ? Number(pedido.entrega_longitud) : NaN;
  return {
    estado: "vigente",
    haceSeg,
    repartidor: { lat: Number(pos.latitud), lng: Number(pos.longitud) },
    destino: Number.isFinite(dLat) && Number.isFinite(dLng) ? { lat: redondearDestino(dLat), lng: redondearDestino(dLng) } : null,
  };
}

export type PosicionParaPersonal = { lat: number; lng: number; haceSeg: number; vieja: boolean } | null;

// Lo que ve el PERSONAL en /tenteo/pedidos. No chequea acceso acá: solo se llama desde pedidos ya cargados
// por la página del personal, que filtra por las sucursales de quien mira. Solo si el pedido sigue en reparto.
export async function posicionParaPersonal(admin: Admin, pedidoId: string, ahora: Date = new Date()): Promise<PosicionParaPersonal> {
  if (!UUID.test(pedidoId)) return null;
  const { data: pedido } = await (admin as any).from("pedidos").select("id, estado").eq("id", pedidoId).maybeSingle();
  if (!pedido || pedido.estado !== "en_reparto") return null;
  const { data: pos } = await (admin as any).from("repartidor_posiciones").select("latitud, longitud, actualizado_en").eq("pedido_id", pedidoId).maybeSingle();
  if (!pos) return null;
  const haceSeg = segundosDesde(pos.actualizado_en, ahora);
  return { lat: Number(pos.latitud), lng: Number(pos.longitud), haceSeg, vieja: frescuraPosicion(haceSeg) === "vieja" };
}
