import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

// Mercado Pago por sucursal (migración 134): un local independiente cobra con SU cuenta y la plata nunca debe
// caer en la cuenta de IDEIA. Se prueba el cifrado, qué credenciales usa cada sucursal, las acciones del dueño
// y el aviso de pago (webhook).

const MIA = "11111111-1111-4111-8111-111111111111";   // local independiente
const IDEIA = "22222222-2222-4222-8222-222222222222"; // kiosco de IDEIA

const h = vi.hoisted(() => ({ session: { userId: "u1", role: "concesionario" }, admin: null as any }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireStaff: async () => h.session }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin }));

import { cifrar, descifrar, credencialesDeSucursal } from "@/lib/mercadopago/credenciales";
import { conectarMercadoPago, elegirCajaMercadoPago, desconectarMercadoPago } from "@/app/(admin)/admin/mi-mercadopago/actions";
import { POST } from "@/app/api/webhooks/mercadopago/route";
import { NextRequest } from "next/server";

const ENV0 = { ...process.env };
const fetch0 = globalThis.fetch;
beforeEach(() => {
  process.env.MP_CREDENCIALES_KEY = "clave-de-prueba";
  process.env.MERCADOPAGO_ACCESS_TOKEN = "APP_USR-token-ideia-0000000000";
  process.env.MERCADOPAGO_USER_ID = "999";
  h.session = { userId: "u1", role: "concesionario" };
});
afterEach(() => { process.env = { ...ENV0 }; globalThis.fetch = fetch0; });

describe("cifrado de credenciales", () => {
  it("ida y vuelta, y no queda en claro", async () => {
    const c = await cifrar("APP_USR-secreto", "k");
    expect(c).not.toContain("APP_USR-secreto");
    expect(await descifrar(c, "k")).toBe("APP_USR-secreto");
  });
  it("con otra clave o alterado no se puede leer", async () => {
    const c = await cifrar("APP_USR-secreto", "k");
    await expect(descifrar(c, "otra")).rejects.toThrow();
    const [iv, ct] = c.split(".");
    await expect(descifrar(`${iv}.${ct.slice(0, -4)}AAAA`, "k")).rejects.toThrow();
  });
  it("dos cifrados del mismo texto son distintos (iv aleatorio)", async () => {
    expect(await cifrar("x", "k")).not.toBe(await cifrar("x", "k"));
  });
});

describe("credencialesDeSucursal", () => {
  function mundo(opts: { fila?: { access_token_cifrado: string; mp_user_id: string } | null; independiente: boolean }) {
    return fakeAdmin((q: Q) => {
      if (q.table === "sucursal_mercadopago") return { data: opts.fila ?? null };
      if (q.table === "sucursales") return { data: { catalogo_propio: opts.independiente } };
      return { data: null };
    });
  }

  it("un kiosco de IDEIA usa las credenciales de IDEIA", async () => {
    const f = mundo({ independiente: false });
    const c = await credencialesDeSucursal(f.admin, IDEIA);
    expect(c).toMatchObject({ accessToken: "APP_USR-token-ideia-0000000000", userId: "999", propia: false });
  });

  it("un local independiente SIN su cuenta cargada NO cae a la cuenta de IDEIA", async () => {
    const f = mundo({ independiente: true });
    expect(await credencialesDeSucursal(f.admin, MIA)).toBeNull();
  });

  it("un local independiente con su cuenta usa SU token y su usuario", async () => {
    const cifrado = await cifrar("APP_USR-token-del-dueno", "clave-de-prueba");
    const f = mundo({ independiente: true, fila: { access_token_cifrado: cifrado, mp_user_id: "555" } });
    expect(await credencialesDeSucursal(f.admin, MIA)).toEqual({ accessToken: "APP_USR-token-del-dueno", userId: "555", propia: true });
  });

  it("si no se puede descifrar, devuelve null (no usa la de IDEIA)", async () => {
    const cifrado = await cifrar("APP_USR-token-del-dueno", "otra-clave");
    const f = mundo({ independiente: true, fila: { access_token_cifrado: cifrado, mp_user_id: "555" } });
    expect(await credencialesDeSucursal(f.admin, MIA)).toBeNull();
  });
});

