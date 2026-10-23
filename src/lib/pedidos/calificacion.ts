import type { createAdminClient } from "@/lib/supabase/server";

// Calificación del cliente al recibir su pedido (migración 126). Sin "use server": la llama una Server Action
// que ya recibió los ids; acá se decide qué se acepta. Tolerante a que la migración no esté aplicada: leer
// devuelve "sin calificación" y guardar avisa que falta aplicarla.

type Admin = ReturnType<typeof createAdminClient>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_COMENTARIO = 500;

export type Calificacion = { estrellas: number; comentario: string | null };

// Estrellas enteras de 1 a 5; el comentario es opcional, sin caracteres de control y de hasta 500 letras.
export function normalizarCalificacion(estrellas: unknown, comentario: unknown): { calificacion?: Calificacion; error?: string } {
  if (typeof estrellas !== "number" || !Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) {
    return { error: "Elegí de 1 a 5 estrellas" };
  }
  let texto: string | null = null;
  if (comentario != null && comentario !== "") {
    if (typeof comentario !== "string") return { error: "El comentario no es válido" };
    texto = comentario
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || null;
    if (texto && texto.length > MAX_COMENTARIO) return { error: `El comentario es muy largo (máximo ${MAX_COMENTARIO} letras)` };
  }
  return { calificacion: { estrellas, comentario: texto } };
}

// La calificación ya dejada para ese pedido (null si no hay o si la tabla todavía no existe).
export async function leerCalificacion(admin: Admin, pedidoId: string): Promise<Calificacion | null> {
  const { data, error } = await (admin as any)
    .from("pedido_calificaciones").select("estrellas, comentario").eq("pedido_id", pedidoId).maybeSingle();
  if (error || !data) return null;
  return { estrellas: data.estrellas, comentario: data.comentario ?? null };
}

// Calificaciones de varios pedidos (para la lista del personal). Vacío si la tabla todavía no existe.
export async function calificacionesPorPedido(admin: Admin, pedidoIds: string[]): Promise<Map<string, Calificacion>> {
  const mapa = new Map<string, Calificacion>();
  if (pedidoIds.length === 0) return mapa;
  const { data, error } = await (admin as any)
    .from("pedido_calificaciones").select("pedido_id, estrellas, comentario").in("pedido_id", pedidoIds);
  if (error) return mapa;
  for (const f of (data ?? []) as { pedido_id: string; estrellas: number; comentario: string | null }[]) {
    mapa.set(f.pedido_id, { estrellas: f.estrellas, comentario: f.comentario ?? null });
  }
  return mapa;
}

// El cliente califica SU pedido: el id del pedido (uuid aleatorio) más el de la sucursal hacen de enlace secreto,
// igual que la página de seguimiento. Solo con el pedido entregado y una sola vez.
export async function guardarCalificacion(
  admin: Admin,
  p: { sucursalId: string; pedidoId: string; estrellas: unknown; comentario: unknown },
): Promise<{ error?: string }> {
  if (!UUID.test(p.pedidoId) || !UUID.test(p.sucursalId)) return { error: "No se encontró el pedido" };
  const { calificacion, error: errNorm } = normalizarCalificacion(p.estrellas, p.comentario);
  if (!calificacion) return { error: errNorm };

  const { data: pedido } = await (admin as any)
    .from("pedidos").select("id, estado").eq("id", p.pedidoId).eq("sucursal_id", p.sucursalId).maybeSingle();
  if (!pedido) return { error: "No se encontró el pedido" };
  if (pedido.estado !== "entregado") return { error: "Podés calificar el pedido cuando lo recibas" };

  const { error } = await (admin as any).from("pedido_calificaciones").insert({
    pedido_id: p.pedidoId, estrellas: calificacion.estrellas, comentario: calificacion.comentario,
  });
  if (error) {
    if (error.code === "23505") return { error: "Ya calificaste este pedido. ¡Gracias!" };
    return { error: /pedido_calificaciones/.test(error.message ?? "") ? "Falta aplicar la migración 126 en la base" : "No se pudo guardar tu calificación" };
  }
  return {};
}
