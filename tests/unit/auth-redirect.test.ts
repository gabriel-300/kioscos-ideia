import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

// /auth/redirect decide adónde cae cada persona al entrar (el repartidor ya
// quedó trabado dos veces acá) y /auth/sistema guarda la elección de quien
// tiene los dos sistemas. Las dos leen app_metadata, nunca user_metadata.

const h = vi.hoisted(() => ({
  sesion: null as any,        // usuario de la sesión (cookies)
  fresco: null as any,        // usuario según la admin API
  cookie: undefined as string | undefined,
  tablas: (() => ({ data: null })) as (q: any) => any,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error("REDIRECT:" + url); },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sistema_preferido" && h.cookie ? { value: h.cookie } : undefined) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => h.sesion,
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.sesion } }) } }),
  createAdminClient: () => {
    const base = fakeAdmin((q: Q) => h.tablas(q)).admin as any;
    base.auth = { admin: { getUserById: async () => ({ data: { user: h.fresco } }) } };
    return base;
  },
}));

import AuthRedirectPage from "@/app/auth/redirect/page";
import ElegirSistemaPage from "@/app/(auth)/elegir-sistema/page";
import { GET as cambiarSistema } from "@/app/auth/sistema/route";

const usuario = (role?: string, sistemas?: unknown) => ({
  id: "u1",
  app_metadata: { ...(role ? { role } : {}), ...(sistemas !== undefined ? { sistemas } : {}) },
});
function como(role?: string, sistemas?: unknown) {
  h.sesion = h.fresco = usuario(role, sistemas);
}
async function destino(sistema?: string): Promise<string> {
  try {
    await AuthRedirectPage({ searchParams: Promise.resolve({ sistema }) });
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  return "(sin redirect)";
}

beforeEach(() => {
  h.sesion = h.fresco = null;
  h.cookie = undefined;
  h.tablas = (q) => (q.table === "sucursales" ? { data: { id: "suc-1" } } : { data: [] });
});

describe("/auth/redirect", () => {
  it("sin sesión -> /login", async () => {
    expect(await destino()).toBe("/login");
  });
  it("cliente de Google (sin rol), aunque traiga el dato de sistemas -> /login", async () => {
    for (const s of [undefined, ["kiosco", "tenteo"]]) {
      como(undefined, s);
      expect(await destino()).toBe("/login");
    }
  });
  it("repartidor -> /tenteo/repartos, con o sin el dato (y aunque pida el kiosco)", async () => {
    for (const s of [undefined, ["kiosco"]]) {
      como("repartidor", s);
      expect(await destino()).toBe("/tenteo/repartos");
      expect(await destino("kiosco")).toBe("/tenteo/repartos");
    }
  });
  it("usuarios actuales (sin el dato): siguen cayendo donde siempre", async () => {
    como("admin", undefined);
    h.cookie = "kiosco";
    expect(await destino()).toBe("/admin/dashboard");
    como("encargado");
    expect(await destino()).toBe("/admin/sucursales/suc-1");
    como("concesionario");
    expect(await destino()).toBe("/admin/sucursales/suc-1");
    como("vendedor");
    h.tablas = (q) => (q.table === "profile_sucursales" ? { data: [{ sucursal_id: "s1" }] } : { data: null });
    expect(await destino()).toBe("/admin/sucursales/s1");
  });
  it("personal solo de Tenteo -> /tenteo/pedidos", async () => {
    como("encargado", ["tenteo"]);
    expect(await destino()).toBe("/tenteo/pedidos");
  });
  it("con los dos sistemas y sin elección guardada: pregunta", async () => {
    como("admin");
    expect(await destino()).toBe("/elegir-sistema");
    como("encargado", ["kiosco", "tenteo"]);
    expect(await destino()).toBe("/elegir-sistema");
  });
  it("con los dos y elección guardada: va directo; el pedido explícito gana a la cookie", async () => {
    como("admin");
    h.cookie = "tenteo";
    expect(await destino()).toBe("/tenteo/pedidos");
    expect(await destino("kiosco")).toBe("/admin/dashboard");
    h.cookie = "kiosco";
    expect(await destino("tenteo")).toBe("/tenteo/pedidos");
  });
  it("la preferencia nunca da acceso: sin Tenteo, ni el pedido ni la cookie llevan ahí", async () => {
    como("vendedor");
    h.cookie = "tenteo";
    h.tablas = () => ({ data: [] });
    expect(await destino("tenteo")).toBe("/admin/dashboard");
  });
  it("cookie con basura se ignora", async () => {
    como("admin");
    h.cookie = "root";
    expect(await destino()).toBe("/elegir-sistema");
  });
  it("lee el dato fresco de la admin API, no el de la sesión", async () => {
    h.sesion = usuario("vendedor", ["kiosco"]);
    h.fresco = usuario("vendedor", ["tenteo"]); // el admin acaba de cambiárselo
    expect(await destino()).toBe("/tenteo/pedidos");
  });
  it("user_metadata no cuenta", async () => {
    h.sesion = h.fresco = { id: "u1", app_metadata: { role: "vendedor" }, user_metadata: { sistemas: ["tenteo"] } };
    h.tablas = () => ({ data: [] });
    expect(await destino()).toBe("/admin/dashboard");
  });
});

describe("/elegir-sistema", () => {
  async function pagina(): Promise<string> {
    try {
      await ElegirSistemaPage();
    } catch (e) {
      const m = /^REDIRECT:(.*)$/.exec((e as Error).message);
      if (m) return m[1];
      throw e;
    }
    return "(muestra el selector)";
  }
  it("muestra el selector solo a quien tiene los dos", async () => {
    como("admin");
    expect(await pagina()).toBe("(muestra el selector)");
    como("encargado", ["kiosco", "tenteo"]);
    expect(await pagina()).toBe("(muestra el selector)");
  });
  it("con un solo sistema o sin rol no hay nada que elegir", async () => {
    como("vendedor");
    expect(await pagina()).toBe("/auth/redirect");
    como("repartidor");
    expect(await pagina()).toBe("/auth/redirect");
    como(undefined, ["kiosco", "tenteo"]);
    expect(await pagina()).toBe("/login");
  });
});

describe("/auth/sistema (cambio de sistema)", () => {
  const pedir = (ir: string | null, headers: Record<string, string> = {}) =>
    cambiarSistema(new NextRequest(`https://app.test/auth/sistema${ir ? `?ir=${ir}` : ""}`, { headers }));
  const cookieGuardada = (res: Response) => res.headers.get("set-cookie") ?? "";

  it("quien tiene los dos: guarda la elección y sigue por /auth/redirect", async () => {
    como("admin");
    const res = await pedir("tenteo");
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe("/auth/redirect?sistema=tenteo");
    expect(cookieGuardada(res)).toMatch(/sistema_preferido=tenteo/);
    expect(cookieGuardada(res).toLowerCase()).toMatch(/httponly/);
  });
  it("no se puede elegir un sistema que no se tiene (ni se guarda la cookie)", async () => {
    como("vendedor");
    const res = await pedir("tenteo");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/auth/redirect");
    expect(cookieGuardada(res)).not.toMatch(/sistema_preferido/);
    como("repartidor");
    expect(cookieGuardada(await pedir("kiosco"))).not.toMatch(/sistema_preferido/);
  });
  it("valores inválidos no guardan nada", async () => {
    como("admin");
    for (const ir of ["root", "", null]) {
      expect(cookieGuardada(await pedir(ir))).not.toMatch(/sistema_preferido/);
    }
  });
  it("sin sesión o sin rol: al login, sin cookie", async () => {
    const res = await pedir("tenteo");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    como(undefined, ["kiosco", "tenteo"]);
    const res2 = await pedir("tenteo");
    expect(cookieGuardada(res2)).not.toMatch(/sistema_preferido/);
  });
  it("una precarga de Next no cambia la preferencia", async () => {
    como("admin");
    const res = await pedir("tenteo", { "next-router-prefetch": "1" });
    expect(res.status).toBe(204);
    expect(cookieGuardada(res)).not.toMatch(/sistema_preferido/);
  });
});
