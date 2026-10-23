import { describe, it, expect } from "vitest";
import { calificacionesPorPedido, guardarCalificacion, leerCalificacion, normalizarCalificacion } from "@/lib/pedidos/calificacion";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

const SUC = "4af1ad9f-cd2f-47cd-974d-2bc8037db9a4";
const PED = "56c7e0df-5314-4af2-b7be-536b811f3d05";

describe("normalizarCalificacion", () => {
  it("acepta estrellas enteras de 1 a 5", () => {
    for (const e of [1, 2, 3, 4, 5]) expect(normalizarCalificacion(e, "").calificacion).toEqual({ estrellas: e, comentario: null });
  });
  it("rechaza estrellas fuera de rango, decimales y cualquier otro tipo", () => {
    for (const e of [0, 6, -1, 2.5, Number.NaN, "5", null, undefined]) expect(normalizarCalificacion(e, null).error, String(e)).toMatch(/1 a 5/);
  });
  it("el comentario es opcional, se limpia y no pasa de 500 letras", () => {
    expect(normalizarCalificacion(5, "  Muy rico \u0007 todo  ").calificacion?.comentario).toBe("Muy rico  todo");
    expect(normalizarCalificacion(5, "   ").calificacion?.comentario).toBeNull();
    expect(normalizarCalificacion(5, "x".repeat(501)).error).toMatch(/muy largo/);
    expect(normalizarCalificacion(5, "x".repeat(500)).calificacion?.comentario).toHaveLength(500);
    expect(normalizarCalificacion(5, { a: 1 }).error).toMatch(/comentario/);
  });
});

describe("guardarCalificacion", () => {
  const mundo = (pedido: Record<string, unknown> | null, errorInsert?: { code?: string; message: string }) =>
    fakeAdmin((q: Q) => {
      if (q.table === "pedidos") return { data: pedido };
      if (q.table === "pedido_calificaciones") return errorInsert ? { error: errorInsert } : { data: null };
    });
  const pedido = { id: PED, estado: "entregado" };

  it("guarda la calificación de un pedido entregado de esa sucursal", async () => {
    const { admin, calls } = mundo(pedido);
    expect(await guardarCalificacion(admin, { sucursalId: SUC, pedidoId: PED, estrellas: 4, comentario: "Bien" })).toEqual({});
    const ins = calls.find((c) => c.table === "pedido_calificaciones" && c.op === "insert")!;
    expect(ins.payload).toEqual({ pedido_id: PED, estrellas: 4, comentario: "Bien" });
  });
  it("solo con el pedido entregado", async () => {
    for (const estado of ["confirmado", "en_reparto", "cancelado", "expirado"]) {
      const { admin, calls } = mundo({ id: PED, estado });
      expect((await guardarCalificacion(admin, { sucursalId: SUC, pedidoId: PED, estrellas: 5, comentario: "" })).error, estado).toMatch(/cuando lo recibas/);
      expect(calls.some((c) => c.op === "insert")).toBe(false);
    }
  });
  it("un pedido que no es de esa sucursal o no existe, o ids que no son uuid, se rechazan sin consultar", async () => {
    expect((await guardarCalificacion(mundo(null).admin, { sucursalId: SUC, pedidoId: PED, estrellas: 5, comentario: "" })).error).toMatch(/No se encontró/);
    const f = mundo(pedido);
    expect((await guardarCalificacion(f.admin, { sucursalId: "x", pedidoId: "y", estrellas: 5, comentario: "" })).error).toMatch(/No se encontró/);
    expect(f.calls).toHaveLength(0);
  });
  it("estrellas inválidas no tocan la base", async () => {
    const f = mundo(pedido);
    expect((await guardarCalificacion(f.admin, { sucursalId: SUC, pedidoId: PED, estrellas: 9, comentario: "" })).error).toMatch(/1 a 5/);
    expect(f.calls).toHaveLength(0);
  });
  it("una segunda calificación del mismo pedido se rechaza amablemente", async () => {
    const { admin } = mundo(pedido, { code: "23505", message: "duplicate key value" });
    expect((await guardarCalificacion(admin, { sucursalId: SUC, pedidoId: PED, estrellas: 5, comentario: "" })).error).toMatch(/Ya calificaste/);
  });
  it("sin la migración avisa que falta aplicarla", async () => {
    const { admin } = mundo(pedido, { message: 'relation "pedido_calificaciones" does not exist' });
    expect((await guardarCalificacion(admin, { sucursalId: SUC, pedidoId: PED, estrellas: 5, comentario: "" })).error).toMatch(/migración 126/);
  });
});

describe("leer calificaciones", () => {
  it("leerCalificacion devuelve lo guardado, o null si no hay o falla la tabla", async () => {
    expect(await leerCalificacion(fakeAdmin(() => ({ data: { estrellas: 5, comentario: "Genial" } })).admin, PED)).toEqual({ estrellas: 5, comentario: "Genial" });
    expect(await leerCalificacion(fakeAdmin(() => ({ data: null })).admin, PED)).toBeNull();
    expect(await leerCalificacion(fakeAdmin(() => ({ error: { message: "no existe" } })).admin, PED)).toBeNull();
  });
  it("calificacionesPorPedido arma el mapa, y queda vacío sin ids o si falla la tabla", async () => {
    const f = fakeAdmin(() => ({ data: [{ pedido_id: "a", estrellas: 3, comentario: null }, { pedido_id: "b", estrellas: 5, comentario: "Rico" }] }));
    const m = await calificacionesPorPedido(f.admin, ["a", "b"]);
    expect(m.get("a")).toEqual({ estrellas: 3, comentario: null });
    expect(m.get("b")).toEqual({ estrellas: 5, comentario: "Rico" });
    const vacio = fakeAdmin(() => ({ data: [] }));
    expect((await calificacionesPorPedido(vacio.admin, [])).size).toBe(0);
    expect(vacio.calls).toHaveLength(0);
    expect((await calificacionesPorPedido(fakeAdmin(() => ({ error: { message: "x" } })).admin, ["a"])).size).toBe(0);
  });
});
