import type { createAdminClient } from "@/lib/supabase/server";

// "Lo más pedido" de la tienda: lo que más se vendió en los últimos 60 días en esa sucursal (caja y
// pedidos online juntos), para mostrarlo primero. La cuenta la hace la base (función de la migración
// 120). Es "mejor esfuerzo": si la función no existe todavía o falla, simplemente no hay tira.
// Se guarda en memoria un rato para no consultar en cada visita.

type Admin = ReturnType<typeof createAdminClient>;

const VIGENCIA_MS = 30 * 60 * 1000;
const VIGENCIA_ERROR_MS = 2 * 60 * 1000;
const cache = new Map<string, { hasta: number; ids: string[] }>();

export async function leerMasPedidos(admin: Admin, sucursalId: string): Promise<string[]> {
  const guardado = cache.get(sucursalId);
  if (guardado && guardado.hasta > Date.now()) return guardado.ids;

  try {
    const { data, error } = await (admin as any).rpc("top_vendidos_sucursal", { p_sucursal: sucursalId, p_dias: 60, p_limite: 40 });
    if (error || !Array.isArray(data)) {
      cache.set(sucursalId, { hasta: Date.now() + VIGENCIA_ERROR_MS, ids: [] });
      return [];
    }
    const ids = (data as { clave: string }[]).map((r) => r.clave);
    cache.set(sucursalId, { hasta: Date.now() + VIGENCIA_MS, ids });
    return ids;
  } catch {
    cache.set(sucursalId, { hasta: Date.now() + VIGENCIA_ERROR_MS, ids: [] });
    return [];
  }
}

// De lo más vendido, lo que hoy se puede pedir (está en el catálogo) y tiene foto, que es lo que vende
// en una vidriera. Con pocos no vale la pena armar la tira.
export function elegirMasPedidos(ranking: string[], items: { id: string; image: string | null }[], maximo = 8, minimo = 4): string[] {
  const disponibles = new Map(items.map((i) => [i.id, i]));
  const elegidos: string[] = [];
  for (const id of ranking) {
    if (elegidos.length >= maximo) break;
    if (disponibles.get(id)?.image && !elegidos.includes(id)) elegidos.push(id);
  }
  return elegidos.length >= minimo ? elegidos : [];
}