describe("acciones del dueño (Mi Mercado Pago)", () => {
  function armar(propia: string | null = MIA) {
    const f = fakeAdmin((q: Q) => {
      if (q.table === "sucursales" && q.op === "select") {
        if (q.filters.some((x) => x.col === "encargado_user_id")) return { data: propia ? { id: propia } : null };
        return { data: { catalogo_propio: true } };
      }
      return { data: null };
    });
    h.admin = f.admin;
    return f;
  }
  const mpResponde = (json: unknown, ok = true, status = 200) => {
    const m = vi.fn(async () => ({ ok, status, json: async () => json, text: async () => "" }) as unknown as Response);
    globalThis.fetch = m as unknown as typeof fetch;
    return m;
  };
  const TOKEN = "APP_USR-1234567890123456-110512-abcdef0123456789abcdef0123456789-2987654321";

  it("conecta la cuenta: verifica el token, lo guarda CIFRADO y limpia la Caja anterior", async () => {
    const f = armar();
    mpResponde({ id: 555, nickname: "KIOSCO_DUENO" });
    const r = await conectarMercadoPago(TOKEN);
    expect(r).toEqual({ cuenta: "KIOSCO_DUENO" });
    const up = f.calls.find((c: Q) => c.table === "sucursal_mercadopago" && c.op === "upsert")!;
    const fila = up.payload as Record<string, string>;
    expect(fila.sucursal_id).toBe(MIA);
    expect(fila.mp_user_id).toBe("555");
    expect(fila.access_token_cifrado).not.toContain(TOKEN);
    expect(await descifrar(fila.access_token_cifrado, "clave-de-prueba")).toBe(TOKEN);
    const limpia = f.calls.find((c: Q) => c.table === "sucursales" && c.op === "update")!;
    expect(limpia.payload).toEqual({ mercadopago_pos_id: null });
  });

  it("rechaza el token de la cuenta de IDEIA", async () => {
    const f = armar();
    mpResponde({ id: 999, nickname: "IDEIA" });
    const r = await conectarMercadoPago(TOKEN);
    expect(r.error).toMatch(/cuenta de IDEIA/);
    expect(f.calls.some((c: Q) => c.table === "sucursal_mercadopago" && c.op === "upsert")).toBe(false);
  });

  it("un token que Mercado Pago no reconoce no se guarda", async () => {
    const f = armar();
    mpResponde({}, false, 401);
    const r = await conectarMercadoPago(TOKEN);
    expect(r.error).toMatch(/no reconoce/);
    expect(f.calls.some((c: Q) => c.op === "upsert")).toBe(false);
  });

  it("un token con formato raro ni siquiera sale a Mercado Pago", async () => {
    armar();
    const m = mpResponde({ id: 1 });
    const r = await conectarMercadoPago("hola ../x");
    expect(r.error).toMatch(/No parece un Access Token/);
    expect(m).not.toHaveBeenCalled();
  });

  it("quien no es dueño de un local independiente no puede", async () => {
    armar(null);
    expect((await conectarMercadoPago(TOKEN)).error).toBe("Sin permisos");
    h.session = { userId: "u2", role: "vendedor" };
    expect((await desconectarMercadoPago()).error).toBe("Sin permisos");
  });

  it("el dueño solo toca SU sucursal aunque el cliente mande otro id", async () => {
    const f = armar(MIA);
    mpResponde({ id: 555, nickname: "X" });
    await conectarMercadoPago(TOKEN, IDEIA);
    const up = f.calls.find((c: Q) => c.table === "sucursal_mercadopago" && c.op === "upsert")!;
    expect((up.payload as Record<string, string>).sucursal_id).toBe(MIA);
  });

  it("un admin tiene que indicar la sucursal y esta tiene que ser independiente", async () => {
    h.session = { userId: "adm", role: "admin" };
    armar();
    expect((await conectarMercadoPago(TOKEN)).error).toMatch(/Falta indicar la sucursal/);
    const f = fakeAdmin((q: Q) => (q.table === "sucursales" ? { data: { catalogo_propio: false } } : { data: null }));
    h.admin = f.admin;
    expect((await conectarMercadoPago(TOKEN, IDEIA)).error).toMatch(/no es un local independiente/);
  });

  it("solo deja elegir una Caja que existe en SU cuenta", async () => {
    const cifrado = await cifrar("APP_USR-token-del-dueno", "clave-de-prueba");
    const f = fakeAdmin((q: Q) => {
      if (q.table === "sucursal_mercadopago") return { data: { access_token_cifrado: cifrado, mp_user_id: "555" } };
      if (q.table === "sucursales" && q.op === "select") {
        if (q.filters.some((x) => x.col === "encargado_user_id")) return { data: { id: MIA } };
        return { data: { catalogo_propio: true } };
      }
      return { data: null };
    });
    h.admin = f.admin;
    mpResponde({ results: [{ id: 1, external_id: "CAJADUENO1", name: "Caja", store_id: 1 }] });
    expect((await elegirCajaMercadoPago("CAJADEIDEIA")).error).toMatch(/no existe en tu cuenta/);
    expect(f.calls.some((c: Q) => c.table === "sucursales" && c.op === "update")).toBe(false);
    expect(await elegirCajaMercadoPago("CAJADUENO1")).toEqual({});
    const upd = f.calls.find((c: Q) => c.table === "sucursales" && c.op === "update")!;
    expect(upd.payload).toEqual({ mercadopago_pos_id: "CAJADUENO1" });
  });
});

