import { describe, it, expect } from "vitest";
import { fetchAll } from "@/lib/supabase/paginar";

// Doble de una consulta PostgREST: devuelve como máximo 1.000 filas por
// petición (el "max rows" de Supabase) sobre una tabla de `total` filas.
function tabla(total: number, opts: { conCount?: boolean; falla?: number } = {}) {
  const pedidos: [number, number][] = [];
  const consulta = async (desde: number, hasta: number) => {
    pedidos.push([desde, hasta]);
    if (opts.falla !== undefined && desde === opts.falla * 1000) return { data: null, error: { message: "boom" } };
    const fin = Math.min(hasta, desde + 999, total - 1); // el servidor recorta a 1.000
    const data = Array.from({ length: Math.max(0, fin - desde + 1) }, (_, i) => ({ id: desde + i }));
    return { data, error: null, count: opts.conCount ? total : undefined };
  };
  return { consulta, pedidos };
}

describe("fetchAll (tope de 1.000 filas de PostgREST)", () => {
  it.each([0, 1, 999, 1000, 1001, 2649, 3500, 5057])("trae las %i filas completas, sin repetir ni saltear (sin count)", async (n) => {
    const { consulta } = tabla(n);
    const filas = await fetchAll(consulta);
    expect(filas).toHaveLength(n);
    expect(filas.map((f: any) => f.id)).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it.each([1001, 2649, 5057, 15829])("con count exacto trae las %i filas y en el orden correcto (páginas en paralelo)", async (n) => {
    const { consulta } = tabla(n, { conCount: true });
    const filas = await fetchAll(consulta);
    expect(filas).toHaveLength(n);
    expect(filas.map((f: any) => f.id)).toEqual(Array.from({ length: n }, (_, i) => i));
  });

  it("no hace peticiones de más cuando el total es múltiplo exacto con count", async () => {
    const { consulta, pedidos } = tabla(2000, { conCount: true });
    await fetchAll(consulta);
    expect(pedidos).toHaveLength(2);
  });

  it("un error en cualquier página se propaga (nunca devuelve datos truncados)", async () => {
    await expect(fetchAll(tabla(3500, { falla: 2 }).consulta)).rejects.toThrow("boom");
    await expect(fetchAll(tabla(3500, { falla: 2, conCount: true }).consulta)).rejects.toThrow("boom");
  });

  it("el tope de páginas evita un bucle infinito", async () => {
    await expect(fetchAll(tabla(50_000).consulta, 1000, 5)).rejects.toThrow(/otro enfoque|tope/);
  });
});
