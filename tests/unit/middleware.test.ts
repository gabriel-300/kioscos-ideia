import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Contención por rol de middleware.ts. No es la única barrera (cada Server
// Action y cada página verifican por su cuenta), pero es lo que confina al
// repartidor y a los roles de bajo privilegio.

const h = vi.hoisted(() => ({ user: null as any }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}));

import { updateSession } from "@/lib/supabase/middleware";

beforeEach(() => {
  h.user = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
});

const como = (role: string | undefined) => { h.user = { id: "u1", app_metadata: role ? { role } : {} }; };
async function ir(path: string) {
  const res = await updateSession(new NextRequest(`http://localhost${path}`));
  const loc = res.headers.get("location");
  return { redirige: loc ? new URL(loc).pathname : null, status: res.status };
}

describe("/admin exige un rol de staff", () => {
  it("sin sesión -> /login", async () => {
    expect((await ir("/admin/dashboard")).redirige).toBe("/login");
  });
  it("con sesión pero sin rol (ej. una cuenta creada por el signup público) -> /login", async () => {
    como(undefined);
    expect((await ir("/admin/dashboard")).redirige).toBe("/login");
  });
  it("rol desconocido o de otra app -> /login", async () => {
    for (const r of ["customer_b2c", "admin_enminutas", "ADMIN"]) {
      como(r);
      expect((await ir("/admin/stock")).redirige).toBe("/login");
    }
  });
  it("cada rol de staff entra al dashboard", async () => {
    for (const r of ["admin", "encargado", "vendedor", "concesionario"]) {
      como(r);
      expect((await ir("/admin/dashboard")).redirige).toBeNull();
    }
  });
});

describe("rutas solo de admin", () => {
  const soloAdmin = ["/admin/categorias", "/admin/staff", "/admin/movimientos", "/admin/productos", "/admin/pedidos-online/configuracion"];

  it("encargado, vendedor y concesionario rebotan al dashboard", async () => {
    for (const r of ["encargado", "vendedor", "concesionario"]) {
      como(r);
      for (const p of soloAdmin) expect((await ir(p)).redirige, `${r} en ${p}`).toBe("/admin/dashboard");
    }
  });
  it("también las subrutas (prefijo)", async () => {
    como("vendedor");
    expect((await ir("/admin/productos/123/editar")).redirige).toBe("/admin/dashboard");
  });
  it("el admin entra a todas", async () => {
    como("admin");
    for (const p of soloAdmin) expect((await ir(p)).redirige).toBeNull();
  });
  it("/admin/pedidos-online (sin /configuracion) sí lo ve el staff de la sucursal", async () => {
    como("encargado");
    expect((await ir("/admin/pedidos-online")).redirige).toBeNull();
  });
});

describe("pronóstico: encargado sí, vendedor no", () => {
  it("vendedor -> dashboard; encargado y concesionario entran", async () => {
    como("vendedor");
    expect((await ir("/admin/pronostico")).redirige).toBe("/admin/dashboard");
    for (const r of ["encargado", "concesionario", "admin"]) {
      como(r);
      expect((await ir("/admin/pronostico")).redirige).toBeNull();
    }
  });
});

describe("repartidor: contención total a /admin/repartos", () => {
  it("cualquier otra ruta del admin lo manda a su cola", async () => {
    como("repartidor");
    for (const p of ["/admin/dashboard", "/admin/staff", "/admin/pedidos-online", "/admin/sucursales/abc", "/admin/tesoreria", "/admin"]) {
      expect((await ir(p)).redirige, p).toBe("/admin/repartos");
    }
  });
  it("/admin/repartos pasa", async () => {
    como("repartidor");
    expect((await ir("/admin/repartos")).redirige).toBeNull();
  });
  it("logueado en una página pública lo lleva a /admin/repartos (no al dashboard)", async () => {
    como("repartidor");
    expect((await ir("/")).redirige).toBe("/admin/repartos");
  });
});

describe("staff logueado en páginas públicas", () => {
  it("lo redirige a su panel, salvo /auth, /login, /api y /pedir (el admin puede mirar el storefront)", async () => {
    como("vendedor");
    expect((await ir("/")).redirige).toBe("/admin/dashboard");
    for (const p of ["/pedir/parque", "/api/export/movimientos", "/login", "/auth/set-password"]) {
      expect((await ir(p)).redirige, p).toBeNull();
    }
  });
  it("un visitante anónimo ve las páginas públicas y el storefront", async () => {
    for (const p of ["/", "/login", "/pedir/parque"]) expect((await ir(p)).redirige, p).toBeNull();
  });
  it("una sesión sin rol de staff no se redirige al admin desde la home", async () => {
    como(undefined);
    expect((await ir("/")).redirige).toBeNull();
  });
});

describe("sin variables de Supabase", () => {
  it("/admin va a /login (no deja pasar por error de configuración)", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect((await ir("/admin/dashboard")).redirige).toBe("/login");
  });
});
