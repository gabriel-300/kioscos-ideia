import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

// Pagos a proveedor y saldo inicial (migración 106): el permiso, la validación, el historial y la anulación se verifican
// con el doble en memoria de Supabase.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = vi.hoisted(() => ({ permisos: null as any, admin: null as any }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tesoreria/permisos", () => ({ permisosTesoreria: async () => h.permisos }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin }));

import { anularMovimientoProveedor, registrarMovimientoProveedor } from "@/app/(admin)/admin/tesoreria/proveedores-actions";

const CARGA = { userId: "damian", puedeVer: true, puedeCargar: true };
const SOLO_VE = { userId: "javier", puedeVer: true, puedeCargar: false };

const pago = { tipo: "pago", proveedor_id: "p1", sucursal_id: "s1", fecha: "2020-01-05", monto: 15000, origen: "efectivo_tesoreria", nota: "remitos 204 y 210" };

type Esc = { sinProveedor?: boolean; sinLocal?: boolean; insertError?: string; anulaFilas?: number; historialError?: string };

function montar(permisos: unknown, e: Esc = {}) {
  h.permisos = permisos;
  const f = fakeAdmin((q: Q) => {
    switch (q.table) {
      case "proveedores":  return { data: e.sinProveedor ? null : { id: "p1", nombre: "Petri" } };
      case "sucursales":   return { data: e.sinLocal ? null : { id: "s1", nombre: "Parque" } };
      case "proveedor_cuenta":
        if (q.op === "insert") return e.insertError ? { error: { message: e.insertError } } : { data: { id: "m1" } };
        if (q.op === "update") {
          return { data: Array.from({ length: e.anulaFilas ?? 1 }, () => ({
            id: "m1", tipo: "pago", monto: 15000, proveedor: { nombre: "Petri" }, sucursal: { nombre: "Parque" },
          })) };
        }
        return { data: null };
      case "tesoreria_historial":
        return e.historialError ? { error: { message: e.historialError } } : { data: null };
      default: return { data: null };
    }
  });
  h.admin = f.admin;
  return f;
}

const escrituras = (calls: Q[]) => calls.filter((q) => q.op !== "select");
const historialDe = (calls: Q[]) => calls.filter((q) => q.table === "tesoreria_historial" && q.op === "insert").map((q) => q.payload);

beforeEach(() => { h.permisos = null; });

describe("registrarMovimientoProveedor", () => {
  it("sin sesión o sin permiso de cargar no escribe nada", async () => {
    let f = montar(null);
    expect(await registrarMovimientoProveedor(pago)).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);

    f = montar(SOLO_VE);
    expect(await registrarMovimientoProveedor(pago)).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("guarda el pago con quién lo cargó y lo anota en el historial", async () => {
    const { calls } = montar(CARGA);
    expect(await registrarMovimientoProveedor(pago)).toEqual({});
    const insert = calls.find((q) => q.table === "proveedor_cuenta" && q.op === "insert")!;
    expect(insert.payload).toMatchObject({ tipo: "pago", proveedor_id: "p1", sucursal_id: "s1", monto: 15000, origen: "efectivo_tesoreria", created_by: "damian" });
    expect(historialDe(calls)).toEqual([expect.objectContaining({
      usuario_id: "damian", accion: "proveedor_pago", entidad_id: "m1", motivo: "remitos 204 y 210",
      detalle: expect.objectContaining({ monto: 15000, proveedor: "Petri", sucursal: "Parque", origen: "efectivo_tesoreria" }),
    })]);
  });

  it("el saldo inicial queda con su propia acción de historial y sin origen", async () => {
    const { calls } = montar(CARGA);
    await registrarMovimientoProveedor({ ...pago, tipo: "saldo_inicial", origen: null });
    expect(calls.find((q) => q.op === "insert" && q.table === "proveedor_cuenta")!.payload.origen).toBeNull();
    expect(historialDe(calls)[0]).toMatchObject({ accion: "proveedor_saldo_inicial" });
  });

  it("rechaza datos inválidos antes de tocar la base", async () => {
    const f = montar(CARGA);
    expect(await registrarMovimientoProveedor({ ...pago, monto: 0 })).toHaveProperty("error");
    expect(await registrarMovimientoProveedor({ ...pago, origen: "retiro_caja" })).toHaveProperty("error");
    expect(await registrarMovimientoProveedor({ ...pago, fecha: "2999-01-01" })).toHaveProperty("error");
    expect(f.calls).toEqual([]);
  });

  it("no acepta un proveedor inexistente ni un local que no entra en Tesorería", async () => {
    let f = montar(CARGA, { sinProveedor: true });
    expect(await registrarMovimientoProveedor(pago)).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);

    f = montar(CARGA, { sinLocal: true });
    expect(await registrarMovimientoProveedor(pago)).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("un segundo saldo inicial del mismo proveedor y local da un mensaje claro", async () => {
    montar(CARGA, { insertError: 'duplicate key value violates unique constraint "proveedor_cuenta_saldo_inicial_uni"' });
    const r = await registrarMovimientoProveedor({ ...pago, tipo: "saldo_inicial", origen: null });
    expect(r.error).toMatch(/Ya hay un saldo inicial/);
  });

  it("si la migración 106 no está aplicada, lo dice", async () => {
    montar(CARGA, { insertError: 'relation "public.proveedor_cuenta" does not exist' });
    expect((await registrarMovimientoProveedor(pago)).error).toMatch(/migración 106/);
  });

  it("si se guardó pero no se pudo anotar en el historial, avisa", async () => {
    montar(CARGA, { historialError: "boom" });
    expect((await registrarMovimientoProveedor(pago)).error).toMatch(/historial/);
  });
});

describe("anularMovimientoProveedor", () => {
  it("exige motivo y permiso", async () => {
    let f = montar(CARGA);
    expect(await anularMovimientoProveedor("m1", "  ")).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);

    f = montar(SOLO_VE);
    expect(await anularMovimientoProveedor("m1", "lo cargué dos veces")).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("anula con quién y por qué, y lo anota", async () => {
    const { calls } = montar(CARGA);
    expect(await anularMovimientoProveedor("m1", " cargado dos veces ")).toEqual({});
    const upd = calls.find((q) => q.table === "proveedor_cuenta" && q.op === "update")!;
    expect(upd.payload).toMatchObject({ anulado_por: "damian", anulado_motivo: "cargado dos veces" });
    expect(upd.filters).toContainEqual(expect.objectContaining({ op: "is", col: "anulado_en", val: null }));
    expect(historialDe(calls)).toEqual([expect.objectContaining({
      accion: "proveedor_movimiento_anulado", entidad_id: "m1", motivo: "cargado dos veces",
      detalle: { tipo: "pago", monto: 15000, proveedor: "Petri", sucursal: "Parque" },
    })]);
  });

  it("si ya estaba anulado no anota nada", async () => {
    const { calls } = montar(CARGA, { anulaFilas: 0 });
    expect((await anularMovimientoProveedor("m1", "motivo válido")).error).toMatch(/ya estaba anulado/);
    expect(historialDe(calls)).toEqual([]);
  });
});
