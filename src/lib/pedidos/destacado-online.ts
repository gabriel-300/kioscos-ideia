import type { createAdminClient } from "@/lib/supabase/server";

// Los banners grandes de la tienda (migración 121): hasta 3 productos o promos con foto que rotan arriba, como
// los de Rappi. El administrador los elige desde Tenteo → Configuración ("el combo del día"); si no elige
// ninguno, rotan lo más pedido. Lectura "mejor esfuerzo": sin la migración o si falla, no hay elegidos y se
// usa lo automático.

type Admin = ReturnType<typeof createAdminClient>;

export type DestacadoOnline = { itemId: string; titulo: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_TITULO_DESTACADO = 40;
export const MAX_BANNERS = 3;

// Lo que llega del navegador o de la base: solo ids válidos, sin repetir, hasta 3, con el título limpio.
export function normalizarDestacados(crudo: unknown): DestacadoOnline[] {
  if (!Array.isArray(crudo)) return [];
  const vistos = new Set<string>();
  const salida: DestacadoOnline[] = [];
  for (const d of crudo) {
    const itemId = d && typeof d === "object" ? (d as { itemId?: unknown; item_id?: unknown }).itemId ?? (d as { item_id?: unknown }).item_id : null;
    const titulo = d && typeof d === "object" ? (d as { titulo?: unknown }).titulo : null;
    if (typeof itemId !== "string" || !UUID.test(itemId)) continue;
    const id = itemId.toLowerCase();
    if (vistos.has(id)) continue;
    vistos.add(id);
    const texto = typeof titulo === "string" ? titulo.replace(/\s+/g, " ").trim().slice(0, MAX_TITULO_DESTACADO) : "";
    salida.push({ itemId: id, titulo: texto || null });
    if (salida.length >= MAX_BANNERS) break;
  }
  return salida;
}

export async function leerDestacadosOnline(admin: Admin, sucursalId: string): Promise<DestacadoOnline[]> {
  try {
    const { data, error } = await (admin as any).from("sucursales").select("destacados_online").eq("id", sucursalId).single();
    if (error || !data) return [];
    return normalizarDestacados(data.destacados_online);
  } catch {
    return [];
  }
}

export type BannerResuelto = { itemId: string | null; kicker: string };

// Qué rota arriba: lo que eligió el administrador (lo que hoy se puede pedir y tiene foto, en ese orden);
// si no hay nada elegido, lo más pedido (hasta 3); y si tampoco hay, un banner general sin producto.
export function resolverBanners(
  destacados: DestacadoOnline[],
  masPedidos: string[],
  items: { id: string; image: string | null }[],
): BannerResuelto[] {
  const conFoto = new Set(items.filter((i) => i.image).map((i) => i.id));

  const elegidos = destacados.filter((d) => conFoto.has(d.itemId)).map((d): BannerResuelto => ({ itemId: d.itemId, kicker: d.titulo ?? "Lo mejor de hoy" }));
  if (elegidos.length > 0) return elegidos;

  const automaticos = masPedidos.filter((id) => conFoto.has(id)).slice(0, MAX_BANNERS).map((id): BannerResuelto => ({ itemId: id, kicker: "Lo más pedido" }));
  if (automaticos.length > 0) return automaticos;

  return [{ itemId: null, kicker: "" }];
}
