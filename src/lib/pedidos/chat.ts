import type { createAdminClient } from "@/lib/supabase/server";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";
import { puedeRepartir } from "@/lib/auth/acceso";

// Chat interno de un pedido online (migración 124): un solo hilo por pedido, con la etiqueta de quien
// escribió. Sin "use server": solo lo llaman Server Actions que ya identificaron a la persona; acá se
// decide qué puede ver y escribir cada una, siempre en el servidor.
//
// Quién entra:
//  - cliente: conoce el id (uuid aleatorio) del pedido, igual que la página de seguimiento. No hay otra
//    credencial (el cliente puede no tener cuenta); por eso solo ve el hilo de ese pedido, nunca datos de
//    otros, y escribir tiene límites (largo, ritmo, tope por pedido).
//  - personal: de las sucursales a las que tiene acceso.
//  - repartidor: solo de pedidos que tiene asignados y mientras están en_reparto (lectura y escritura).
// Con el pedido entregado o cancelado el hilo queda en solo lectura.

type Admin = ReturnType<typeof createAdminClient>;

export type AutorChat = "cliente" | "local" | "repartidor";
export type ActorChat =
  | { tipo: "cliente" }
  | { tipo: "personal"; userId: string; role: string }
  | { tipo: "repartidor"; userId: string; role: string }; // role "admin" = supervisa desde Mis entregas

export const MAX_TEXTO = 500;
export const MAX_MENSAJES_POR_PEDIDO = 300;
export const VENTANA_RITMO_MS = 60_000;
export const MAX_POR_VENTANA = 6; // mensajes de un mismo lado en un minuto

const ESTADOS_ABIERTOS = ["pendiente_pago", "confirmado", "pagado", "en_preparacion", "listo_retiro", "en_reparto"];
const ESTADOS_SOLO_LECTURA = ["entregado", "cancelado"];

export type MensajeChat = { id: string; autor: AutorChat; texto: string; creado: string; propio: boolean };
export type EstadoChat = {
  mensajes: MensajeChat[];
  puedeEscribir: boolean;
  aviso: string | null; // por qué no se puede escribir (solo si puedeEscribir es false)
  sinLeer: number;
};

type PedidoChat = { id: string; sucursal_id: string; estado: string; repartidor_id: string | null };

// Limpia lo que escribe la persona: sin caracteres de control, saltos de línea normalizados, sin más de
// una línea en blanco seguida. React escapa al mostrar, esto es solo para que no entre basura.
export function normalizarTexto(crudo: unknown): { texto?: string; error?: string } {
  if (typeof crudo !== "string") return { error: "Escribí un mensaje" };
  const texto = crudo
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!texto) return { error: "Escribí un mensaje" };
  if (texto.length > MAX_TEXTO) return { error: `El mensaje es muy largo (máximo ${MAX_TEXTO} letras)` };
  return { texto };
}

// Qué lado es el actor y si puede leer / escribir ese pedido ahora. `error` = no entra.
export async function autorizarChat(
  admin: Admin,
  actor: ActorChat,
  pedido: PedidoChat | null,
): Promise<{ error: string } | { lado: AutorChat; escribir: boolean; aviso: string | null }> {
  if (!pedido || pedido.estado === "carrito") return { error: "No se encontró el pedido" };

  let lado: AutorChat;
  if (actor.tipo === "cliente") {
    lado = "cliente";
  } else if (actor.tipo === "personal") {
    const err = await requireSucursalAccess(admin, actor.userId, actor.role, pedido.sucursal_id);
    if (err) return { error: err };
    lado = "local";
  } else {
    if (actor.role !== "admin" && !puedeRepartir(actor.role)) return { error: "Sin permisos" };
    if (actor.role !== "admin" && pedido.repartidor_id !== actor.userId) return { error: "Este pedido no es tuyo" };
    if (pedido.estado !== "en_reparto") return { error: "El chat con el repartidor solo está disponible mientras el pedido está en reparto" };
    lado = actor.role === "admin" ? "local" : "repartidor";
  }

  if (ESTADOS_ABIERTOS.includes(pedido.estado)) return { lado, escribir: true, aviso: null };
  if (ESTADOS_SOLO_LECTURA.includes(pedido.estado)) {
    return { lado, escribir: false, aviso: "El pedido ya terminó: el chat queda solo para consultar." };
  }
  return { lado, escribir: false, aviso: "Este pedido venció: ya no se puede escribir." };
}

