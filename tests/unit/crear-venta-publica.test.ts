import { describe, it, expect, vi, afterEach } from "vitest";
import { fakeAdmin, eqDe, type Q } from "../helpers/fake-supabase";

vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ getAll: () => [], set: () => {} }) }));

import { crearVentaPublica, registrarVentaCobroEnEntrega } from "@/lib/pedidos/crear-venta-publica";

afterEach(() => vi.useRealTimers());

const ITEMS = [{ product_id: "p1", promo_id: null, cantidad: 2, precio_unitario: 1000, subtotal: 2000 }];

function mundo(opts: { transiciona?: boolean; rpcError?: boolean; pedido?: any } = {}) {
  const pedido = { id: "ped-1", sucursal_id: "suc-1", total: 2800, contacto_id: null, movimiento_id: null, medio_pago: "efectivo", numero: 9, ...opts.pedido };
  return fakeAdmin(
    (q: Q) => {
      if (q.table === "pedidos" && q.op === "update") return { data: opts.transiciona === false ? [] : [pedido] };
      if (q.table === "pedidos" && q.op === "select") return { data: pedido };
      if (q.table === "pedido_items") return { data: ITEMS };
    },
    () => (opts.rpcError ? { error: { message: "boom" } } : { data: "mov-1" }),
  );
}

describe("crearVentaPublica (pago por Mercado Pago)", () => {
  it("transición atómica pendiente_pago -> pagado, una sola venta con canal pedido_online", async () => {
    const { admin, calls, rpcCalls } = mundo();
    const r = await crearVentaPublica(admin, "ped-1");
    expect(r).toEqual({ movimiento_id: "mov-1" });
    const upd = calls.find((c) => c.op === "update")!;
    expect(eqDe(upd, "estado")).toBe("pendiente_pago");
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].args).toMatchObject({ p_tipo: "venta", p_canal: "pedido_online", p_pago_billetera: 2800, p_created_by: null });
  });

  it("es idempotente: si el pedido ya no está pendiente_pago no vuelve a vender (reenvío del webhook)", async () => {
    const { admin, rpcCalls } = mundo({ transiciona: false });
    expect(await crearVentaPublica(admin, "ped-1")).toEqual({ movimiento_id: null });
    expect(rpcCalls).toHaveLength(0);
  });

  it("si el RPC falla revierte el pedido a pendiente_pago y avisa el error", async () => {
    const { admin, calls } = mundo({ rpcError: true });
    const r = await crearVentaPublica(admin, "ped-1");
    expect(r.error).toBe("boom");
    expect(calls.filter((c) => c.op === "update").pop()!.payload.estado).toBe("pendiente_pago");
  });

  // ── Hallazgo de auditoría (fecha en UTC) ──────────────────────────────────────
  // `new Date().toISOString().slice(0, 10)` da la fecha UTC. A las 22:30 de Argentina
  // (01:30Z del día siguiente) la venta se guarda con la fecha de MAÑANA: cae en otro
  // día en los informes y en la lógica de turnos. El resto del sistema usa fechaHoyAR().
  it("22:30 AR: la venta se registra con la fecha de hoy en Argentina", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T01:30:00Z"));
    const { admin, rpcCalls } = mundo();
    await crearVentaPublica(admin, "ped-1");
    expect(rpcCalls[0].args.p_fecha).toBe("2026-09-18");
  });
});

describe("registrarVentaCobroEnEntrega (efectivo)", () => {
  it("registra el total (envío incluido) como pago_efectivo", async () => {
    const { admin, rpcCalls } = mundo();
    const r = await registrarVentaCobroEnEntrega(admin, "ped-1");
    expect(r.movimiento_id).toBe("mov-1");
    expect(rpcCalls[0].args).toMatchObject({ p_pago_efectivo: 2800, p_pago_billetera: null });
  });

  it("no vende dos veces si el pedido ya tiene movimiento_id", async () => {
    const { admin, rpcCalls } = mundo({ pedido: { movimiento_id: "mov-previo" } });
    expect(await registrarVentaCobroEnEntrega(admin, "ped-1")).toEqual({ movimiento_id: "mov-previo" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("rechaza pedidos que no son en efectivo", async () => {
    const { admin } = mundo({ pedido: { medio_pago: "mercadopago_link" } });
    expect((await registrarVentaCobroEnEntrega(admin, "ped-1")).error).toMatch(/efectivo/);
  });

  it("22:30 AR: la venta en efectivo también usa la fecha argentina", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-19T01:30:00Z"));
    const { admin, rpcCalls } = mundo();
    await registrarVentaCobroEnEntrega(admin, "ped-1");
    expect(rpcCalls[0].args.p_fecha).toBe("2026-09-18");
  });
});
