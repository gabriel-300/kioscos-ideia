import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";
import { faltantes, normalizarCuit, normalizarNombre, nombresParecidos, validarFicha } from "@/lib/tesoreria/proveedores-ficha";

// Ficha contable del proveedor (migración 116): validación, nombres parecidos y las dos acciones con el doble en memoria de Supabase.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = vi.hoisted(() => ({ permisos: null as any, admin: null as any }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tesoreria/permisos", () => ({ permisosTesoreria: async () => h.permisos }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin }));

import { actualizarProveedorFicha, crearProveedorFicha } from "@/app/(admin)/admin/tesoreria/proveedores-ficha-actions";

const CUIT_OK = "20123456786";   // dígito verificador válido

describe("validarFicha", () => {
  it("solo el nombre es obligatorio; lo demás queda vacío", () => {
    const r = validarFicha({ nombre: "  Petri   panadería " });
    expect(r).toEqual({ valor: expect.objectContaining({ nombre: "Petri panadería", cuit: null, condicion_iva: null, da_factura: null, plazo_pago_dias: null }) });
    expect(validarFicha({ nombre: "  " })).toHaveProperty("error");
  });

  it("el CUIT se acepta con o sin guiones y se guarda con 11 dígitos; uno inválido se rechaza", () => {
    expect(validarFicha({ nombre: "A", cuit: "20-12345678-6" })).toEqual({ valor: expect.objectContaining({ cuit: CUIT_OK }) });
    expect(validarFicha({ nombre: "A", cuit: CUIT_OK })).toEqual({ valor: expect.objectContaining({ cuit: CUIT_OK }) });
    expect(validarFicha({ nombre: "A", cuit: "20-12345678-7" })).toEqual({ error: expect.stringContaining("CUIT") });
    expect(normalizarCuit("")).toBeNull();
    expect(normalizarCuit("abc")).toBe("invalido");
  });

  it("valida las listas fijas y el plazo", () => {
    expect(validarFicha({ nombre: "A", condicion_iva: "monotributo", da_factura: "a_veces", rubro: "mercaderia", forma_pago: "transferencia", plazo_pago_dias: 15 }))
      .toEqual({ valor: expect.objectContaining({ condicion_iva: "monotributo", da_factura: "a_veces", rubro: "mercaderia", forma_pago: "transferencia", plazo_pago_dias: 15 }) });
    for (const mal of [{ condicion_iva: "x" }, { da_factura: "x" }, { rubro: "x" }, { forma_pago: "retiro_caja" }, { plazo_pago_dias: -1 }, { plazo_pago_dias: 400 }, { plazo_pago_dias: 1.5 }]) {
      expect(validarFicha({ nombre: "A", ...mal })).toHaveProperty("error");
    }
    expect(validarFicha({ nombre: "A", plazo_pago_dias: 0 })).toEqual({ valor: expect.objectContaining({ plazo_pago_dias: 0 }) });
  });

  it("valida el email y los largos máximos", () => {
    expect(validarFicha({ nombre: "A", email: "no-es-un-mail" })).toHaveProperty("error");
    expect(validarFicha({ nombre: "A", email: "ventas@petri.com" })).toHaveProperty("valor");
    expect(validarFicha({ nombre: "x".repeat(121) })).toHaveProperty("error");
    expect(validarFicha({ nombre: "A", notas: "x".repeat(501) })).toHaveProperty("error");
  });
});

describe("nombresParecidos", () => {
  const lista = [{ id: "1", nombre: "Panaderia Petri" }, { id: "2", nombre: "Enminutas" }, { id: "3", nombre: "Vital" }];

  it("ignora mayúsculas, tildes, espacios y signos", () => {
    expect(normalizarNombre("  PANADERÍA  Petri. ")).toBe("panaderiapetri");
    expect(nombresParecidos("panadería PETRI", lista).iguales.map((p) => p.id)).toEqual(["1"]);
  });

  it("detecta «petri» como parecido a «Panaderia Petri» pero no como idéntico", () => {
    const r = nombresParecidos("petri", lista);
    expect(r.iguales).toEqual([]);
    expect(r.parecidos.map((p) => p.id)).toEqual(["1"]);
  });

  it("nombres cortos o distintos no se marcan, y se puede excluir al proveedor que se está editando", () => {
    expect(nombresParecidos("Vi", lista).parecidos).toEqual([]);
    expect(nombresParecidos("Rosamonte", lista)).toEqual({ iguales: [], parecidos: [] });
    expect(nombresParecidos("Panaderia Petri", lista, "1").iguales).toEqual([]);
  });
});

