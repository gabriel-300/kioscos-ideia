import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";

// Pagos a proveedor y saldo inicial (migración 106): el permiso, la validación, el historial y la anulación se verifican
// con el doble en memoria de Supabase.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = vi.hoisted(() => ({ permisos: null as any, admin: null as any }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tesoreria/permisos", () => ({ permisosTesoreria: async () => h.permisos }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin }));

import { anularMovimientoProveedor, registrarMovimientoProveedor, registrarRetiroComoPago } from "@/app/(admin)/admin/tesoreria/proveedores-actions";

const CARGA = { userId: "damian", puedeVer: true, puedeCargar: true };
const SOLO_VE = { userId: "javier", puedeVer: true, puedeCargar: false };

const pago = { tipo: "pago", proveedor_id: "p1", sucursal_id: "s1", fecha: "2020-01-05", monto: 15000, origen: "efectivo_tesoreria", nota: "remitos 204 y 210" };

type Fila = Record<string, unknown>;
type Esc = {
  sinProveedor?: boolean; sinLocal?: boolean; insertError?: string; anulaFilas?: number; historialError?: string;
  proveedorDesactivado?: boolean;
  imputaciones?: Fila[];       // filas de proveedor_pago_imputaciones ya guardadas
  imputacionError?: string;    // falla el insert de las imputaciones del pago nuevo
  compras?: Fila[];            // egresos pendientes del proveedor+local (definen el saldo)
  movs?: Fila[];               // filas vigentes de proveedor_cuenta (p. ej. el saldo_inicial que fija el corte)
  retiro?: Fila | null;        // fila de retiros_caja
  tomaRetiroFilas?: number;    // filas que devuelve el update que toma el retiro
};

// Por defecto la cuenta debe 20000 (una compra vieja, sin saldo inicial): un pago de 15000 no la deja a favor.
const COMPRA_VIEJA = { id: "c1", fecha: "2019-12-01", monto: 20000, descripcion: "Remito", comprobante_numero: null };
const RETIRO = { id: "r1", sucursal_id: "s1", fecha: "2020-02-10", monto: 8000, motivo: "pago de mercadería", proveedor_id: "p1", egreso_id: null, proveedor_cuenta_id: null };
const saldoInicial = (fecha: string) => ({ id: "si", tipo: "saldo_inicial", proveedor_id: "p1", sucursal_id: "s1", fecha, monto: 0, origen: null, nota: null, created_at: `${fecha}T00:00:00Z`, created_by: null });

