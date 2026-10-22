import type { createAdminClient } from "@/lib/supabase/server";

// El producto o promo que ocupa el banner grande de la tienda (migración 121). El administrador lo elige
// desde Tenteo → Configuración ("el combo del día"); si no elige ninguno, el banner muestra lo más pedido.
// Lectura "mejor esfuerzo": sin la migración o si falla, no hay elegido y se usa lo automático.

type Admin = ReturnType<typeof createAdminClient>;

export type DestacadoOnline = { itemId: string | null; titulo: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_TITULO_DESTACADO = 40;

export function normalizarDestacado(itemId: unknown, titulo: unknown): DestacadoOnline {
  const id = typeof itemId === "string" && UUID.test(itemId) ? itemId.toLowerCase() : null;
  const texto = typeof titulo === "string" ? titulo.replace(/\s+/g, " ").trim().slice(0, MAX_TITULO_DESTACADO) : "";
  return { itemId: id, titulo: texto || null };
}

export async function leerDestacadoOnline(admin: Admin, sucursalId: string): Promise<DestacadoOnline> {
  try {
    const { data, error } = await (admin as any)
      .from("sucursales")
      .select("destacado_online_item_id, destacado_online_titulo")
      .eq("id", sucursalId)
      .single();
    if (error || !data) return { itemId: null, titulo: null };
    return normalizarDestacado(data.destacado_online_item_id, data.destacado_online_titulo);
  } catch {
    return { itemId: null, titulo: null };
  }
}

export type BannerResuelto = { itemId: string | null; kicker: string };

// Qué muestra el banner: lo que eligió el administrador (si hoy se puede pedir y tiene foto), si no lo
// más pedido, y si tampoco hay, el banner general sin producto.
export function resolverBanner(
  destacado: DestacadoOnline,
  masPedidos: string[],
  items: { id: string; image: string | null }[],
): BannerResuelto {
  const conFoto = new Set(items.filter((i) => i.image).map((i) => i.id));
  if (destacado.itemId && conFoto.has(destacado.itemId)) return { itemId: destacado.itemId, kicker: destacado.titulo ?? "Lo mejor de hoy" };
  const automatico = masPedidos.find((id) => conFoto.has(id));
  if (automatico) return { itemId: automatico, kicker: "Lo más pedido" };
  return { itemId: null, kicker: "" };
}
