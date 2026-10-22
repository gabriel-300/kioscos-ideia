import { describe, it, expect } from "vitest";
import { anularPedidoCobrado } from "@/lib/pedidos/anular-pedido";
import { fakeAdmin, type Q, type Resp } from "../helpers/fake-supabase";

type Mundo = {
  pedido?: Record<string, unknown> | null;
  venta?: Record<string, unknown> | null;
  apertura?: string | null;  // created_at de la última apertura de caja
  cierre?: string | null;    // created_at del último cierre
  pedidoActualizado?: boolean;
};

function mundo(m: Mundo = {}) {
  const pedido = m.pedido === undefined ? { id: "p1", sucursal_id: "s1", estado: "pagado", movimiento_id: "m1" } : m.pedido;
  const venta = m.venta === undefined ? { id: "m1", created_at: "2026-10-22T14:00:00Z", anulado_en: null } : m.venta;
  return fakeAdmin((q: Q): Resp | undefined => {
    switch (q.table) {
      case "pedidos": return q.op === "select" ? { data: pedido } : { data: m.pedidoActualizado === false ? [] : [{ id: "p1" }] };
      case "movimientos": return q.op === "select" ? { data: venta } : { data: null };
      case "aperturas_caja": return { data: m.apertura === undefined ? { created_at: "2026-10-22T11:00:00Z" } : m.apertura ? { created_at: m.apertura } : null };
      case "cierres_caja": return { data: m.cierre ? { created_at: m.cierre } : null };
    }
  });
}
const base = { pedidoId: "p1", motivo: "Pedido de prueba", userId: "u1", esAdmin: false };

describe("anularPedidoCobrado", () => {
  it("con la caja abierta anula la venta (con quién y por qué) y cancela el pedido", async () => {
    const { admin, calls } = mundo();
    expect(await anularPedidoCobrado(admin, base)).toEqual({ sucursalId: "s1" });
    const venta = calls.find((c) => c.table === "movimientos" && c.op === "update")!;
    expect(venta.payload).toMatchObject({ anulado_por: "u1", motivo_anulacion: "Pedido online anulado: Pedido de prueba" });
    expect(venta.payload.anulado_en).toEqual(expect.any(String));
    expect(calls.find((c) => c.table === "pedidos" && c.op === "update")!.payload).toMatchObject({ estado: "cancelado" });
  });
  it("una venta anterior a la apertura de hoy (otro turno) cuenta como caja cerrada", async () => {
    const { admin } = mundo({ venta: { id: "m1", created_at: "2026-10-22T09:00:00Z", anulado_en: null } });
    expect((await anularPedidoCobrado(admin, base)).error).toMatch(/ya está cerrada/);
  });
  it("sin ninguna apertura de caja el personal no puede anular", async () => {
    expect((await anularPedidoCobrado(mundo({ apertura: null }).admin, base)).error).toMatch(/ya está cerrada/);
  });
  it("sin motivo no hace nada", async () => {
    const { admin, calls } = mundo();
    expect((await anularPedidoCobrado(admin, { ...base, motivo: "  " })).error).toMatch(/por qué/);
    expect(calls).toHaveLength(0);
  });
  it("con la caja cerrada el personal no puede, y no se toca nada", async () => {
    const { admin, calls } = mundo({ cierre: "2026-10-22T18:00:00Z" });
    expect((await anularPedidoCobrado(admin, base)).error).toMatch(/caja de ese turno ya está cerrada/);
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });
  it("un administrador sí puede aunque la caja esté cerrada", async () => {
    const { admin, calls } = mundo({ cierre: "2026-10-22T18:00:00Z" });
    expect((await anularPedidoCobrado(admin, { ...base, esAdmin: true })).error).toBeUndefined();
    expect(calls.some((c) => c.table === "movimientos" && c.op === "update")).toBe(true);
  });
  it("un pedido ya entregado solo lo anula un administrador", async () => {
    const { admin } = mundo({ pedido: { id: "p1", sucursal_id: "s1", estado: "entregado", movimiento_id: "m1" } });
    expect((await anularPedidoCobrado(admin, base)).error).toMatch(/administrador/);
    expect((await anularPedidoCobrado(admin, { ...base, esAdmin: true })).error).toBeUndefined();
  });
  it("sin venta, que use Cancelar pedido; ya cancelado o vencido, no se puede", async () => {
    expect((await anularPedidoCobrado(mundo({ pedido: { id: "p1", sucursal_id: "s1", estado: "confirmado", movimiento_id: null } }).admin, base)).error).toMatch(/Cancelar pedido/);
    expect((await anularPedidoCobrado(mundo({ pedido: { id: "p1", sucursal_id: "s1", estado: "cancelado", movimiento_id: "m1" } }).admin, base)).error).toMatch(/ya no se puede anular/);
  });
  it("si la venta ya estaba anulada, solo cancela el pedido (no la anula dos veces)", async () => {
    const { admin, calls } = mundo({ venta: { id: "m1", created_at: "2026-10-22T14:00:00Z", anulado_en: "2026-10-22T15:00:00Z" } });
    expect((await anularPedidoCobrado(admin, base)).error).toBeUndefined();
    expect(calls.some((c) => c.table === "movimientos" && c.op === "update")).toBe(false);
    expect(calls.some((c) => c.table === "pedidos" && c.op === "update")).toBe(true);
  });
  it("si el pedido cambió de estado mientras tanto, avisa", async () => {
    const { admin } = mundo({ pedidoActualizado: false });
    expect((await anularPedidoCobrado(admin, base)).error).toMatch(/cambió de estado/);
  });
});
