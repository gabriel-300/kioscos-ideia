import { describe, it, expect, vi, beforeEach } from "vitest";
import { sistemasAGuardar, sistemasFijos, sistemasDe, tieneSistemasGuardados } from "@/lib/auth/acceso";

// Asignar el sistema (kiosco / Tenteo) a cada persona desde Staff. Solo el admin
// escribe, y siempre en app_metadata (user_metadata lo edita el propio usuario).

const h = vi.hoisted(() => ({
  esAdmin: true,
  existente: { id: "u1", app_metadata: { role: "vendedor" } } as any,
  creado: [] as any[],
  actualizado: [] as { id: string; attrs: any }[],
  perfil: [] as any[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/require-role", () => ({
  requireAdmin: async () => { if (!h.esAdmin) throw new Error("Sin permisos de administrador"); return { userId: "adm" }; },
}));
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        createUser: async (a: any) => { h.creado.push(a); return { data: { user: { id: "nuevo" } }, error: null }; },
        getUserById: async () => ({ data: { user: h.existente } }),
        updateUserById: async (id: string, attrs: any) => { h.actualizado.push({ id, attrs }); return { error: null }; },
      },
    },
    from: () => ({ update: (p: any) => { h.perfil.push(p); return { eq: async () => ({}) }; }, upsert: async () => ({}) }),
  }),
}));

import { crearStaff, actualizarStaff } from "@/app/(admin)/admin/staff/actions";

beforeEach(() => {
  h.esAdmin = true;
  h.existente = { id: "u1", app_metadata: { role: "vendedor" } };
  h.creado = []; h.actualizado = []; h.perfil = [];
});

const base = { email: "a@b.c", nombre: "Ana", password: "12345678" };

describe("reglas de qué se guarda (puras)", () => {
  it("roles fijos: no se guarda nada (se borra la clave)", () => {
    expect(sistemasAGuardar("admin", ["kiosco"])).toEqual({ valor: null });
    expect(sistemasAGuardar("repartidor", undefined)).toEqual({ valor: null });
    expect(sistemasFijos("admin")).toEqual(["kiosco", "tenteo"]);
    expect(sistemasFijos("repartidor")).toEqual(["tenteo"]);
    expect(sistemasFijos("vendedor")).toBeNull();
  });
  it("el resto exige al menos uno y solo valores conocidos, sin repetidos y en orden", () => {
    expect(sistemasAGuardar("vendedor", ["tenteo", "kiosco", "tenteo"])).toEqual({ valor: ["kiosco", "tenteo"] });
    expect(sistemasAGuardar("encargado", ["tenteo"])).toEqual({ valor: ["tenteo"] });
    for (const malo of [[], undefined, null, "kiosco", ["root"], ["kiosco", "otro"], [1]]) {
      expect(sistemasAGuardar("vendedor", malo), JSON.stringify(malo)).toHaveProperty("error");
    }
  });
  it("tieneSistemasGuardados distingue 'tiene el dato' de 'se aplica el defecto'", () => {
    expect(tieneSistemasGuardados({ app_metadata: { role: "vendedor" } })).toBe(false);
    expect(tieneSistemasGuardados({ app_metadata: { role: "vendedor", sistemas: [] } })).toBe(false);
    expect(tieneSistemasGuardados({ app_metadata: { role: "vendedor", sistemas: ["tenteo"] } })).toBe(true);
    expect(tieneSistemasGuardados({ app_metadata: { role: "admin" } })).toBe(false);
  });
});