describe("aviso de pago (webhook)", () => {
  function pedir(qs: string, body: unknown = { type: "payment", data: { id: "777" } }) {
    return POST(new NextRequest(`http://localhost/api/webhooks/mercadopago${qs}`, { method: "POST", body: JSON.stringify(body) }));
  }

  it("con ?s= de un local con cuenta propia, confirma el pago con SU token (no el de IDEIA)", async () => {
    const cifrado = await cifrar("APP_USR-token-del-dueno", "clave-de-prueba");
    const f = fakeAdmin((q: Q) => {
      if (q.table === "sucursal_mercadopago") return { data: { access_token_cifrado: cifrado, mp_user_id: "555" } };
      if (q.table === "mercadopago_qr_orders" && q.op === "select") return { data: { sucursal_id: MIA, monto: 1000, estado: "pendiente" } };
      if (q.table === "mercadopago_qr_orders" && q.op === "update") return { data: [{ id: "o1", pedido_id: null }] };
      return { data: null };
    });
    h.admin = f.admin;
    const m = vi.fn(async () => ({ ok: true, json: async () => ({ status: "approved", transaction_amount: 1000, external_reference: "ref1" }) }) as unknown as Response);
    globalThis.fetch = m as unknown as typeof fetch;
    await pedir(`?s=${MIA}`);
    const [url, init] = m.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/v1/payments/777");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer APP_USR-token-del-dueno");
    expect(f.calls.some((c: Q) => c.table === "mercadopago_qr_orders" && c.op === "update")).toBe(true);
  });

  it("un aviso con ?s= de una sucursal SIN cuenta propia se ignora (no usa el token de IDEIA)", async () => {
    const f = fakeAdmin((q: Q) => (q.table === "sucursales" ? { data: { catalogo_propio: false } } : { data: null }));
    h.admin = f.admin;
    const m = vi.fn();
    globalThis.fetch = m as unknown as typeof fetch;
    const r = await pedir(`?s=${IDEIA}`);
    expect(r.status).toBe(200);
    expect(m).not.toHaveBeenCalled();
  });

  it("un ?s= que no es un uuid se ignora sin tocar nada", async () => {
    h.admin = fakeAdmin(() => ({ data: null })).admin;
    const m = vi.fn();
    globalThis.fetch = m as unknown as typeof fetch;
    expect((await pedir("?s=../../x")).status).toBe(200);
    expect(m).not.toHaveBeenCalled();
  });

  it("con ?s=, un pago que referencia la orden de OTRA sucursal no la confirma", async () => {
    const cifrado = await cifrar("APP_USR-token-del-dueno", "clave-de-prueba");
    const f = fakeAdmin((q: Q) => {
      if (q.table === "sucursal_mercadopago") return { data: { access_token_cifrado: cifrado, mp_user_id: "555" } };
      if (q.table === "mercadopago_qr_orders" && q.op === "select") return { data: { sucursal_id: IDEIA, monto: 1000, estado: "pendiente" } };
      return { data: null };
    });
    h.admin = f.admin;
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ status: "approved", transaction_amount: 1000, external_reference: "ref-ideia" }) }) as unknown as Response) as unknown as typeof fetch;
    await pedir(`?s=${MIA}`);
    expect(f.calls.some((c: Q) => c.op === "update" || c.op === "upsert")).toBe(false);
  });

  it("una transferencia a la cuenta del local queda marcada con SU sucursal", async () => {
    const cifrado = await cifrar("APP_USR-token-del-dueno", "clave-de-prueba");
    const f = fakeAdmin((q: Q) => {
      if (q.table === "sucursal_mercadopago") return { data: { access_token_cifrado: cifrado, mp_user_id: "555" } };
      return { data: null };
    });
    h.admin = f.admin;
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ status: "approved", transaction_amount: 1500, external_reference: null, payment_type_id: "bank_transfer" }) }) as unknown as Response) as unknown as typeof fetch;
    await pedir(`?s=${MIA}`);
    const up = f.calls.find((c: Q) => c.table === "mercadopago_transferencias_recibidas" && c.op === "upsert")!;
    expect((up.payload as Record<string, unknown>).sucursal_id).toBe(MIA);
  });
});

