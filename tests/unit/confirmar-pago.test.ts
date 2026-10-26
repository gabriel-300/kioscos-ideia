import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

const venta = vi.hoisted(() => ({ crearVentaPublica: vi.fn(async () => ({ movimiento_id: "m1" } as { movimiento_id: string | null; error?: string })) }));
vi.mock("@/lib/pedidos/crear-venta-publica", () => venta);

import { buscarPagoAprobado, confirmarPagoPedido } from "@/lib/pedidos/confirmar-pago";

const REF = "9322db61-c459-48b9-9189-d6ed12126795";
const resp = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response;

describe("buscarPagoAprobado", () => {
  it("encuentra el pago aprobado con esa referencia y ese importe", async () => {
    const f = vi.fn(async () => resp({ results: [
      { id: 1, status: "rejected", transaction_amount: 4000, external_reference: REF },
      { id: 2, status: "approved", transaction_amount: 4000, external_reference: REF },
    ] }));
    expect(await buscarPagoAprobado(REF, 4000, "tok", f as unknown as typeof fetch)).toEqual({ aprobado: true, paymentId: "2" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`external_reference=${REF}`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
  it("no vale un pago de otro importe, de otro pedido o sin aprobar", async () => {
    for (const r of [
      { id: 1, status: "approved", transaction_amount: 3999, external_reference: REF },
      { id: 2, status: "approved", transaction_amount: 4000, external_reference: "otra" },
      { id: 3, status: "pending", transaction_amount: 4000, external_reference: REF },
    ]) {
      expect(await buscarPagoAprobado(REF, 4000, "tok", (async () => resp({ results: [r] })) as unknown as typeof fetch)).toEqual({ aprobado: false });
    }
    expect(await buscarPagoAprobado(REF, 4000, "tok", (async () => resp({})) as unknown as typeof fetch)).toEqual({ aprobado: false });
  });
  it("si Mercado Pago falla, devuelve error (no 'aprobado')", async () => {
    expect(await buscarPagoAprobado(REF, 4000, "tok", (async () => resp({}, false, 500)) as unknown as typeof fetch)).toEqual({ error: "Mercado Pago respondió 500" });
    expect(await buscarPagoAprobado(REF, 4000, "tok", (async () => { throw new Error("red"); }) as unknown as typeof fetch)).toEqual({ error: "No se pudo consultar a Mercado Pago" });
  });
});

describe("confirmarPagoPedido", () => {
  beforeEach(() => { venta.crearVentaPublica.mockClear(); venta.crearVentaPublica.mockResolvedValue({ movimiento_id: "m1" }); });

  const mundo = (pedido: Record<string, unknown> | null = { id: "p1", estado: "pendiente_pago", medio_pago: "mercadopago_link", total: "4000.00" }, orden: unknown = { id: "o1", external_reference: REF, estado: "pendiente" }) =>
    fakeAdmin((q: Q) => {
      if (q.table === "pedidos") return q.op === "select" ? { data: pedido } : { data: null };
      if (q.table === "mercadopago_qr_orders") return q.op === "select" ? { data: orden } : { data: null };
    });
  const aprobado = (async () => resp({ results: [{ id: 77, status: "approved", transaction_amount: 4000, external_reference: REF }] })) as unknown as typeof fetch;
  const sinPago = (async () => resp({ results: [] })) as unknown as typeof fetch;
  const base = { pedidoId: "p1", userId: "admin1", accessToken: "tok" };

  it("con el pago aprobado en Mercado Pago confirma y deja el rastro (sin pedir motivo)", async () => {
    const { admin, calls } = mundo();
    expect(await confirmarPagoPedido(admin, { ...base, fetchFn: aprobado })).toEqual({ metodo: "mercadopago" });
    expect(venta.crearVentaPublica).toHaveBeenCalledTimes(1);
    const rastro = calls.find((c) => c.table === "pedidos" && c.op === "update")!;
    expect(rastro.payload).toMatchObject({ pago_confirmado_por: "admin1", pago_confirmacion: "mercadopago", pago_confirmacion_motivo: null });
    const orden = calls.find((c) => c.table === "mercadopago_qr_orders" && c.op === "update")!;
    expect(orden.payload).toMatchObject({ estado: "pagado", mp_payment_id: "77" });
  });
  it("si Mercado Pago no muestra el pago, NO confirma y pide un motivo", async () => {
    const { admin } = mundo();
    const r = await confirmarPagoPedido(admin, { ...base, fetchFn: sinPago });
    expect(r.sinVerificar).toBe(true);
    expect(r.error).toMatch(/no muestra un pago aprobado/);
    expect(venta.crearVentaPublica).not.toHaveBeenCalled();
  });
  it("un motivo corto no alcanza; con un motivo claro confirma como 'manual' y lo registra", async () => {
    const corto = mundo();
    expect((await confirmarPagoPedido(corto.admin, { ...base, fetchFn: sinPago, motivoManual: "ya pagó" })).sinVerificar).toBe(true);
    expect(venta.crearVentaPublica).not.toHaveBeenCalled();

    const { admin, calls } = mundo();
    expect(await confirmarPagoPedido(admin, { ...base, fetchFn: sinPago, motivoManual: "Transferencia directa al alias, vista en el banco" })).toEqual({ metodo: "manual" });
    expect(venta.crearVentaPublica).toHaveBeenCalledTimes(1);
    const rastro = calls.find((c) => c.table === "pedidos" && c.op === "update")!;
    expect(rastro.payload).toMatchObject({ pago_confirmacion: "manual", pago_confirmacion_motivo: "Transferencia directa al alias, vista en el banco" });
    expect(calls.some((c) => c.table === "mercadopago_qr_orders" && c.op === "update")).toBe(false);
  });
  it("sin conexión con Mercado Pago (sin token) o sin cobro generado, tampoco confirma a secas", async () => {
    expect((await confirmarPagoPedido(mundo().admin, { pedidoId: "p1", userId: "a" })).sinVerificar).toBe(true);
    expect((await confirmarPagoPedido(mundo(undefined, null).admin, { ...base, fetchFn: aprobado })).sinVerificar).toBe(true);
    expect(venta.crearVentaPublica).not.toHaveBeenCalled();
  });
  it("si Mercado Pago falla (error de red) tampoco confirma sin motivo", async () => {
    const roto = (async () => resp({}, false, 503)) as unknown as typeof fetch;
    const r = await confirmarPagoPedido(mundo().admin, { ...base, fetchFn: roto });
    expect(r.sinVerificar).toBe(true);
    expect(r.error).toMatch(/503/);
  });
  it("solo pedidos de Mercado Pago que siguen esperando el pago", async () => {
    expect((await confirmarPagoPedido(mundo({ id: "p1", estado: "pendiente_pago", medio_pago: "efectivo", total: 1 }).admin, base)).error).toMatch(/no se paga por link/);
    expect((await confirmarPagoPedido(mundo({ id: "p1", estado: "pagado", medio_pago: "mercadopago_link", total: 1 }).admin, base)).error).toMatch(/ya no está esperando/);
    expect((await confirmarPagoPedido(mundo({ id: "p1", estado: "expirado", medio_pago: "mercadopago_link", total: 1 }).admin, base)).error).toMatch(/venció/);
    expect((await confirmarPagoPedido(mundo(null).admin, base)).error).toMatch(/No se encontró/);
    expect(venta.crearVentaPublica).not.toHaveBeenCalled();
  });
  it("si no se puede registrar la venta, avisa y no deja el rastro", async () => {
    venta.crearVentaPublica.mockResolvedValue({ movimiento_id: null, error: "falló" });
    const { admin, calls } = mundo();
    expect((await confirmarPagoPedido(admin, { ...base, fetchFn: aprobado })).error).toMatch(/No se pudo registrar la venta/);
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });
});
