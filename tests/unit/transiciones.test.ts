import { describe, it, expect } from "vitest";
import { transicionesPermitidas, aplicarTransicion } from "@/lib/pedidos/transiciones";
import { fakeAdmin, eqDe, type Q } from "../helpers/fake-supabase";

describe("transicionesPermitidas (máquina de estados de pedidos)", () => {
  it.each([
    ["confirmado", "retiro_local", false, ["en_preparacion"]],
    ["pagado", "delivery", false, ["en_preparacion"]],
    ["en_preparacion", "retiro_local", false, ["listo_retiro"]],
    ["en_preparacion", "delivery", false, []],              // sin repartidor no se puede despachar
    ["en_preparacion", "delivery", true, ["en_reparto"]],
    ["listo_retiro", "retiro_local", false, ["entregado"]],
    ["en_reparto", "delivery", true, ["entregado"]],
    ["entregado", "delivery", true, []],
    ["cancelado", "retiro_local", false, []],
    ["expirado", "retiro_local", false, []],
    ["pendiente_pago", "retiro_local", false, []],           // solo sale por confirmarPagoRecibido / webhook
  ])("%s (%s, repartidor=%s) -> %j", (estado, tipo, rep, esperado) => {
    expect(transicionesPermitidas(estado as string, tipo as string, rep as boolean)).toEqual(esperado);
  });

  it("no hay forma de saltear estados ni volver hacia atrás", () => {
    expect(transicionesPermitidas("confirmado", "retiro_local", false)).not.toContain("entregado");
    expect(transicionesPermitidas("en_reparto", "delivery", true)).not.toContain("en_preparacion");
  });
});

describe("aplicarTransicion", () => {
  const pedido = (over = {}) => ({ id: "ped-1", estado: "listo_retiro", tipo_entrega: "retiro_local", repartidor_id: null, medio_pago: "mercadopago_link", ...over });

  it("rechaza transiciones inválidas sin tocar la base", async () => {
    const { admin, calls } = fakeAdmin(() => ({ data: [] }));
    const r = await aplicarTransicion(admin, pedido({ estado: "confirmado" }), "entregado");
    expect(r.error).toBe("Transición de estado inválida");
    expect(calls).toHaveLength(0);
  });

  it("delivery sin repartidor da un mensaje accionable", async () => {
    const { admin } = fakeAdmin(() => ({ data: [] }));
    const r = await aplicarTransicion(admin, pedido({ estado: "en_preparacion", tipo_entrega: "delivery" }), "en_reparto");
    expect(r.error).toMatch(/repartidor/);
  });

  it("el UPDATE es condicional al estado leído (evita doble click / dos personas)", async () => {
    const { admin, calls } = fakeAdmin(() => ({ data: [{ id: "ped-1" }] }));
    await aplicarTransicion(admin, pedido(), "entregado");
    const upd = calls.find((c) => c.op === "update")!;
    expect(eqDe(upd, "estado")).toBe("listo_retiro");
    expect(eqDe(upd, "id")).toBe("ped-1");
  });

  it("si otra persona ya cambió el estado (0 filas) devuelve error y NO registra venta", async () => {
    const { admin, rpcCalls } = fakeAdmin(() => ({ data: [] }));
    const r = await aplicarTransicion(admin, pedido({ medio_pago: "efectivo" }), "entregado");
    expect(r.error).toMatch(/ya cambió/);
    expect(rpcCalls).toHaveLength(0);
  });

  it("entregar un pedido en efectivo registra UNA venta con el total como pago_efectivo", async () => {
    const handler = (q: Q) => {
      if (q.table === "pedidos" && q.op === "update") return { data: [{ id: "ped-1" }] };
      if (q.table === "pedidos" && q.op === "select") return { data: { id: "ped-1", sucursal_id: "s", total: 4500, contacto_id: null, movimiento_id: null, medio_pago: "efectivo", numero: 7 } };
      if (q.table === "pedido_items") return { data: [{ product_id: "p", promo_id: null, cantidad: 1, precio_unitario: 4000, subtotal: 4000 }] };
    };
    const { admin, rpcCalls } = fakeAdmin(handler, () => ({ data: "mov-1" }));
    const r = await aplicarTransicion(admin, pedido({ medio_pago: "efectivo" }), "entregado");
    expect(r.error).toBeUndefined();
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args).toMatchObject({ p_tipo: "venta", p_canal: "pedido_online", p_pago_efectivo: 4500, p_created_by: null });
  });

  it("si registrar la venta falla, revierte el estado (no queda 'entregado' sin venta)", async () => {
    const handler = (q: Q) => {
      if (q.table === "pedidos" && q.op === "select") return { data: { id: "ped-1", sucursal_id: "s", total: 100, movimiento_id: null, medio_pago: "efectivo" } };
      if (q.table === "pedido_items") return { data: [{ product_id: "p", cantidad: 1, precio_unitario: 100, subtotal: 100, promo_id: null }] };
      if (q.op === "update") return { data: [{ id: "ped-1" }] };
    };
    const { admin, calls } = fakeAdmin(handler, () => ({ error: { message: "boom" } }));
    const r = await aplicarTransicion(admin, pedido({ medio_pago: "efectivo" }), "entregado");
    expect(r.error).toMatch(/No se pudo registrar la venta/);
    const reversion = calls.filter((c) => c.op === "update").pop()!;
    expect(reversion.payload.estado).toBe("listo_retiro");
    expect(eqDe(reversion, "estado")).toBe("entregado");
  });
});