import { cuentaDelToken } from "@/lib/mercadopago/pos";

describe("cuentaDelToken", () => {
  const TOKEN = "APP_USR-1234567890123456-110512-abcdef0123456789abcdef0123456789-2987654321";
  const resp = (status: number, json: unknown = {}) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) }) as unknown as Response;
  const mockFetch = (porUrl: Record<string, Response>) => {
    const m = vi.fn(async (url: string) => porUrl[Object.keys(porUrl).find((k) => url.includes(k))!]);
    globalThis.fetch = m as unknown as typeof fetch;
    return m;
  };

  it("usa /users/me cuando anda", async () => {
    mockFetch({ "/users/me": resp(200, { id: 555, nickname: "DUENO" }) });
    expect(await cuentaDelToken(TOKEN)).toEqual({ userId: "555", cuenta: "DUENO" });
  });

  it("si /users/me da 403 (app de QR sin ese permiso) verifica con las Cajas y toma el usuario de la Caja", async () => {
    mockFetch({ "/users/me": resp(403), "/pos": resp(200, { results: [{ user_id: 777 }] }) });
    expect(await cuentaDelToken(TOKEN)).toMatchObject({ userId: "777" });
  });

  it("si /users/me da 403 y todavía no hay Cajas, el usuario sale del final del token", async () => {
    mockFetch({ "/users/me": resp(403), "/pos": resp(200, { results: [] }) });
    expect(await cuentaDelToken(TOKEN)).toMatchObject({ userId: "2987654321" });
  });

  it("un token que Mercado Pago no reconoce (401) se rechaza", async () => {
    mockFetch({ "/users/me": resp(401) });
    expect((await cuentaDelToken(TOKEN)).error).toMatch(/no reconoce/);
  });

  it("si las dos consultas dan 403 explica que el token no fue aceptado", async () => {
    mockFetch({ "/users/me": resp(403), "/pos": resp(403, { message: "Forbidden por policy" }) });
    const r = await cuentaDelToken(TOKEN);
    expect(r.error).toMatch(/403/);
    expect(r.error).toMatch(/no aceptó ese token/);
  });
});

describe("formato del Access Token al conectar", () => {
  beforeEach(() => {
    h.admin = fakeAdmin((q: Q) => (q.table === "sucursales" && q.op === "select" ? { data: { id: MIA } } : { data: null })).admin;
  });
  it("rechaza la Public Key, el token de prueba y cosas que no son un token, sin salir a Mercado Pago", async () => {
    const m = vi.fn();
    globalThis.fetch = m as unknown as typeof fetch;
    expect((await conectarMercadoPago("APP_USR-1a2b3c4d-1234-5678-9abc-def012345678")).error).toMatch(/Public Key/);
    expect((await conectarMercadoPago("TEST-1234567890123456-110512-abcdef0123456789abcdef0123456789-2987654321")).error).toMatch(/prueba/);
    expect((await conectarMercadoPago("TOKEN")).error).toMatch(/No parece un Access Token/);
    expect(m).not.toHaveBeenCalled();
  });
});
