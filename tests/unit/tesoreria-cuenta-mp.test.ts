import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";
import { calcularSaldoMp, validarMovimientoMp, type CobroParaSaldo, type MovimientoMp } from "@/lib/tesoreria/cuenta-mp";
import { tengoMenosDebo } from "@/lib/tesoreria/calculos";

const h = vi.hoisted(() => ({ permisos: null as unknown, admin: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tesoreria/permisos", () => ({ permisosTesoreria: async () => h.permisos }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin }));

import { anularMovimientoMp, registrarMovimientoMp } from "@/app/(admin)/admin/tesoreria/cuentas-actions";

const AHORA = Date.parse("2026-10-15T12:00:00-03:00");

const inicial = (monto: number, fecha = "2026-10-09"): MovimientoMp => ({
  id: "ini", tipo: "saldo_inicial", fecha, monto, nota: null, created_at: "2026-10-10T00:00:00Z", created_by: null,
});
const retiro = (monto: number, fecha: string): MovimientoMp => ({
  id: `r-${fecha}`, tipo: "retiro", fecha, monto, nota: "pasé a Brubank", created_at: "2026-10-10T00:00:00Z", created_by: null,
});
const cobro = (o: Partial<CobroParaSaldo> = {}): CobroParaSaldo => ({
  fecha_cobro: "2026-10-10T12:00:00-03:00", fecha_liberacion: "2026-10-10T12:00:00-03:00", monto_neto: 990, estado: "approved",
  clase: "cobro", clasificacion: null, ...o,
});

describe("calcularSaldoMp", () => {
  it("sin saldo inicial la cuenta no está configurada y no inventa un saldo", () => {
    const s = calcularSaldoMp({ movimientos: [], cobros: [cobro()], pagos: [], ahoraMs: AHORA });
    expect(s).toMatchObject({ configurada: false, total: 0, disponible: 0 });
  });

  it("saldo = inicial + cobros + ingresos clasificados − pagos − retiros", () => {
    const s = calcularSaldoMp({
      movimientos: [inicial(100000), retiro(40000, "2026-10-12")],
      cobros: [
        cobro({ monto_neto: 5000 }),
        cobro({ monto_neto: 91120, clase: "a_clasificar", clasificacion: "transferencia_propia" }),
      ],
      pagos: [{ monto: 20000, fecha: "2026-10-11" }],
      ahoraMs: AHORA,
    });
    expect(s).toMatchObject({ saldoInicial: 100000, cobros: 5000, ingresos: 91120, pagos: 20000, retiros: 40000, total: 136120, disponible: 136120 });
  });

  it("lo anterior al saldo inicial no suma ni resta (el saldo inicial ya lo trae)", () => {
    const s = calcularSaldoMp({
      movimientos: [inicial(1000, "2026-10-10"), retiro(300, "2026-10-08")],
      cobros: [cobro({ fecha_cobro: "2026-10-09T23:59:00-03:00", monto_neto: 700 }), cobro({ fecha_cobro: "2026-10-10T00:01:00-03:00", monto_neto: 50 })],
      pagos: [{ monto: 400, fecha: "2026-10-09" }],
      ahoraMs: AHORA,
    });
    expect(s.total).toBe(1050);
  });

  it("los cobros no liberados se muestran a liberar y no son disponibles", () => {
    const s = calcularSaldoMp({
      movimientos: [inicial(0)],
      cobros: [cobro({ monto_neto: 1000 }), cobro({ monto_neto: 500, fecha_liberacion: "2026-10-20T00:00:00-03:00" })],
      pagos: [], ahoraMs: AHORA,
    });
    expect(s).toMatchObject({ total: 1500, aLiberar: 500, disponible: 1000 });
  });

  it("lo que no se clasificó no suma y se avisa; «no es un ingreso» tampoco suma", () => {
    const s = calcularSaldoMp({
      movimientos: [inicial(0)],
      cobros: [
        cobro({ clase: "a_clasificar", monto_neto: 70000 }),
        cobro({ clase: "a_clasificar", monto_neto: 49527, clasificacion: "no_es_ingreso" }),
        cobro({ monto_neto: 100 }),
      ],
      pagos: [], ahoraMs: AHORA,
    });
    expect(s.total).toBe(100);
    expect(s.sinClasificar).toEqual({ cantidad: 1, monto: 70000 });
  });

  it("ignora los cobros que no están aprobados", () => {
    const s = calcularSaldoMp({ movimientos: [inicial(0)], cobros: [cobro({ estado: "refunded", monto_neto: 999 })], pagos: [], ahoraMs: AHORA });
    expect(s.total).toBe(0);
  });

  it("un cobro de las 23:30 cuenta en su día argentino aunque en UTC ya sea el siguiente", () => {
    const s = calcularSaldoMp({
      movimientos: [inicial(0, "2026-10-10")],
      cobros: [cobro({ fecha_cobro: "2026-10-10T23:30:00-03:00", monto_neto: 10 })],
      pagos: [], ahoraMs: AHORA,
    });
    expect(s.total).toBe(10);
  });
});

describe("validarMovimientoMp", () => {
  const HOY = "2026-10-15";
  it("acepta un saldo inicial en cero y rechaza uno negativo", () => {
    expect(validarMovimientoMp({ tipo: "saldo_inicial", fecha: "2026-10-09", monto: 0, nota: null }, HOY)).toHaveProperty("valor");
    expect(validarMovimientoMp({ tipo: "saldo_inicial", fecha: "2026-10-09", monto: -1, nota: null }, HOY)).toHaveProperty("error");
  });
  it("un retiro exige monto positivo y decir a dónde fue", () => {
    expect(validarMovimientoMp({ tipo: "retiro", fecha: "2026-10-09", monto: 0, nota: "Brubank" }, HOY)).toHaveProperty("error");
    expect(validarMovimientoMp({ tipo: "retiro", fecha: "2026-10-09", monto: 500, nota: "" }, HOY)).toHaveProperty("error");
    expect(validarMovimientoMp({ tipo: "retiro", fecha: "2026-10-09", monto: 500, nota: "pasé a Brubank" }, HOY)).toHaveProperty("valor");
  });
  it("rechaza fecha futura o inválida y tipo desconocido", () => {
    expect(validarMovimientoMp({ tipo: "retiro", fecha: "2026-10-16", monto: 5, nota: "x y z" }, HOY)).toHaveProperty("error");
    expect(validarMovimientoMp({ tipo: "retiro", fecha: "2026-02-30", monto: 5, nota: "x y z" }, HOY)).toHaveProperty("error");
    expect(validarMovimientoMp({ tipo: "otro", fecha: "2026-10-09", monto: 5, nota: null }, HOY)).toHaveProperty("error");
  });
});

describe("tengoMenosDebo con Mercado Pago", () => {
  it("suma lo disponible de Mercado Pago al efectivo", () => {
    expect(tengoMenosDebo({ efectivo: 1000000, mpDisponible: 500000, deudaProveedores: 700000, obligacionesPendientes: 300000 })).toBe(500000);
  });
  it("sin Mercado Pago configurado cuenta solo el efectivo", () => {
    expect(tengoMenosDebo({ efectivo: 1000000, deudaProveedores: 700000, obligacionesPendientes: 300000 })).toBe(0);
  });
});

// ── Acciones ────────────────────────────────────────────────────────────────
const CARGA = { userId: "damian", puedeVer: true, puedeCargar: true };
const SOLO_VE = { userId: "javier", puedeVer: true, puedeCargar: false };
type Esc = { insertError?: string; anulaFilas?: number; historialError?: string };

function montar(permisos: unknown, e: Esc = {}) {
  h.permisos = permisos;
  const f = fakeAdmin((q: Q) => {
    if (q.table === "cuenta_mp") {
      if (q.op === "insert") return e.insertError ? { error: { message: e.insertError } } : { data: { id: "m1" } };
      if (q.op === "update") return { data: Array.from({ length: e.anulaFilas ?? 1 }, () => ({ id: "m1", tipo: "retiro", monto: 40000 })) };
    }
    if (q.table === "tesoreria_historial") return e.historialError ? { error: { message: e.historialError } } : { data: null };
    return { data: null };
  });
  h.admin = f.admin;
  return f;
}
const escrituras = (calls: Q[]) => calls.filter((q) => q.op !== "select");
const historialDe = (calls: Q[]) => calls.filter((q) => q.table === "tesoreria_historial" && q.op === "insert").map((q) => q.payload);

beforeEach(() => { h.permisos = null; });

describe("registrarMovimientoMp", () => {
  const retiroEntrada = { tipo: "retiro", fecha: "2020-01-05", monto: 40000, nota: "pasé a Brubank" };

  it("sin permiso de cargar no escribe nada", async () => {
    for (const permisos of [null, SOLO_VE]) {
      const f = montar(permisos);
      expect(await registrarMovimientoMp(retiroEntrada)).toHaveProperty("error");
      expect(escrituras(f.calls)).toEqual([]);
    }
  });

  it("guarda el retiro con quién lo cargó y lo anota", async () => {
    const { calls } = montar(CARGA);
    expect(await registrarMovimientoMp(retiroEntrada)).toEqual({});
    expect(calls.find((q) => q.table === "cuenta_mp" && q.op === "insert")!.payload).toMatchObject({ tipo: "retiro", monto: 40000, created_by: "damian" });
    expect(historialDe(calls)).toEqual([expect.objectContaining({ accion: "mp_retiro", entidad_id: "m1", motivo: "pasé a Brubank" })]);
  });

  it("el saldo inicial queda con su propia acción", async () => {
    const { calls } = montar(CARGA);
    await registrarMovimientoMp({ tipo: "saldo_inicial", fecha: "2020-01-05", monto: 250000, nota: null });
    expect(historialDe(calls)[0]).toMatchObject({ accion: "mp_saldo_inicial" });
  });

  it("un segundo saldo inicial da un mensaje claro, y sin la migración 107 lo dice", async () => {
    montar(CARGA, { insertError: 'duplicate key value violates unique constraint "cuenta_mp_saldo_inicial_uni"' });
    expect((await registrarMovimientoMp({ tipo: "saldo_inicial", fecha: "2020-01-05", monto: 1, nota: null })).error).toMatch(/Ya hay un saldo inicial/);
    montar(CARGA, { insertError: 'relation "public.cuenta_mp" does not exist' });
    expect((await registrarMovimientoMp(retiroEntrada)).error).toMatch(/migración 107/);
  });

  it("rechaza datos inválidos antes de tocar la base", async () => {
    const f = montar(CARGA);
    expect(await registrarMovimientoMp({ ...retiroEntrada, monto: 0 })).toHaveProperty("error");
    expect(await registrarMovimientoMp({ ...retiroEntrada, fecha: "2999-01-01" })).toHaveProperty("error");
    expect(f.calls).toEqual([]);
  });
});

describe("anularMovimientoMp", () => {
  it("exige motivo y permiso", async () => {
    let f = montar(CARGA);
    expect(await anularMovimientoMp("m1", " ")).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
    f = montar(SOLO_VE);
    expect(await anularMovimientoMp("m1", "lo cargué dos veces")).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("anula con quién y por qué, y lo anota; si ya estaba anulado no anota nada", async () => {
    let f = montar(CARGA);
    expect(await anularMovimientoMp("m1", " cargado dos veces ")).toEqual({});
    expect(f.calls.find((q) => q.table === "cuenta_mp" && q.op === "update")!.payload).toMatchObject({ anulado_por: "damian", anulado_motivo: "cargado dos veces" });
    expect(historialDe(f.calls)).toEqual([expect.objectContaining({ accion: "mp_movimiento_anulado", detalle: { tipo: "retiro", monto: 40000 } })]);

    f = montar(CARGA, { anulaFilas: 0 });
    expect((await anularMovimientoMp("m1", "motivo válido")).error).toMatch(/ya estaba anulado/);
    expect(historialDe(f.calls)).toEqual([]);
  });
});
