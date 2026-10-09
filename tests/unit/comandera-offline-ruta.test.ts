import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { CatalogoComandera } from "@/lib/comandera-offline/catalogo";

// Ruta de descarga de la comandera offline: solo staff con acceso a la sucursal.

const h = vi.hoisted(() => ({ user: null as any, acceso: null as string | null, catalogo: null as CatalogoComandera | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
  createAdminClient: () => ({}),
}));
vi.mock("@/lib/auth/sucursal-access", () => ({ requireSucursalAccess: async () => h.acceso }));
vi.mock("@/lib/comandera-offline/catalogo", async (orig) => ({ ...(await orig<typeof import("@/lib/comandera-offline/catalogo")>()), cargarCatalogoComandera: async () => h.catalogo }));

import { GET, POST } from "@/app/api/comandera-offline/route";

const catalogo = (): CatalogoComandera => ({
  sucursalId: "s1", sucursalNombre: "Villa Sarita", titulo: "Villa Sarita", clave: "s1", generado: "2026-10-01T12:00:00Z", omitidosPorKg: [],
  categorias: [{ id: "c1", nombre: "MINUTAS", items: [{ id: "p1", nombre: "Empanada Carne", precio: 2300 }] }],
});
const pedir = (qs = "?sucursal_id=s1") => GET(new NextRequest("http://localhost/api/comandera-offline" + qs));

describe("GET /api/comandera-offline", () => {
  beforeEach(() => {
    h.user = { id: "u1", app_metadata: { role: "concesionario" } };
    h.acceso = null;
    h.catalogo = catalogo();
  });

  it("sin sesión: 401", async () => {
    h.user = null;
    expect((await pedir()).status).toBe(401);
  });
  it("sin sucursal_id: 400", async () => {
    expect((await pedir("")).status).toBe(400);
  });
  it("sin acceso a la sucursal: 403", async () => {
    h.acceso = "No tenés permisos para esta sucursal";
    expect((await pedir()).status).toBe(403);
  });
  it("sucursal inexistente: 404; sin productos: 422", async () => {
    h.catalogo = null;
    expect((await pedir()).status).toBe(404);
    h.catalogo = { ...catalogo(), categorias: [] };
    expect((await pedir()).status).toBe(422);
  });
  it("con acceso: descarga el HTML como adjunto", async () => {
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain('filename="comandera-villa-sarita.html"');
    expect(await res.text()).toContain("Empanada Carne");
  });
});

describe("POST /api/comandera-offline (modo evento)", () => {
  const enviar = (campos: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(campos)) fd.set(k, v);
    return POST(new NextRequest("http://localhost/api/comandera-offline", { method: "POST", body: fd }));
  };
  beforeEach(() => {
    h.user = { id: "u1", app_metadata: { role: "admin" } };
    h.acceso = null;
    h.catalogo = catalogo();
  });

  it("descarga el archivo con el nombre del evento y solo los productos elegidos", async () => {
    const res = await enviar({ sucursal_id: "s1", evento: "Fiesta Villa Sarita", ids: JSON.stringify(["p1"]) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("comandera-fiesta-villa-sarita.html");
    const html = await res.text();
    expect(html).toContain("Fiesta Villa Sarita");
    expect(html).toContain("Empanada Carne");
  });
  it("el stock cargado viaja dentro del archivo; uno inválido da 400 y el de un producto no elegido se ignora", async () => {
    const ok = await enviar({ sucursal_id: "s1", evento: "X", ids: JSON.stringify(["p1"]), stock: JSON.stringify({ p1: 50, otro: 7 }) });
    expect(ok.status).toBe(200);
    const html = await ok.text();
    expect(html).toContain('"stock":50');
    expect(html).not.toContain('"stock":7');
    expect((await enviar({ sucursal_id: "s1", evento: "X", ids: "[\"p1\"]", stock: "{\"p1\":-1}" })).status).toBe(400);
    expect((await enviar({ sucursal_id: "s1", evento: "X", ids: "[\"p1\"]", stock: "{\"p1\":\"5\"}" })).status).toBe(400);
  });
  it("sin sesión: 401; sin acceso: 403", async () => {
    h.user = null;
    expect((await enviar({ sucursal_id: "s1", evento: "X", ids: "[\"p1\"]" })).status).toBe(401);
    h.user = { id: "u1", app_metadata: { role: "vendedor" } };
    h.acceso = "No tenés permisos para esta sucursal";
    expect((await enviar({ sucursal_id: "s1", evento: "X", ids: "[\"p1\"]" })).status).toBe(403);
  });
  it("sin nombre de evento: 400; ids mal formados: 400; ningún producto elegido: 422", async () => {
    expect((await enviar({ sucursal_id: "s1", evento: "  ", ids: "[\"p1\"]" })).status).toBe(400);
    expect((await enviar({ sucursal_id: "s1", evento: "X", ids: "no-es-json" })).status).toBe(400);
    expect((await enviar({ sucursal_id: "s1", evento: "X", ids: "{\"a\":1}" })).status).toBe(400);
    expect((await enviar({ sucursal_id: "s1", evento: "X", ids: "[]" })).status).toBe(422);
  });
});