describe("faltantes", () => {
  it("lista lo que falta para la contabilidad", () => {
    const vacia = { cuit: null, condicion_iva: null, da_factura: null, forma_pago: null, plazo_pago_dias: null };
    expect(faltantes(vacia)).toHaveLength(5);
    expect(faltantes({ ...vacia, cuit: CUIT_OK, condicion_iva: "monotributo", da_factura: "siempre", forma_pago: "transferencia", plazo_pago_dias: 0 })).toEqual([]);
    expect(faltantes({ ...vacia, plazo_pago_dias: 0 })).not.toContain("plazo de pago");
  });
});

const CARGA = { userId: "damian", puedeVer: true, puedeCargar: true };
const SOLO_VE = { userId: "javier", puedeVer: true, puedeCargar: false };

type Esc = { existentes?: { id: string; nombre: string }[]; previo?: Record<string, unknown> | null; insertError?: string; updateError?: string; historialError?: string; cuitDe?: { id: string; nombre: string } };

function montar(permisos: unknown, e: Esc = {}) {
  h.permisos = permisos;
  const f = fakeAdmin((q: Q) => {
    if (q.table === "tesoreria_historial") return e.historialError ? { error: { message: e.historialError } } : { data: null };
    if (q.table !== "proveedores") return { data: null };
    if (q.op === "insert") return e.insertError ? { error: { message: e.insertError } } : { data: { id: "nuevo" } };
    if (q.op === "update") return e.updateError ? { error: { message: e.updateError } } : { data: null };
    if (q.filters.some((x) => x.col === "cuit")) return { data: e.cuitDe ? [e.cuitDe] : [] };
    if (q.maybeSingle || q.single) return { data: e.previo === undefined ? null : e.previo };
    return { data: e.existentes ?? [] };
  });
  h.admin = f.admin;
  return f;
}
const escrituras = (calls: Q[]) => calls.filter((q) => q.op !== "select");
const historialDe = (calls: Q[]) => calls.filter((q) => q.table === "tesoreria_historial" && q.op === "insert").map((q) => q.payload);

beforeEach(() => { h.permisos = null; });