function montar(permisos: unknown, e: Esc = {}) {
  h.permisos = permisos;
  const f = fakeAdmin((q: Q) => {
    switch (q.table) {
      case "proveedores": {
        // Un proveedor desactivado solo se encuentra si la consulta NO filtra por is_active.
        const filtraActivo = q.filters.some((x) => x.op === "eq" && x.col === "is_active");
        return { data: e.sinProveedor || (e.proveedorDesactivado && filtraActivo) ? null : { id: "p1", nombre: "Petri" } };
      }
      case "sucursales":   return { data: e.sinLocal ? null : { id: "s1", nombre: "Parque" } };
      case "egresos":      return { data: e.compras ?? [COMPRA_VIEJA] };
      case "proveedor_pago_imputaciones":
        return q.op === "insert" && e.imputacionError ? { error: { message: e.imputacionError } } : { data: e.imputaciones ?? [] };
      case "retiros_caja":
        if (q.op === "select") return { data: e.retiro === undefined ? RETIRO : e.retiro };
        if (q.payload?.proveedor_cuenta_id === "m1") return { data: Array.from({ length: e.tomaRetiroFilas ?? 1 }, () => ({ id: "r1" })) };
        return { data: null };
      case "proveedor_cuenta":
        if (q.op === "select") return { data: e.movs ?? [] };
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

describe("registrarMovimientoProveedor: reglas de la cuenta corriente", () => {
  const inserts = (calls: Q[]) => calls.filter((q) => q.table === "proveedor_cuenta" && q.op === "insert");

  it("un pago mayor al saldo pide confirmación y no guarda nada", async () => {
    const { calls } = montar(CARGA, { compras: [{ ...COMPRA_VIEJA, monto: 10000 }] });
    const r = await registrarMovimientoProveedor(pago);   // 15000 contra un saldo de 10000
    expect(r.error).toMatch(/mayor que lo que se le debe/);
    expect(r.confirmar).toEqual({ saldo: 10000, monto: 15000 });
    expect(inserts(calls)).toEqual([]);
    expect(historialDe(calls)).toEqual([]);
  });

  it("con confirmarExceso = true el pago de más se guarda", async () => {
    const { calls } = montar(CARGA, { compras: [{ ...COMPRA_VIEJA, monto: 10000 }] });
    expect(await registrarMovimientoProveedor(pago, true)).toEqual({});
    expect(inserts(calls)).toHaveLength(1);
  });

  it("un pago igual o menor al saldo se guarda sin pedir confirmación", async () => {
    let f = montar(CARGA, { compras: [{ ...COMPRA_VIEJA, monto: 15000 }] });
    expect(await registrarMovimientoProveedor(pago)).toEqual({});
    expect(inserts(f.calls)).toHaveLength(1);

    f = montar(CARGA, { compras: [{ ...COMPRA_VIEJA, monto: 50000 }] });
    expect(await registrarMovimientoProveedor(pago)).toEqual({});
    expect(inserts(f.calls)).toHaveLength(1);
  });

  it("una cuenta sin deuda (saldo 0) también pide confirmación", async () => {
    const { calls } = montar(CARGA, { compras: [] });
    const r = await registrarMovimientoProveedor(pago);
    expect(r.confirmar).toEqual({ saldo: 0, monto: 15000 });
    expect(inserts(calls)).toEqual([]);
  });

  it("un pago con fecha igual o anterior al corte del saldo inicial se rechaza y no guarda", async () => {
    for (const fecha of ["2020-01-05", "2020-01-10"]) {
      const { calls } = montar(CARGA, { movs: [saldoInicial(fecha)] });
      const r = await registrarMovimientoProveedor(pago);   // pago del 05/01/2020
      expect(r.error).toContain(fecha.split("-").reverse().join("/"));
      expect(inserts(calls)).toEqual([]);
    }
  });

  it("un pago posterior al corte se acepta", async () => {
    const { calls } = montar(CARGA, { movs: [saldoInicial("2020-01-04")] });
    expect(await registrarMovimientoProveedor(pago, true)).toEqual({});
    expect(inserts(calls)).toHaveLength(1);
  });

  it("a un proveedor desactivado se le puede pagar, pero no cargarle un saldo inicial", async () => {
    let f = montar(CARGA, { proveedorDesactivado: true });
    expect(await registrarMovimientoProveedor(pago)).toEqual({});
    expect(inserts(f.calls)).toHaveLength(1);

    f = montar(CARGA, { proveedorDesactivado: true });
    const r = await registrarMovimientoProveedor({ ...pago, tipo: "saldo_inicial", origen: null });
    expect(r.error).toMatch(/desactivado/);
    expect(inserts(f.calls)).toEqual([]);
  });
});

describe("registrarMovimientoProveedor: imputación a remitos o facturas (migración 112)", () => {
  const dos = [
    { id: "c1", fecha: "2019-12-01", monto: 10000, descripcion: "Remito 1", comprobante_numero: "1" },
    { id: "c2", fecha: "2019-12-05", monto: 10000, descripcion: "Remito 2", comprobante_numero: "2" },
  ];
  const insertsImputaciones = (calls: Q[]) => calls.filter((q) => q.table === "proveedor_pago_imputaciones" && q.op === "insert");

  it("guarda el pago y sus imputaciones, y el historial anota cuánto se imputó", async () => {
    const f = montar(CARGA, { compras: dos });
    const r = await registrarMovimientoProveedor({ ...pago, monto: 15000 }, false, [{ egreso_id: "c2", monto: 10000 }, { egreso_id: "c1", monto: 5000 }]);
    expect(r).toEqual({});
    const ins = insertsImputaciones(f.calls);
    expect(ins).toHaveLength(1);
    expect(ins[0].payload).toEqual([{ pago_id: "m1", egreso_id: "c2", monto: 10000 }, { pago_id: "m1", egreso_id: "c1", monto: 5000 }]);
    expect(historialDe(f.calls)[0]).toMatchObject({ detalle: { imputado_a: 2, monto_imputado: 15000 } });
  });

  it("sin imputaciones no toca la tabla nueva (pago a cuenta)", async () => {
    const f = montar(CARGA, { compras: dos });
    expect(await registrarMovimientoProveedor({ ...pago, monto: 15000 })).toEqual({});
    expect(insertsImputaciones(f.calls)).toEqual([]);
  });

  it("rechaza imputar a una compra que no es de la cuenta y no guarda nada", async () => {
    const f = montar(CARGA, { compras: dos });
    expect(await registrarMovimientoProveedor(pago, false, [{ egreso_id: "otra", monto: 100 }])).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("rechaza imputar más que el pago o más de lo que le falta al remito", async () => {
    let f = montar(CARGA, { compras: dos });
    expect(await registrarMovimientoProveedor({ ...pago, monto: 5000 }, false, [{ egreso_id: "c1", monto: 6000 }])).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
    f = montar(CARGA, { compras: dos });
    expect(await registrarMovimientoProveedor({ ...pago, monto: 20000 }, false, [{ egreso_id: "c1", monto: 10001 }])).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("lo ya imputado a un remito por otro pago se descuenta de lo que le falta", async () => {
    const f = montar(CARGA, {
      compras: dos,
      movs: [{ id: "viejo", tipo: "pago", proveedor_id: "p1", sucursal_id: "s1", fecha: "2019-12-10", monto: 9000, origen: "efectivo_tesoreria", nota: null, created_at: "2019-12-10T00:00:00Z", created_by: null }],
      imputaciones: [{ pago_id: "viejo", egreso_id: "c1", monto: 9000 }],
    });
    // A c1 le falta 1000: imputarle 2000 no se puede.
    expect(await registrarMovimientoProveedor({ ...pago, monto: 5000 }, false, [{ egreso_id: "c1", monto: 2000 }])).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("si no se pueden guardar las imputaciones, borra el pago recién creado y avisa", async () => {
    const f = montar(CARGA, { compras: dos, imputacionError: "boom" });
    const r = await registrarMovimientoProveedor({ ...pago, monto: 10000 }, false, [{ egreso_id: "c1", monto: 10000 }]);
    expect(r.error).toBe("boom");
    expect(f.calls.some((q) => q.table === "proveedor_cuenta" && q.op === "delete")).toBe(true);
    expect(historialDe(f.calls)).toEqual([]);
  });

  it("si falta la migración 112, lo dice", async () => {
    montar(CARGA, { compras: dos, imputacionError: 'relation "public.proveedor_pago_imputaciones" does not exist' });
    const r = await registrarMovimientoProveedor({ ...pago, monto: 10000 }, false, [{ egreso_id: "c1", monto: 10000 }]);
    expect(r.error).toMatch(/migración 112/);
  });
});

describe("registrarRetiroComoPago", () => {
  const inserts = (calls: Q[]) => calls.filter((q) => q.table === "proveedor_cuenta" && q.op === "insert");

  it("crea el pago con los datos del retiro, toma el retiro y lo anota en el historial", async () => {
    const { calls } = montar(CARGA);
    expect(await registrarRetiroComoPago("r1")).toEqual({});

    const ins = inserts(calls);
    expect(ins).toHaveLength(1);
    expect(ins[0].payload).toMatchObject({
      tipo: "pago", proveedor_id: "p1", sucursal_id: "s1", fecha: "2020-02-10", monto: 8000, origen: "retiro_caja", created_by: "damian",
    });
    expect(ins[0].payload.nota).toContain("pago de mercadería");

    const toma = calls.find((q) => q.table === "retiros_caja" && q.op === "update")!;
    expect(toma.payload).toEqual({ proveedor_cuenta_id: "m1" });
    expect(toma.filters).toContainEqual(expect.objectContaining({ op: "eq", col: "id", val: "r1" }));
    expect(toma.filters).toContainEqual(expect.objectContaining({ op: "is", col: "egreso_id", val: null }));
    expect(toma.filters).toContainEqual(expect.objectContaining({ op: "is", col: "proveedor_cuenta_id", val: null }));

    expect(historialDe(calls)).toEqual([expect.objectContaining({
      usuario_id: "damian", accion: "proveedor_pago", entidad_id: "m1",
      detalle: expect.objectContaining({ monto: 8000, proveedor: "Petri", sucursal: "Parque", origen: "retiro_caja", fecha: "2020-02-10", retiro_de_caja: "r1" }),
    })]);
    expect(calls.some((q) => q.op === "delete")).toBe(false);
  });

  it("sin permiso de cargar no escribe (ni lee) nada", async () => {
    for (const permisos of [null, SOLO_VE]) {
      const { calls } = montar(permisos);
      expect(await registrarRetiroComoPago("r1")).toHaveProperty("error");
      expect(calls).toEqual([]);
    }
  });

  it("un retiro que no existe, o sin proveedor, no escribe nada", async () => {
    let f = montar(CARGA, { retiro: null });
    expect((await registrarRetiroComoPago("r1")).error).toMatch(/No se encontró/);
    expect(escrituras(f.calls)).toEqual([]);

    f = montar(CARGA, { retiro: { ...RETIRO, proveedor_id: null } });
    expect((await registrarRetiroComoPago("r1")).error).toMatch(/no tiene proveedor/);
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("un retiro ya registrado (como egreso o como pago) se rechaza", async () => {
    for (const ya of [{ egreso_id: "e9" }, { proveedor_cuenta_id: "m9" }]) {
      const { calls } = montar(CARGA, { retiro: { ...RETIRO, ...ya } });
      expect((await registrarRetiroComoPago("r1")).error).toMatch(/ya fue registrado/);
      expect(escrituras(calls)).toEqual([]);
    }
  });

  it("un retiro con fecha igual o anterior al corte del saldo inicial se rechaza", async () => {
    for (const corte of ["2020-02-10", "2020-03-01"]) {
      const { calls } = montar(CARGA, { movs: [saldoInicial(corte)] });
      const r = await registrarRetiroComoPago("r1");
      expect(r.error).toContain(corte.split("-").reverse().join("/"));
      expect(escrituras(calls)).toEqual([]);
    }
  });

  it("un local que no entra en Tesorería o un proveedor inexistente no escribe nada", async () => {
    let f = montar(CARGA, { sinLocal: true });
    expect(await registrarRetiroComoPago("r1")).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);

    f = montar(CARGA, { sinProveedor: true });
    expect(await registrarRetiroComoPago("r1")).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("si otro se llevó el retiro en el medio (update con 0 filas), borra el pago recién creado y avisa", async () => {
    const { calls } = montar(CARGA, { tomaRetiroFilas: 0 });
    const r = await registrarRetiroComoPago("r1");
    expect(r.error).toMatch(/Alguien más/);
    const borrado = calls.find((q) => q.table === "proveedor_cuenta" && q.op === "delete")!;
    expect(borrado).toBeDefined();
    expect(borrado.filters).toContainEqual(expect.objectContaining({ op: "eq", col: "id", val: "m1" }));
    expect(historialDe(calls)).toEqual([]);
  });

  it("si el insert del pago falla, devuelve el error y no toca el retiro", async () => {
    const { calls } = montar(CARGA, { insertError: "boom" });
    expect(await registrarRetiroComoPago("r1")).toEqual({ error: "boom" });
    expect(calls.some((q) => q.table === "retiros_caja" && q.op === "update")).toBe(false);
  });

  it("si la base rechaza el origen retiro_caja, dice que falta la migración 111", async () => {
    montar(CARGA, { insertError: 'violates check constraint "proveedor_cuenta_origen_check"' });
    expect((await registrarRetiroComoPago("r1")).error).toMatch(/migración 111/);
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

  it("libera el retiro de caja que había originado el pago (vuelve a «Para registrar»)", async () => {
    const { calls } = montar(CARGA);
    expect(await anularMovimientoProveedor("m1", "cargado dos veces")).toEqual({});
    const libera = calls.find((q) => q.table === "retiros_caja" && q.op === "update")!;
    expect(libera.payload).toEqual({ proveedor_cuenta_id: null });
    expect(libera.filters).toContainEqual(expect.objectContaining({ op: "eq", col: "proveedor_cuenta_id", val: "m1" }));
  });

  it("si ya estaba anulado no anota nada", async () => {
    const { calls } = montar(CARGA, { anulaFilas: 0 });
    expect((await anularMovimientoProveedor("m1", "motivo válido")).error).toMatch(/ya estaba anulado/);
    expect(historialDe(calls)).toEqual([]);
    expect(calls.some((q) => q.table === "retiros_caja")).toBe(false);
  });
});
