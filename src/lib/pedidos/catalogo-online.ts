import type { createAdminClient } from "@/lib/supabase/server";

// Qué productos y promos esconde cada sucursal de sus pedidos online (migración 119). El kiosco
// no se entera: solo cambia lo que ve el cliente en la tienda y en el bot.
//
// La lectura es "mejor esfuerzo" a propósito: si las columnas todavía no existen (migración sin
// aplicar) o la consulta falla, devuelve listas vacías y la tienda sigue ofreciendo todo lo que
// tiene stock, como antes -- nunca se cae por esto.

type Admin = ReturnType<typeof createAdminClient>;

export type OcultosOnline = { productos: string[]; promos: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_OCULTOS = 2000;

// Lo que llega del navegador o de la base: solo ids válidos, sin repetir.
export function normalizarOcultos(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((i): i is string => typeof i === "string" && UUID.test(i)).map((i) => i.toLowerCase()))].slice(0, MAX_OCULTOS);
}

export async function leerOcultosOnline(admin: Admin, sucursalId: string): Promise<OcultosOnline> {
  try {
    const { data, error } = await (admin as any)
      .from("sucursales")
      .select("productos_ocultos_online, promos_ocultas_online")
      .eq("id", sucursalId)
      .single();
    if (error || !data) return { productos: [], promos: [] };
    return { productos: normalizarOcultos(data.productos_ocultos_online), promos: normalizarOcultos(data.promos_ocultas_online) };
  } catch {
    return { productos: [], promos: [] };
  }
}
