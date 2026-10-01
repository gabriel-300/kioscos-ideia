import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  ROLES_PERSONAL,
  destinoPorDefecto,
  esPersonal,
  puedeEntrar,
  rolDe,
  sistemaDeRuta,
  sistemasDe,
} from "@/lib/auth/acceso";

// Módulo central de acceso: quién pertenece a qué sistema y adónde va cada uno.
// El dato vive en app_metadata (lo escribe solo el servidor); user_metadata
// (editable por el propio usuario) nunca cuenta.

const u = (role?: string, sistemas?: unknown) => ({
  app_metadata: { ...(role ? { role } : {}), ...(sistemas !== undefined ? { sistemas } : {}) },
});

describe("sistemasDe: matriz rol × dato", () => {
  it("admin: ambos sistemas, con o sin dato (y aunque el dato diga otra cosa)", () => {
    for (const s of [undefined, [], ["kiosco"], ["tenteo"], "basura"]) {
      expect(sistemasDe(u("admin", s))).toEqual(["kiosco", "tenteo"]);
    }
  });
  it("repartidor: solo Tenteo, aunque el dato diga kiosco o no exista", () => {
    for (const s of [undefined, ["kiosco"], ["kiosco", "tenteo"]]) {
      expect(sistemasDe(u("repartidor", s))).toEqual(["tenteo"]);
    }
  });
  it("encargado, vendedor y concesionario SIN el dato nuevo: kiosco (nadie pierde acceso)", () => {
    for (const r of ["encargado", "vendedor", "concesionario"]) {
      expect(sistemasDe(u(r))).toEqual(["kiosco"]);
    }
  });
  it("con el dato: respeta kiosco, tenteo o ambos", () => {
    expect(sistemasDe(u("vendedor", ["tenteo"]))).toEqual(["tenteo"]);
    expect(sistemasDe(u("encargado", ["kiosco", "tenteo"]))).toEqual(["kiosco", "tenteo"]);
    expect(sistemasDe(u("encargado", ["tenteo", "kiosco"]))).toEqual(["kiosco", "tenteo"]);
  });
  it("dato inválido, vacío o de otro tipo: se trata como ausente (kiosco), nunca como 'todo'", () => {
    for (const s of [[], ["otro"], "tenteo", 7, null, {}, [null]]) {
      expect(sistemasDe(u("vendedor", s))).toEqual(["kiosco"]);
    }
  });
  it("ignora valores desconocidos mezclados con los válidos", () => {
    expect(sistemasDe(u("vendedor", ["tenteo", "otro"]))).toEqual(["tenteo"]);
  });
  it("sin rol (cliente de Google, signup público) o rol ajeno: ningún sistema, haya o no dato", () => {
    for (const r of [undefined, "customer_b2c", "admin_enminutas", "ADMIN"]) {
      expect(sistemasDe(u(r, ["kiosco", "tenteo"]))).toEqual([]);
      expect(esPersonal(u(r))).toBe(false);
      expect(puedeEntrar(u(r, ["kiosco", "tenteo"]), "kiosco")).toBe(false);
      expect(puedeEntrar(u(r, ["kiosco", "tenteo"]), "tenteo")).toBe(false);
    }
  });
  it("sin usuario: nada", () => {
    expect(sistemasDe(null)).toEqual([]);
    expect(sistemasDe(undefined)).toEqual([]);
    expect(rolDe(null)).toBeNull();
  });
  it("user_metadata NO cuenta: el usuario no se puede dar un sistema ni un rol a sí mismo", () => {
    const tramposo = { app_metadata: { role: "vendedor" }, user_metadata: { sistemas: ["tenteo"], role: "admin" } } as any;
    expect(sistemasDe(tramposo)).toEqual(["kiosco"]);
    expect(rolDe(tramposo)).toBe("vendedor");
    expect(sistemasDe({ app_metadata: {}, user_metadata: { role: "admin", sistemas: ["kiosco"] } } as any)).toEqual([]);
  });
});

