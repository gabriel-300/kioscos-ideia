import { test, expect } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// `test.fail(...)` = hallazgo de auditoría conocido: la aserción describe el
// comportamiento CORRECTO y hoy falla. Cuando se corrija el hallazgo el test
// "pasa de forma inesperada" y Playwright avisa para que se saque el .fail.

test.describe("contención de rutas y endpoints sin credenciales", () => {
  test("/admin/* sin sesión redirige a /login", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("/admin/staff y /admin/cierres sin sesión también redirigen", async ({ page }) => {
    for (const ruta of ["/admin/staff", "/admin/cierres", "/admin/tesoreria", "/admin/repartos"]) {
      await page.goto(ruta);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("/api/export/movimientos sin sesión -> 401", async ({ request }) => {
    const r = await request.get("/api/export/movimientos");
    expect(r.status()).toBe(401);
  });

  test("webhooks y endpoints con token no aceptan requests sin credencial", async ({ request }) => {
    const pedidoya = await request.post("/api/webhooks/pedidoya", { data: { orderId: "x" } });
    expect([401, 501]).toContain(pedidoya.status());
    const wa = await request.post("/api/webhooks/whatsapp", { data: { entry: [] } });
    expect([401, 501]).toContain(wa.status());
    const repo = await request.get("/api/reposicion-hoy");
    expect([401, 501]).toContain(repo.status());
  });

  test("webhook de WhatsApp: verificación GET con token incorrecto -> 403/501", async ({ request }) => {
    const r = await request.get("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=incorrecto&hub.challenge=abc");
    expect([403, 501]).toContain(r.status());
  });
});

test.describe("storefront público", () => {
  test("/pedir/<sucursal inexistente> no rompe (sin 500)", async ({ request }) => {
    const r = await request.get("/pedir/00000000-0000-0000-0000-000000000000");
    expect(r.status()).toBeLessThan(500);
  });
});

test.describe("hallazgos de auditoría (los que siguen con test.fail están abiertos; los demás son guardias de regresión)", () => {
  // Corregido el 19/09/2026 (CRON_SECRET cargado + el endpoint falla cerrado): guardia de regresión.
  test("/api/ping no acepta 'Bearer undefined' (falla abierto si falta CRON_SECRET)", async ({ request }) => {
    const r = await request.get("/api/ping", { headers: { authorization: "Bearer undefined" } });
    expect(r.status()).toBe(401);
  });

  // Corregido el 19/09/2026 (la ruta responde 410): guardia de regresión.
  test("el registro público /api/auth/registro está deshabilitado", async ({ request }) => {
    // Body inválido a propósito: NO crea ningún usuario.
    const r = await request.post("/api/auth/registro", { data: { email: "no-es-un-email" } });
    expect([404, 410, 401, 403]).toContain(r.status());
  });

  test.fail("respuestas con cabeceras de seguridad (clickjacking / sniffing)", async ({ request }) => {
    const r = await request.get("/login");
    const h = r.headers();
    expect(h["x-frame-options"] ?? h["content-security-policy"]).toBeTruthy();
    expect(h["x-content-type-options"]).toBe("nosniff");
  });

  // Corregido con la migración 095 (aplicada el 19/09/2026): ahora es una guardia de regresión.
  test("el bucket 'remitos' no se puede listar sin sesión", async ({ request }) => {
    test.skip(!SUPABASE_URL || !ANON_KEY, "faltan NEXT_PUBLIC_SUPABASE_URL / ANON_KEY (.env.local)");
    const r = await request.post(`${SUPABASE_URL}/storage/v1/object/list/remitos`, {
      headers: { apikey: ANON_KEY!, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
      data: { prefix: "", limit: 1 },
    });
    const filas = r.ok() ? await r.json() : [];
    expect(Array.isArray(filas) ? filas.length : 0).toBe(0);
  });
});

test.describe("RLS: la anon key no lee datos de negocio", () => {
  const TABLAS = ["movimientos", "movimiento_items", "profiles", "product_prices", "pedidos", "sucursales", "cierres_caja", "aperturas_caja", "mercadopago_qr_orders", "contactos_crm"];
  for (const tabla of TABLAS) {
    test(`anon no ve filas de ${tabla}`, async ({ request }) => {
      test.skip(!SUPABASE_URL || !ANON_KEY, "faltan NEXT_PUBLIC_SUPABASE_URL / ANON_KEY (.env.local)");
      const r = await request.get(`${SUPABASE_URL}/rest/v1/${tabla}?select=*&limit=1`, { headers: { apikey: ANON_KEY!, Authorization: `Bearer ${ANON_KEY}` } });
      const cuerpo = r.ok() ? await r.json() : [];
      expect(Array.isArray(cuerpo) ? cuerpo.length : 0).toBe(0);
    });
  }
  test("anon no puede ejecutar los RPC de dinero", async ({ request }) => {
    test.skip(!SUPABASE_URL || !ANON_KEY, "faltan NEXT_PUBLIC_SUPABASE_URL / ANON_KEY (.env.local)");
    for (const fn of ["crear_movimiento_con_items", "cerrar_caja", "abrir_caja", "prestar_termo", "devolver_termo", "confirmar_transferencia_stock"]) {
      const r = await request.post(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { headers: { apikey: ANON_KEY!, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" }, data: {} });
      expect(r.ok(), `rpc ${fn}`).toBe(false);
    }
  });
});
