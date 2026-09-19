import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { fakeAdmin, eqDe, type Q, type Resp } from "../helpers/fake-supabase";

// Webhooks públicos (sin sesión): lo único que los protege es la firma o la
// consulta contra la API de Mercado Pago. `it.fails` = hallazgo abierto (H-11).

const h = vi.hoisted(() => ({ admin: null as any }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin, createClient: async () => ({}) }));

import { POST as mpPOST } from "@/app/api/webhooks/mercadopago/route";
import { GET as waGET, POST as waPOST } from "@/app/api/webhooks/whatsapp/route";

const ENV = { ...process.env };
beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { process.env = { ...ENV }; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ───────────────────────── Mercado Pago ─────────────────────────
describe("webhook de Mercado Pago", () => {
  const url = (qs: string) => `http://localhost/api/webhooks/mercadopago?${qs}`;
  const pedir = (qs: string) => mpPOST(new NextRequest(url(qs), { method: "POST" }));

  function mp(payment: Record<string, unknown> | null, status = 200) {
    const fetchMock = vi.fn(async () => ({ ok: status < 400, status, json: async () => payment }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  function base(handler: (q: Q) => Resp | undefined) {
    const f = fakeAdmin(handler);
    h.admin = f.admin;
    return f;
  }
  const aprobado = { status: "approved", transaction_amount: 1500, external_reference: "ref-1", payment_type_id: "account_money" };
  const conToken = () => { process.env.MERCADOPAGO_ACCESS_TOKEN = "tok-test"; };

  it("sin MERCADOPAGO_ACCESS_TOKEN responde 501 y no toca nada", async () => {
    delete process.env.MERCADOPAGO_ACCESS_TOKEN;
    const f = base(() => undefined);
    const fetchMock = mp(aprobado);
    expect((await pedir("type=payment&data.id=123")).status).toBe(501);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(0);
  });

  it("una notificación sin data.id se responde 200 sin hacer nada", async () => {
    conToken();
    const f = base(() => undefined);
    const fetchMock = mp(aprobado);
    expect((await pedir("type=payment")).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(0);
  });

  it("no confía en el body: re-consulta el pago a la API con NUESTRO token", async () => {
    conToken();
    base((q) => (q.op === "update" ? { data: [{ id: "o1", pedido_id: null }] } : undefined));
    const fetchMock = mp(aprobado);
    await pedir("type=payment&data.id=123");
    expect(fetchMock).toHaveBeenCalledWith("https://api.mercadopago.com/v1/payments/123", { headers: { Authorization: "Bearer tok-test" } });
  });

  it("pago aprobado: pasa la orden de 'pendiente' a 'pagado' con update CONDICIONAL (idempotente ante reenvíos)", async () => {
    conToken();
    const f = base((q) => (q.op === "update" ? { data: [{ id: "o1", pedido_id: null }] } : undefined));
    mp(aprobado);
    expect((await pedir("type=payment&data.id=123")).status).toBe(200);
    const u = f.calls.find((c) => c.table === "mercadopago_qr_orders" && c.op === "update")!;
    expect(u.payload).toMatchObject({ estado: "pagado", mp_payment_id: "123" });
    expect(eqDe(u, "external_reference")).toBe("ref-1");
    expect(eqDe(u, "estado")).toBe("pendiente");
  });

  it("pago NO aprobado (pendiente, rechazado) no marca nada como pagado", async () => {
    conToken();
    const f = base(() => undefined);
    mp({ ...aprobado, status: "pending" });
    await pedir("type=payment&data.id=123");
    expect(f.calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("un reenvío de un pago ya procesado no vuelve a vender ni lo guarda como transferencia nueva", async () => {
    conToken();
    const f = base((q) => {
      if (q.op === "update") return { data: [] };                          // ya no hay orden 'pendiente'
      if (q.table === "mercadopago_qr_orders") return { data: { sucursal_id: "s1", estado: "pagado", mp_payment_id: "123" } };
    });
    mp(aprobado);
    await pedir("type=payment&data.id=123");
    expect(f.calls.some((c) => c.table === "mercadopago_transferencias_recibidas")).toBe(false);
    expect(f.rpcCalls).toHaveLength(0);
  });

  it("una transferencia bancaria sin orden de QR se guarda para conciliar a mano", async () => {
    conToken();
    const f = base(() => ({ data: null }));
    mp({ status: "approved", transaction_amount: 900, external_reference: null, payment_type_id: "bank_transfer" });
    await pedir("type=payment&data.id=555");
    const up = f.calls.find((c) => c.table === "mercadopago_transferencias_recibidas" && c.op === "upsert")!;
    expect(up.payload).toMatchObject({ mp_payment_id: "555", monto: 900 });
  });

  it("si la API de Mercado Pago falla responde 200 igual (decisión: evitar reintentos en bucle) y no marca nada", async () => {
    conToken();
    const f = base(() => undefined);
    mp(null, 500);
    expect((await pedir("type=payment&data.id=123")).status).toBe(200);
    expect(f.calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  // H-11: data.id se interpola tal cual en la URL de la API con nuestro token: "../" apunta a otros endpoints.
  it.fails("rechaza un data.id no numérico sin llamar a la API", async () => {
    conToken();
    base(() => undefined);
    const fetchMock = mp(aprobado);
    await pedir("type=payment&data.id=" + encodeURIComponent("../users/me"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // H-11: el monto pagado nunca se compara con el de la orden.
  it.fails("no marca 'pagado' una orden si el monto cobrado es distinto al de la orden", async () => {
    conToken();
    const f = base((q) => {
      if (q.op === "select" && q.table === "mercadopago_qr_orders") return { data: { monto: 15000, estado: "pendiente" } };
      if (q.op === "update") return { data: [{ id: "o1", pedido_id: null }] };
    });
    mp({ ...aprobado, transaction_amount: 1 });
    await pedir("type=payment&data.id=123");
    expect(f.calls.filter((c) => c.table === "mercadopago_qr_orders" && c.op === "update" && c.payload?.estado === "pagado")).toHaveLength(0);
  });
});

// ───────────────────────── WhatsApp ─────────────────────────
describe("webhook de WhatsApp", () => {
  const SECRET = "app-secret-test";
  const firmar = (body: string, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const mensaje = (over: Record<string, unknown> = {}) => JSON.stringify({
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "pn1" },
      contacts: [{ profile: { name: "Ana" }, wa_id: "5493764000000" }],
      messages: [{ id: "wamid.1", from: "5493764000000", type: "text", text: { body: "hola, tienen pan?" }, ...over }],
    } }] }],
  });
  const post = (body: string, headers: Record<string, string> = {}) =>
    waPOST(new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", body, headers }));

  function base(opts: { sucursal?: Record<string, unknown> | null; eventoError?: { code: string } } = {}) {
    const f = fakeAdmin((q: Q) => {
      if (q.table === "sucursales") return { data: opts.sucursal === undefined ? { id: "s1", is_active: true, mercadopago_pos_id: null } : opts.sucursal };
      if (q.table === "whatsapp_webhook_events" && q.op === "insert") return opts.eventoError ? { error: opts.eventoError } : { data: { id: "e1" } };
      if (q.table === "contactos_crm" && q.op === "insert") return { data: { id: "c1" } };
    });
    h.admin = f.admin;
    return f;
  }

  describe("GET (handshake de Meta)", () => {
    const get = (qs: string) => waGET(new Request(`http://localhost/api/webhooks/whatsapp?${qs}`));

    it("sin WHATSAPP_VERIFY_TOKEN responde 501", async () => {
      delete process.env.WHATSAPP_VERIFY_TOKEN;
      expect((await get("hub.mode=subscribe&hub.verify_token=x&hub.challenge=1")).status).toBe(501);
    });
    it("token correcto devuelve el challenge tal cual; incorrecto o modo distinto, 403", async () => {
      process.env.WHATSAPP_VERIFY_TOKEN = "verif";
      const ok = await get("hub.mode=subscribe&hub.verify_token=verif&hub.challenge=abc123");
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe("abc123");
      expect((await get("hub.mode=subscribe&hub.verify_token=mal&hub.challenge=abc")).status).toBe(403);
      expect((await get("hub.mode=unsubscribe&hub.verify_token=verif&hub.challenge=abc")).status).toBe(403);
      expect((await get("hub.mode=subscribe&hub.verify_token=verif")).status).toBe(403); // sin challenge
    });
  });

  describe("POST (firma HMAC)", () => {
    beforeEach(() => { process.env.WHATSAPP_APP_SECRET = SECRET; });

    it("sin WHATSAPP_APP_SECRET responde 501", async () => {
      delete process.env.WHATSAPP_APP_SECRET;
      const f = base();
      expect((await post(mensaje(), { "x-hub-signature-256": firmar(mensaje()) })).status).toBe(501);
      expect(f.calls).toHaveLength(0);
    });

    it("sin firma, con firma de otro secret o con el body alterado: 401 y no se guarda nada", async () => {
      const f = base();
      const body = mensaje();
      expect((await post(body)).status).toBe(401);
      expect((await post(body, { "x-hub-signature-256": firmar(body, "otro-secret") })).status).toBe(401);
      expect((await post(body + " ", { "x-hub-signature-256": firmar(body) })).status).toBe(401);
      expect((await post(body, { "x-hub-signature-256": "sha256=abc" })).status).toBe(401);
      expect((await post(body, { "x-hub-signature-256": firmar(body).replace("sha256=", "md5=") })).status).toBe(401);
      expect(f.calls).toHaveLength(0);
    });

    it("firma válida pero JSON inválido: 400", async () => {
      base();
      const body = "esto no es json";
      expect((await post(body, { "x-hub-signature-256": firmar(body) })).status).toBe(400);
    });
  });

  describe("POST (mensajes)", () => {
    beforeEach(() => { process.env.WHATSAPP_APP_SECRET = SECRET; });
    const enviar = (body: string) => post(body, { "x-hub-signature-256": firmar(body) });

    it("un mensaje firmado crea el evento de auditoría y el contacto en el CRM de la sucursal mapeada", async () => {
      const f = base();
      expect((await enviar(mensaje())).status).toBe(200);
      const ev = f.calls.find((c) => c.table === "whatsapp_webhook_events" && c.op === "insert")!;
      expect(ev.payload).toMatchObject({ wa_message_id: "wamid.1", phone_number_id: "pn1", sucursal_id: "s1", status: "processed" });
      const c = f.calls.find((x) => x.table === "contactos_crm" && x.op === "insert")!;
      expect(c.payload).toMatchObject({ sucursal_id: "s1", canal: "whatsapp", nombre_contacto: "Ana", consulta_mensaje: "hola, tienen pan?", estado: "nuevo" });
    });

    it("mapea la sucursal por el phone_number_id que recibió el mensaje", async () => {
      const f = base();
      await enviar(mensaje());
      const q = f.calls.find((c) => c.table === "sucursales")!;
      expect(eqDe(q, "whatsapp_phone_number_id")).toBe("pn1");
    });

    it("reintento de Meta (mismo wa_message_id, error 23505): NO duplica el contacto", async () => {
      const f = base({ eventoError: { code: "23505" } });
      expect((await enviar(mensaje())).status).toBe(200);
      expect(f.calls.some((c) => c.table === "contactos_crm")).toBe(false);
    });

    it("número no mapeado a ninguna sucursal: queda el evento como 'sin_sucursal' y no hay contacto", async () => {
      const f = base({ sucursal: null });
      await enviar(mensaje());
      expect(f.calls.find((c) => c.table === "whatsapp_webhook_events" && c.op === "insert")!.payload.status).toBe("sin_sucursal");
      expect(f.calls.some((c) => c.table === "contactos_crm")).toBe(false);
    });

    it("los avisos de estado (entregado/leído) no son mensajes: no se guarda nada", async () => {
      const f = base();
      const body = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "pn1" }, statuses: [{ id: "x", status: "read" }] } }] }] });
      expect((await enviar(body)).status).toBe(200);
      expect(f.calls).toHaveLength(0);
    });

    it("un botón tocado se registra con su título, no como '[interactive]'", async () => {
      const f = base();
      await enviar(mensaje({ type: "interactive", text: undefined, interactive: { button_reply: { id: "b1", title: "Ver menú" } } }));
      expect(f.calls.find((c) => c.table === "contactos_crm")!.payload.consulta_mensaje).toBe("[Ver menú]");
    });

    it("sin mercadopago_pos_id la sucursal NO dispara el bot (solo registra el contacto)", async () => {
      const f = base({ sucursal: { id: "s1", is_active: true, mercadopago_pos_id: null } });
      await enviar(mensaje());
      expect(f.calls.some((c) => c.table === "pedidos")).toBe(false);
    });
  });
});