describe("sistemaDeRuta", () => {
  it("/admin es del kiosco y /tenteo de Tenteo (por segmento, no por prefijo suelto)", () => {
    expect(sistemaDeRuta("/admin/dashboard")).toBe("kiosco");
    expect(sistemaDeRuta("/admin")).toBe("kiosco");
    expect(sistemaDeRuta("/tenteo")).toBe("tenteo");
    expect(sistemaDeRuta("/tenteo/pedidos/configuracion")).toBe("tenteo");
    expect(sistemaDeRuta("/tenteoo")).toBeNull();
  });
  it("lo público no se controla por sistema", () => {
    for (const p of ["/", "/login", "/pedir/parque", "/auth/redirect", "/api/ping"]) expect(sistemaDeRuta(p), p).toBeNull();
  });
  it("las pantallas de pedidos y entregas ya no están bajo /admin", () => {
    expect(sistemaDeRuta("/tenteo/pedidos")).toBe("tenteo");
    expect(sistemaDeRuta("/tenteo/repartos")).toBe("tenteo");
  });
});

describe("destinoPorDefecto", () => {
  it("kiosco -> dashboard; repartidor -> sus entregas", () => {
    expect(destinoPorDefecto(u("vendedor"))).toBe("/admin/dashboard");
    expect(destinoPorDefecto(u("admin"))).toBe("/admin/dashboard");
    expect(destinoPorDefecto(u("repartidor"))).toBe("/tenteo/repartos");
  });
  it("personal solo de Tenteo -> pedidos", () => {
    expect(destinoPorDefecto(u("encargado", ["tenteo"]))).toBe("/tenteo/pedidos");
  });
  it("la preferencia mueve el destino solo entre sistemas que el usuario SÍ tiene", () => {
    expect(destinoPorDefecto(u("admin"), "tenteo")).toBe("/tenteo/pedidos");
    expect(destinoPorDefecto(u("vendedor"), "tenteo")).toBe("/admin/dashboard"); // no tiene Tenteo: se ignora
    expect(destinoPorDefecto(u("repartidor"), "kiosco")).toBe("/tenteo/repartos");
  });
  it("sin rol: null (a /login)", () => {
    expect(destinoPorDefecto(u())).toBeNull();
    expect(destinoPorDefecto(null)).toBeNull();
  });
});

describe("los cinco roles de personal están en un solo lugar", () => {
  it("la lista central no cambió sin querer", () => {
    expect([...ROLES_PERSONAL]).toEqual(["admin", "encargado", "vendedor", "concesionario", "repartidor"]);
  });

  // Ya pasó DOS veces que el repartidor quedó trabado porque una lista de roles
  // duplicada no lo incluía. Este test no deja que vuelva a aparecer una copia
  // de la lista de acceso fuera de lib/auth/acceso.ts. (No mira las
  // comparaciones de rol por pantalla --"admin o concesionario ve esto"--, que
  // son reglas de negocio de cada página.)
  function archivos(dir: string, acc: string[] = []): string[] {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) archivos(ruta, acc);
      else if (/\.(ts|tsx)$/.test(nombre)) acc.push(ruta);
    }
    return acc;
  }
  const raiz = join(process.cwd(), "src");
  const central = ["lib", "auth", "acceso.ts"].join(sep);

  it("ningún otro archivo define STAFF_ROLES ni repite los cinco roles en una lista", () => {
    const sueltas: string[] = [];
    for (const f of archivos(raiz)) {
      const rel = relative(raiz, f);
      if (rel === central) continue;
      const texto = readFileSync(f, "utf8");
      if (/\bSTAFF_ROLES\b/.test(texto) || /"admin",\s*"encargado",\s*"vendedor",\s*"concesionario",\s*"repartidor"/.test(texto)) {
        sueltas.push(rel);
      }
    }
    expect(sueltas, `listas de roles fuera de lib/auth/acceso.ts: ${sueltas.join(", ")}`).toEqual([]);
  });
});
