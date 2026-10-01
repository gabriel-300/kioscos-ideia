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

const como = (role: string | undefined, sistemas?: unknown) => {
  h.user = { id: "u1", app_metadata: { ...(role ? { role } : {}), ...(sistemas !== undefined ? { sistemas } : {}) } };
};
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
  const soloAdmin = ["/admin/categorias", "/admin/staff", "/admin/movimientos", "/admin/productos"];

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
  it("/tenteo/pedidos (sin /configuracion) sí lo ve el staff de la sucursal con Tenteo", async () => {
    como("encargado", ["tenteo"]);
    expect((await ir("/tenteo/pedidos")).redirige).toBeNull();
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

describe("repartidor: contención total a /tenteo/repartos", () => {
  it("cualquier otra ruta del admin lo manda a su cola", async () => {
    como("repartidor");
    for (const p of ["/admin/dashboard", "/admin/staff", "/tenteo/pedidos", "/admin/sucursales/abc", "/admin/tesoreria", "/admin", "/tenteo"]) {
      expect((await ir(p)).redirige, p).toBe("/tenteo/repartos");
    }
  });
  it("/tenteo/repartos pasa", async () => {
    como("repartidor");
    expect((await ir("/tenteo/repartos")).redirige).toBeNull();
  });
  it("logueado en una página pública lo lleva a /tenteo/repartos (no al dashboard)", async () => {
    como("repartidor");
    expect((await ir("/")).redirige).toBe("/tenteo/repartos");
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

// ── Separación kiosco / Tenteo ─────────────────────────────────────────
// Sin el dato app_metadata.sistemas se trata como kiosco (nadie pierde acceso).
// Las pantallas de Tenteo viven en /tenteo (las rutas viejas redirigen desde next.config).

describe("/tenteo exige rol de personal Y el sistema Tenteo", () => {
  it("sin sesión -> /login", async () => {
    expect((await ir("/tenteo/pedidos")).redirige).toBe("/login");
  });
  it("cliente de Google (sin rol), aunque traiga el dato -> /login", async () => {
    for (const s of [undefined, ["kiosco", "tenteo"]]) {
      como(undefined, s);
      expect((await ir("/tenteo/pedidos")).redirige).toBe("/login");
      expect((await ir("/admin/dashboard")).redirige).toBe("/login");
    }
  });
  it("personal sin el dato (solo kiosco) rebota a su dashboard", async () => {
    for (const r of ["encargado", "vendedor", "concesionario"]) {
      como(r);
      expect((await ir("/tenteo/pedidos")).redirige, r).toBe("/admin/dashboard");
    }
  });
  it("personal con Tenteo entra; el admin entra siempre", async () => {
    como("vendedor", ["tenteo"]);
    expect((await ir("/tenteo/pedidos")).redirige).toBeNull();
    como("encargado", ["kiosco", "tenteo"]);
    expect((await ir("/tenteo/pedidos")).redirige).toBeNull();
    como("admin");
    expect((await ir("/tenteo/pedidos")).redirige).toBeNull();
  });
  it("la configuración de Tenteo es solo del admin", async () => {
    como("encargado", ["tenteo"]);
    expect((await ir("/tenteo/pedidos/configuracion")).redirige).toBe("/tenteo/pedidos"); // sin salir de Tenteo
    como("admin");
    expect((await ir("/tenteo/pedidos/configuracion")).redirige).toBeNull();
  });
});

describe("/admin exige el sistema kiosco", () => {
  it("personal solo de Tenteo no entra al kiosco: va a su sistema", async () => {
    como("vendedor", ["tenteo"]);
    for (const p of ["/admin/dashboard", "/admin/sucursales/abc", "/admin/stock"]) {
      expect((await ir(p)).redirige, p).toBe("/tenteo/pedidos");
    }
  });
  it("personal con los dos sistemas entra al kiosco", async () => {
    como("encargado", ["kiosco", "tenteo"]);
    expect((await ir("/admin/dashboard")).redirige).toBeNull();
  });
  it("dato inválido = kiosco, nunca acceso extra", async () => {
    como("vendedor", ["otro"]);
    expect((await ir("/admin/dashboard")).redirige).toBeNull();
    expect((await ir("/tenteo/pedidos")).redirige).toBe("/admin/dashboard");
  });
  it("las rutas de solo admin del kiosco rebotan al kiosco, no a Tenteo", async () => {
    como("encargado", ["kiosco", "tenteo"]);
    expect((await ir("/admin/categorias")).redirige).toBe("/admin/dashboard");
  });
});

describe("repartidor (solo Tenteo): contenido también en /tenteo", () => {
  it("/tenteo/pedidos y el kiosco lo mandan a sus entregas, con o sin el dato", async () => {
    for (const s of [undefined, ["kiosco"]]) {
      como("repartidor", s);
      expect((await ir("/tenteo/pedidos")).redirige).toBe("/tenteo/repartos");
      expect((await ir("/admin/dashboard")).redirige).toBe("/tenteo/repartos");
      expect((await ir("/tenteo/repartos")).redirige).toBeNull();
    }
  });
});

describe("páginas públicas: personal solo de Tenteo", () => {
  it("logueado en la home va a su sistema; en /tenteo y /pedir no lo redirigen", async () => {
    como("encargado", ["tenteo"]);
    expect((await ir("/")).redirige).toBe("/tenteo/pedidos");
    expect((await ir("/pedir/parque")).redirige).toBeNull();
  });
  it("quien tiene los dos y eligió Tenteo vuelve a Tenteo desde la home; sin elección, al kiosco", async () => {
    como("admin");
    const conCookie = async (valor: string | null) => {
      const req = new NextRequest("http://localhost/", valor ? { headers: { cookie: "sistema_preferido=" + valor } } : undefined);
      const loc = (await updateSession(req)).headers.get("location");
      return loc ? new URL(loc).pathname : null;
    };
    expect(await conCookie(null)).toBe("/admin/dashboard");
    expect(await conCookie("tenteo")).toBe("/tenteo/pedidos");
    expect(await conCookie("kiosco")).toBe("/admin/dashboard");
    expect(await conCookie("basura")).toBe("/admin/dashboard");
  });
  it("la preferencia NO da acceso: un vendedor de kiosco con cookie 'tenteo' sigue en el kiosco", async () => {
    como("vendedor");
    const req = new NextRequest("http://localhost/", { headers: { cookie: "sistema_preferido=tenteo" } });
    expect(new URL((await updateSession(req)).headers.get("location")!).pathname).toBe("/admin/dashboard");
    const req2 = new NextRequest("http://localhost/tenteo/pedidos", { headers: { cookie: "sistema_preferido=tenteo" } });
    expect(new URL((await updateSession(req2)).headers.get("location")!).pathname).toBe("/admin/dashboard");
  });
  it("el selector /elegir-sistema no se redirige a ningún panel (si no, nunca se vería)", async () => {
    como("admin");
    expect((await ir("/elegir-sistema")).redirige).toBeNull();
  });
  it("cliente de Google en la home o en el storefront: no se lo manda a ningún panel", async () => {
    como(undefined, ["kiosco", "tenteo"]);
    expect((await ir("/")).redirige).toBeNull();
    expect((await ir("/pedir/parque")).redirige).toBeNull();
  });
});

describe("sin variables de Supabase (/tenteo)", () => {
  it("/tenteo va a /login", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect((await ir("/tenteo/pedidos")).redirige).toBe("/login");
  });
});