describe("crearStaff", () => {
  it("guarda los sistemas elegidos en app_metadata (no en user_metadata)", async () => {
    await crearStaff({ ...base, role: "vendedor", sistemas: ["tenteo", "kiosco"] });
    expect(h.creado[0].app_metadata).toEqual({ role: "vendedor", sistemas: ["kiosco", "tenteo"] });
    expect(h.creado[0].user_metadata).toEqual({ full_name: "Ana" });
    expect(JSON.stringify(h.creado[0].user_metadata)).not.toMatch(/sistemas|tenteo/);
  });
  it("sin dato: kiosco (como siempre)", async () => {
    await crearStaff({ ...base, role: "encargado" });
    expect(h.creado[0].app_metadata).toEqual({ role: "encargado", sistemas: ["kiosco"] });
  });
  it("admin y repartidor: solo el rol (sus sistemas son fijos)", async () => {
    await crearStaff({ ...base, role: "admin", sistemas: ["kiosco"] });
    await crearStaff({ ...base, role: "repartidor", sistemas: ["kiosco"] });
    expect(h.creado.map((c) => c.app_metadata)).toEqual([{ role: "admin" }, { role: "repartidor" }]);
  });
  it("rechaza sistemas vacíos o desconocidos sin crear el usuario", async () => {
    await expect(crearStaff({ ...base, role: "vendedor", sistemas: [] })).rejects.toThrow(/al menos un sistema/);
    await expect(crearStaff({ ...base, role: "vendedor", sistemas: ["root"] as any })).rejects.toThrow(/desconocido/);
    expect(h.creado).toHaveLength(0);
  });
  it("solo el admin puede", async () => {
    h.esAdmin = false;
    await expect(crearStaff({ ...base, role: "vendedor", sistemas: ["tenteo"] })).rejects.toThrow(/permisos/);
    expect(h.creado).toHaveLength(0);
  });
});

describe("actualizarStaff", () => {
  const meta = () => h.actualizado[0].attrs.app_metadata;

  it("cambia solo los sistemas y conserva el rol y las otras claves de app_metadata", async () => {
    h.existente = { id: "u1", app_metadata: { role: "encargado", otra: "x" } };
    await actualizarStaff("u1", { nombre: "Ana", sistemas: ["kiosco", "tenteo"] });
    expect(meta()).toEqual({ role: "encargado", otra: "x", sistemas: ["kiosco", "tenteo"] });
    expect(h.actualizado[0].attrs.user_metadata).toEqual({ full_name: "Ana" });
  });
  it("sin tocar rol ni sistemas no escribe app_metadata (quien no se edita conserva su dato o su defecto)", async () => {
    await actualizarStaff("u1", { nombre: "Ana" });
    expect(h.actualizado[0].attrs.app_metadata).toBeUndefined();
  });
  it("pasar a admin o repartidor borra el dato de sistemas (no queda uno viejo)", async () => {
    h.existente = { id: "u1", app_metadata: { role: "vendedor", sistemas: ["tenteo"] } };
    await actualizarStaff("u1", { nombre: "Ana", role: "admin" });
    expect(meta()).toEqual({ role: "admin" });
    h.actualizado = [];
    await actualizarStaff("u1", { nombre: "Ana", role: "repartidor", sistemas: ["kiosco"] });
    expect(meta()).toEqual({ role: "repartidor" });
  });
  it("de un rol fijo a uno normal con elección: guarda lo elegido", async () => {
    h.existente = { id: "u1", app_metadata: { role: "repartidor" } };
    await actualizarStaff("u1", { nombre: "Ana", role: "vendedor", sistemas: ["tenteo"] });
    expect(meta()).toEqual({ role: "vendedor", sistemas: ["tenteo"] });
  });
  it("un rol normal no puede quedarse sin sistemas", async () => {
    await expect(actualizarStaff("u1", { nombre: "Ana", sistemas: [] })).rejects.toThrow(/al menos un sistema/);
    expect(h.actualizado).toHaveLength(0);
  });
  it("solo el admin puede", async () => {
    h.esAdmin = false;
    await expect(actualizarStaff("u1", { nombre: "Ana", sistemas: ["tenteo"] })).rejects.toThrow(/permisos/);
    expect(h.actualizado).toHaveLength(0);
  });
  it("lo guardado se traduce en el acceso real (sistemasDe)", async () => {
    h.existente = { id: "u1", app_metadata: { role: "vendedor" } };
    await actualizarStaff("u1", { nombre: "Ana", sistemas: ["tenteo"] });
    expect(sistemasDe({ app_metadata: meta() })).toEqual(["tenteo"]);
  });
});