async function leerPedido(admin: Admin, pedidoId: string): Promise<PedidoChat | null> {
  const { data } = await (admin as any)
    .from("pedidos").select("id, sucursal_id, estado, repartidor_id").eq("id", pedidoId).maybeSingle();
  return (data as PedidoChat | null) ?? null;
}

// Hilo del pedido para esa persona. Con marcarLeidos, lo que escribió el otro lado queda como leído.
export async function leerChat(
  admin: Admin,
  actor: ActorChat,
  pedidoId: string,
  { marcarLeidos = true }: { marcarLeidos?: boolean } = {},
): Promise<EstadoChat | { error: string }> {
  const pedido = await leerPedido(admin, pedidoId);
  const auth = await autorizarChat(admin, actor, pedido);
  if ("error" in auth) return auth;

  const { data } = await (admin as any)
    .from("pedido_mensajes")
    .select("id, autor, texto, created_at, leido_por")
    .eq("pedido_id", pedidoId)
    .order("created_at", { ascending: true })
    .limit(MAX_MENSAJES_POR_PEDIDO);
  const filas = (data ?? []) as { id: string; autor: AutorChat; texto: string; created_at: string; leido_por: string[] | null }[];

  const sinLeer = filas.filter((f) => f.autor !== auth.lado && !(f.leido_por ?? []).includes(auth.lado)).length;
  if (marcarLeidos && sinLeer > 0) {
    await (admin as any).rpc("chat_marcar_leidos", { p_pedido: pedidoId, p_lector: auth.lado });
  }

  return {
    mensajes: filas.map((f) => ({ id: f.id, autor: f.autor, texto: f.texto, creado: f.created_at, propio: f.autor === auth.lado })),
    puedeEscribir: auth.escribir,
    aviso: auth.aviso,
    sinLeer: marcarLeidos ? 0 : sinLeer,
  };
}

export async function escribirEnChat(
  admin: Admin,
  actor: ActorChat,
  pedidoId: string,
  textoCrudo: unknown,
): Promise<{ error?: string }> {
  const { texto, error: errTexto } = normalizarTexto(textoCrudo);
  if (!texto) return { error: errTexto };

  const pedido = await leerPedido(admin, pedidoId);
  const auth = await autorizarChat(admin, actor, pedido);
  if ("error" in auth) return auth;
  if (!auth.escribir) return { error: auth.aviso ?? "No se puede escribir en este pedido" };

  // Tope por pedido y ritmo por lado (contra spam), contados en la propia tabla de mensajes.
  const { count: total } = await (admin as any)
    .from("pedido_mensajes").select("id", { count: "exact", head: true }).eq("pedido_id", pedidoId);
  if ((total ?? 0) >= MAX_MENSAJES_POR_PEDIDO) return { error: "Este chat llegó al máximo de mensajes" };

  const desde = new Date(Date.now() - VENTANA_RITMO_MS).toISOString();
  const { count: recientes } = await (admin as any)
    .from("pedido_mensajes").select("id", { count: "exact", head: true })
    .eq("pedido_id", pedidoId).eq("autor", auth.lado).gte("created_at", desde);
  if ((recientes ?? 0) >= MAX_POR_VENTANA) return { error: "Estás escribiendo muy rápido, esperá un momento" };

  const { error } = await (admin as any).from("pedido_mensajes").insert({
    pedido_id: pedidoId,
    autor: auth.lado,
    user_id: actor.tipo === "cliente" ? null : actor.userId,
    texto,
  });
  if (error) {
    return { error: /pedido_mensajes/.test(error.message ?? "") ? "Falta aplicar la migración 124 en la base" : "No se pudo enviar el mensaje" };
  }
  return {};
}

// Mensajes sin leer del personal, por pedido (para el indicador de la lista). Cuenta lo que escribieron
// el cliente o el repartidor y el local todavía no leyó. Solo se pide para pedidos que el usuario ya ve.
// Si la tabla todavía no existe (migración sin aplicar) devuelve vacío: la lista sigue andando.
export async function sinLeerPorPedido(admin: Admin, pedidoIds: string[], lector: AutorChat = "local"): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  if (pedidoIds.length === 0) return mapa;
  const { data } = await (admin as any)
    .from("pedido_mensajes")
    .select("pedido_id, leido_por")
    .in("pedido_id", pedidoIds)
    .neq("autor", lector)
    .limit(5000);
  for (const f of (data ?? []) as { pedido_id: string; leido_por: string[] | null }[]) {
    if ((f.leido_por ?? []).includes(lector)) continue;
    mapa.set(f.pedido_id, (mapa.get(f.pedido_id) ?? 0) + 1);
  }
  return mapa;
}
