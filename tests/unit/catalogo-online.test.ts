import { describe, it, expect } from "vitest";
import { leerOcultosOnline, MAX_OCULTOS, normalizarOcultos } from "@/lib/pedidos/catalogo-online";
import { fakeAdmin } from "../helpers/fake-supabase";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("normalizarOcultos", () => {
  it("deja solo ids válidos y sin repetir", () => {
    expect(normalizarOcultos([A, B, A, "no-es-uuid", 5, null])).toEqual([A, B]);
  });
  it("lo que no es una lista da lista vacía", () => {
    expect(normalizarOcultos(undefined)).toEqual([]);
    expect(normalizarOcultos("x")).toEqual([]);
  });
  it("tiene un tope", () => {
    const muchos = Array.from({ length: MAX_OCULTOS + 50 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(normalizarOcultos(muchos)).toHaveLength(MAX_OCULTOS);
  });
});

describe("leerOcultosOnline", () => {
  it("lee las dos listas de la sucursal", async () => {
    const f = fakeAdmin(() => ({ data: { productos_ocultos_online: [A], promos_ocultas_online: [B] } }));
    expect(await leerOcultosOnline(f.admin, "s1")).toEqual({ productos: [A], promos: [B] });
  });
  it("sin la migración (error de columna) devuelve listas vacías en vez de romper la tienda", async () => {
    const f = fakeAdmin(() => ({ error: { message: "column productos_ocultos_online does not exist" } }));
    expect(await leerOcultosOnline(f.admin, "s1")).toEqual({ productos: [], promos: [] });
  });
});