describe("crearProveedorFicha", () => {
  it("sin permiso de cargar no escribe nada", async () => {
    const f = montar(SOLO_VE);
    expect(await crearProveedorFicha({ nombre: "Nuevo" })).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("crea el proveedor con quién lo cargó y lo anota en el historial", async () => {
    const f = montar(CARGA, { existentes: [{ id: "1", nombre: "Enminutas" }] });
    expect(await crearProveedorFicha({ nombre: "Rosamonte", cuit: "20-12345678-6", plazo_pago_dias: 7 })).toEqual({ id: "nuevo" });
    const ins = f.calls.find((q) => q.table === "proveedores" && q.op === "insert")!;
    expect(ins.payload).toMatchObject({ nombre: "Rosamonte", cuit: CUIT_OK, plazo_pago_dias: 7, modo_facturacion: "costo", created_by: "damian" });
    expect(historialDe(f.calls)).toEqual([expect.objectContaining({ accion: "proveedor_ficha", entidad_id: "nuevo", detalle: { proveedor: "Rosamonte", alta: true, cuit: CUIT_OK } })]);
  });

  it("un nombre idéntico a uno existente no se acepta (devuelve el existente)", async () => {
    const f = montar(CARGA, { existentes: [{ id: "1", nombre: "Panaderia Petri" }] });
    const r = await crearProveedorFicha({ nombre: "  panadería  PETRI " });
    expect(r.error).toMatch(/Ya existe/);
    expect(r.id).toBe("1");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("un nombre parecido pide confirmación y con confirmarParecidos se crea", async () => {
    let f = montar(CARGA, { existentes: [{ id: "1", nombre: "Panaderia Petri" }] });
    const r = await crearProveedorFicha({ nombre: "Petri" });
    expect(r.parecidos).toEqual([{ id: "1", nombre: "Panaderia Petri" }]);
    expect(escrituras(f.calls)).toEqual([]);
    f = montar(CARGA, { existentes: [{ id: "1", nombre: "Panaderia Petri" }] });
    expect(await crearProveedorFicha({ nombre: "Petri" }, true)).toEqual({ id: "nuevo" });
  });

  it("si el CUIT ya está en otro proveedor, lo dice con su nombre", async () => {
    montar(CARGA, { insertError: 'duplicate key value violates unique constraint "proveedores_cuit_uni"', cuitDe: { id: "9", nombre: "Distribuidora Total" } });
    const r = await crearProveedorFicha({ nombre: "Otro", cuit: CUIT_OK });
    expect(r.error).toMatch(/CUIT.*Distribuidora Total/);
  });

  it("si falta la migración 116, lo dice; los datos inválidos no tocan la base", async () => {
    montar(CARGA, { insertError: 'column "cuit" of relation "proveedores" does not exist' });
    expect((await crearProveedorFicha({ nombre: "Otro" })).error).toMatch(/migración 116/);
    const f = montar(CARGA);
    expect(await crearProveedorFicha({ nombre: "Otro", cuit: "123" })).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("si se guardó pero no se pudo anotar en el historial, avisa", async () => {
    montar(CARGA, { historialError: "boom" });
    const r = await crearProveedorFicha({ nombre: "Otro" });
    expect(r.error).toMatch(/historial/);
    expect(r.id).toBe("nuevo");
  });
});

describe("actualizarProveedorFicha", () => {
  const previo = { id: "1", nombre: "Panaderia Petri", razon_social: null, cuit: null, condicion_iva: null, da_factura: null, rubro: null, forma_pago: null, plazo_pago_dias: null, alias_cbu: null, contacto: "3764831519", email: null, notas: null };

  it("sin permiso de cargar no escribe nada", async () => {
    const f = montar(SOLO_VE, { previo });
    expect(await actualizarProveedorFicha("1", { nombre: "Panaderia Petri" })).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("guarda la ficha y anota en el historial solo los campos que cambiaron (antes y después)", async () => {
    const f = montar(CARGA, { previo, existentes: [{ id: "1", nombre: "Panaderia Petri" }] });
    expect(await actualizarProveedorFicha("1", { nombre: "Panaderia Petri", contacto: "3764831519", cuit: "20-12345678-6", plazo_pago_dias: 15, da_factura: "siempre" })).toEqual({});
    const upd = f.calls.find((q) => q.table === "proveedores" && q.op === "update")!;
    expect(upd.payload).toMatchObject({ cuit: CUIT_OK, plazo_pago_dias: 15, da_factura: "siempre", updated_by: "damian" });
    // El modo de facturación y el descuento de Catálogo no se tocan.
    expect(upd.payload).not.toHaveProperty("modo_facturacion");
    expect(historialDe(f.calls)[0]).toMatchObject({
      accion: "proveedor_ficha", entidad_id: "1",
      detalle: { proveedor: "Panaderia Petri", cambios: { cuit: { antes: null, despues: CUIT_OK }, plazo_pago_dias: { antes: null, despues: 15 }, da_factura: { antes: null, despues: "siempre" } } },
    });
  });

  it("si no cambia nada, no escribe ni anota", async () => {
    const f = montar(CARGA, { previo, existentes: [{ id: "1", nombre: "Panaderia Petri" }] });
    expect(await actualizarProveedorFicha("1", { nombre: "Panaderia Petri", contacto: "3764831519" })).toEqual({});
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("no permite llamarlo como otro proveedor; un nombre parecido pide confirmación", async () => {
    let f = montar(CARGA, { previo, existentes: [{ id: "1", nombre: "Panaderia Petri" }, { id: "2", nombre: "Enminutas" }] });
    expect((await actualizarProveedorFicha("1", { nombre: "enminutas" })).error).toMatch(/Ya existe otro/);
    expect(escrituras(f.calls)).toEqual([]);
    f = montar(CARGA, { previo, existentes: [{ id: "1", nombre: "Panaderia Petri" }, { id: "2", nombre: "Petrito Hermanos" }] });
    expect((await actualizarProveedorFicha("1", { nombre: "Petri" })).parecidos).toHaveLength(1);
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("un proveedor inexistente no escribe, y si falta la migración 116 lo dice", async () => {
    let f = montar(CARGA, { previo: null });
    expect(await actualizarProveedorFicha("x", { nombre: "A" })).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
    f = montar(CARGA, { previo, existentes: [{ id: "1", nombre: "Panaderia Petri" }], updateError: 'column "cuit" of relation "proveedores" does not exist' });
    expect((await actualizarProveedorFicha("1", { nombre: "Panaderia Petri", cuit: CUIT_OK })).error).toMatch(/migración 116/);
  });
});
