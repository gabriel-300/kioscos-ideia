import { describe, it, expect } from "vitest";
import { cancelarPedidoDelCliente, puedeCancelarElCliente, textoAyudaCancelar } from "@/lib/pedidos/cancelar-por-cliente";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

const SUC = "4af1ad9f-cd2f-47cd-974d-2bc8037db9a4";
const PED = "56c7e0df-5314-4af2-b7be-536b811f3d05";

describe("puedeCancelarElCliente", () => {
  it("solo sin pagar o en efectivo aceptado, y sin venta", () => {
    expect(puedeCancelarElCliente("pendiente_pago", false)).toBe(true);
    expect(puedeCancelarElCliente("confirmado", false)).toBe(true);
    for (const e of ["pagado", "en_preparacion", "listo_retiro", "en_reparto", "entregado", "cancelado", "expirado"]) {
      expect(puedeCancelarElCliente(e, false), e).toBe(false);
    }
    expect(puedeCancelarElCliente("confirmado", true)).toBe(false);
  });
  it("cuando ya no puede, le dice que escriba por el chat (si el pedido sigue en marcha)", () => {
    for (const e of ["pagado", "en_preparacion", "listo_retiro", "en_reparto"]) expect(textoAyudaCancelar(e), e).toMatch(/chat/);
    for (const e of ["pendiente_pago", "confirmado", "entregado", "cancelado"]) expect(textoAyudaCancelar(e), e).toBeNull();
  });
});

describe("cancelarPedidoDelCliente", () => {
  const mundo = (pedido: Record<string, unknown> | null, actualizados: unknown[] = [{ id: PED }]) =>
    fakeAdmin((q: Q) => {
      if (q.table === "pedidos") return q.op === "select" ? { data: pedido } : { data: actualizados };
      if (q.table === "mercadopago_qr_orders") return { data: null };
    });
  const p = { sucursalId: SUC, pedidoId: PED };

  it("cancela un pedido sin pagar y deja cancelado el cobro de Mercado Pago", async () => {
    const { admin, calls } = mundo({ id: PED, estado: "pendiente_pago", movimiento_id: null, medio_pago: "mercadopago_link" });
    expect(await cancelarPedidoDelCliente(admin, p)).toEqual({});
    expect(calls.find((c) => c.table === "pedidos" && c.op === "update")!.payload).toMatchObject({ estado: "cancelado" });
    expect(calls.find((c) => c.table === "mercadopago_qr_orders" && c.op === "update")!.payload).toEqual({ estado: "cancelado" });
  });
  it("cancela un pedido en efectivo aceptado (sin tocar Mercado Pago)", async () => {
    const { admin, calls } = mundo({ id: PED, estado: "confirmado", movimiento_id: null, medio_pago: "efectivo" });
    expect(await cancelarPedidoDelCliente(admin, p)).toEqual({});
    expect(calls.some((c) => c.table === "mercadopago_qr_orders")).toBe(false);
  });
  it("un pedido ya pagado o en preparación NO se cancela solo: lo resuelve el local por el chat", async () => {
    for (const estado of ["pagado", "en_preparacion", "en_reparto", "listo_retiro"]) {
      const { admin, calls } = mundo({ id: PED, estado, movimiento_id: estado === "pagado" ? "m1" : null, medio_pago: "efectivo" });
      expect((await cancelarPedidoDelCliente(admin, p)).error, estado).toMatch(/chat/);
      expect(calls.some((c) => c.op === "update"), estado).toBe(false);
    }
  });
  it("ya cancelado o vencido: lo avisa", async () => {
    expect((await cancelarPedidoDelCliente(mundo({ id: PED, estado: "cancelado", movimiento_id: null, medio_pago: "efectivo" }).admin, p)).error).toMatch(/ya está cancelado/);
    expect((await cancelarPedidoDelCliente(mundo({ id: PED, estado: "expirado", movimiento_id: null, medio_pago: "efectivo" }).admin, p)).error).toMatch(/venció/);
  });
  it("un pedido de otra sucursal, inexistente o ids que no son uuid: no se encuentra (y no consulta con ids rotos)", async () => {
    expect((await cancelarPedidoDelCliente(mundo(null).admin, p)).error).toMatch(/No se encontró/);
    const f = mundo({ id: PED, estado: "confirmado", movimiento_id: null, medio_pago: "efectivo" });
    expect((await cancelarPedidoDelCliente(f.admin, { sucursalId: "x", pedidoId: "y" })).error).toMatch(/No se encontró/);
    expect(f.calls).toHaveLength(0);
  });
  it("si el local lo tomó justo ahora (el estado cambió), avisa y no pisa nada", async () => {
    const { admin, calls } = mundo({ id: PED, estado: "confirmado", movimiento_id: null, medio_pago: "efectivo" }, []);
    expect((await cancelarPedidoDelCliente(admin, p)).error).toMatch(/acaba de tomar/);
    expect(calls.some((c) => c.table === "mercadopago_qr_orders")).toBe(false);
  });
});
