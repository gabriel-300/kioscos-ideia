import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearCheckoutMercadoPago, enlaceDePagoDelPedido } from "@/lib/pedidos/checkout-mercadopago";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

const PEDIDO = { id: "11111111-1111-4111-8111-111111111111", numero: 41, sucursal_id: "22222222-2222-4222-8222-222222222222", total: 10500, expira_en: "2026-10-20T20:00:00.000Z" };

describe("crearCheckoutMercadoPago", () => {
  const fetchOriginal = globalThis.fetch;
  beforeEach(() => { process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST-token"; });
  afterEach(() => { globalThis.fetch = fetchOriginal; delete process.env.MERCADOPAGO_ACCESS_TOKEN; });

  const mpResponde = (res: Partial<Response> & { json?: () => Promise<unknown> }) => {
    const mock = vi.fn(async () => res as Response);
    globalThis.fetch = mock as unknown as typeof fetch;
    return mock;
  };

  it("sin credenciales no llama a Mercado Pago ni toca la base", async () => {
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    const f = fakeAdmin(() => undefined);
    const mock = mpResponde({ ok: true });
    const r = await crearCheckoutMercadoPago(f.admin, PEDIDO);
    expect(r.url).toBeNull();
    expect(mock).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(0);
  });

  it("crea la orden con el pedido enlazado y manda el total del servidor a Mercado Pago", async () => {
    const f = fakeAdmin(() => undefined);
    const mock = mpResponde({ ok: true, json: async () => ({ init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=abc" }) });
    const r = await crearCheckoutMercadoPago(f.admin, PEDIDO);

    expect(r).toEqual({ url: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=abc" });

    const insert = f.calls.find((c: Q) => c.table === "mercadopago_qr_orders" && c.op === "insert")!;
    expect(insert.payload).toMatchObject({ sucursal_id: PEDIDO.sucursal_id, monto: 10500, estado: "pendiente", pedido_id: PEDIDO.id });

    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/checkout/preferences");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TEST-token");
    const cuerpo = JSON.parse(String(init.body));
    expect(cuerpo.items[0]).toMatchObject({ quantity: 1, unit_price: 10500, currency_id: "ARS" });
    expect(cuerpo.external_reference).toBe(insert.payload.external_reference); // el aviso de pago busca la orden por este valor
    expect(cuerpo.notification_url).toMatch(/\/api\/webhooks\/mercadopago$/);
    expect(cuerpo.back_urls.success).toContain(`/pedir/${PEDIDO.sucursal_id}/pedido/${PEDIDO.id}`);
    expect(cuerpo).toMatchObject({ expires: true, expiration_date_to: "2026-10-20T20:00:00.000Z", auto_return: "approved" });

    const guarda = f.calls.find((c: Q) => c.op === "update" && c.payload?.checkout_url)!;
    expect(guarda.payload.checkout_url).toContain("pref_id=abc");
  });

  it("si Mercado Pago rechaza, cancela la orden y no devuelve enlace (el pedido sigue, se confirma a mano)", async () => {
    const f = fakeAdmin(() => undefined);
    mpResponde({ ok: false, status: 400, text: async () => "invalid" });
    const r = await crearCheckoutMercadoPago(f.admin, PEDIDO);
    expect(r.url).toBeNull();
    expect(r.error).toMatch(/400/);
    expect(f.calls.some((c: Q) => c.op === "update" && c.payload?.estado === "cancelado")).toBe(true);
  });

  it("si no hay conexión con Mercado Pago tampoco rompe: devuelve el error", async () => {
    const f = fakeAdmin(() => undefined);
    globalThis.fetch = (async () => { throw new Error("sin red"); }) as unknown as typeof fetch;
    const r = await crearCheckoutMercadoPago(f.admin, PEDIDO);
    expect(r.url).toBeNull();
    expect(r.error).toMatch(/sin red/);
  });

  it("un total en cero no genera cobro", async () => {
    const f = fakeAdmin(() => undefined);
    const mock = mpResponde({ ok: true });
    expect((await crearCheckoutMercadoPago(f.admin, { ...PEDIDO, total: 0 })).url).toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("enlaceDePagoDelPedido", () => {
  it("devuelve el enlace de la orden que sigue pendiente", async () => {
    const f = fakeAdmin((q: Q) => (q.table === "mercadopago_qr_orders" ? { data: { checkout_url: "https://mp/pagar" } } : undefined));
    expect(await enlaceDePagoDelPedido(f.admin, PEDIDO.id)).toBe("https://mp/pagar");
    const consulta = f.calls[0];
    expect(consulta.filters).toEqual(expect.arrayContaining([{ op: "eq", col: "pedido_id", val: PEDIDO.id }, { op: "eq", col: "estado", val: "pendiente" }]));
  });
  it("sin orden pendiente no hay enlace", async () => {
    const f = fakeAdmin(() => ({ data: null }));
    expect(await enlaceDePagoDelPedido(f.admin, PEDIDO.id)).toBeNull();
  });
});
