import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";
import {
  aCobrarPeya, completarConExcel, leerCsvPedidos, leerExcelEstadoCuenta, resumirExcel, type Celda, type EstadoCuentaPeya, type HojaExcel,
} from "@/lib/tesoreria/peya";

// Las acciones de PedidosYa escriben plata con el cliente admin (sin RLS): el permiso, la verificación de la cuenta y el cruce con las
// ventas se prueban acá con el doble en memoria de Supabase y los archivos reales de la semana 05/10–11/10/2026.

const h = vi.hoisted(() => ({ permisos: null as unknown, admin: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tesoreria/permisos", () => ({ permisosTesoreria: async () => h.permisos }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin }));

import { conciliarPedidoPeya, guardarLiquidacionPeya, registrarAcreditacionPeya } from "@/app/(admin)/admin/tesoreria/peya-actions";

const CARGA = { userId: "damian", puedeVer: true, puedeCargar: true };
const SOLO_VE = { userId: "javier", puedeVer: true, puedeCargar: false };

const FIXTURES = resolve(__dirname, "../fixtures/peya");
let pedidosCsv: ReturnType<typeof leerCsvPedidos>["pedidos"];
let excelResumen: ReturnType<typeof resumirExcel>;

beforeAll(async () => {
  const req = createRequire(import.meta.url);
  const ExcelJS = req("exceljs/dist/exceljs.min.js");
  const buf = readFileSync(resolve(FIXTURES, "estado-de-cuenta_428019.xls"));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const hojas: HojaExcel[] = [];
  wb.eachSheet((ws: { name: string; eachRow: (o: object, f: (r: { values: unknown[] }) => void) => void }) => {
    const filas: Celda[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => filas.push((r.values as Celda[]).slice(1)));
    hojas.push({ nombre: ws.name, filas });
  });
  const excel = leerExcelEstadoCuenta(hojas);
  pedidosCsv = completarConExcel(leerCsvPedidos(readFileSync(resolve(FIXTURES, "orderDetails.csv"), "utf8")).pedidos, excel);
  excelResumen = resumirExcel(excel);
});

const ESTADO: EstadoCuentaPeya = {
  periodo_desde: "2026-10-05", periodo_hasta: "2026-10-11", total_liquidado: 3724304,
  publicidad: -1112155, iva_comisiones: -881461, retenciones_sirtac: -366800, reintegros: 0, ajustes: 0, saldo_anterior: 0,
  fecha_pago_procesado: "2026-10-23", cuenta_destino: "PSP PEYA terminada en 8313", ajustes_nota: null,
};

// Ventas «Pedido Ya Plataforma» del Parque en esa semana, como están en el sistema (importe = suma de productos).
const VENTAS = [
  ["v1", "2026-10-05T10:13:00-03:00", 10000], ["v2", "2026-10-06T18:36:00-03:00", 11200], ["v3", "2026-10-07T13:45:00-03:00", 12000],
  ["v4", "2026-10-07T20:55:00-03:00", 9000], ["v5", "2026-10-09T13:57:00-03:00", 7700], ["v6", "2026-10-09T13:58:00-03:00", 10200],
  ["v7", "2026-10-09T18:57:00-03:00", 8500], ["v8", "2026-10-09T20:31:00-03:00", 11900], ["v9", "2026-10-11T20:30:00-03:00", 7800],
] as const;

type Esc = {
  sinTienda?: boolean; existente?: { estado: string } | null; previa?: { periodo_hasta: string; fecha_pago_procesado: string | null } | null;
  liquidacion?: Record<string, unknown> | null; pedido?: Record<string, unknown> | null; venta?: Record<string, unknown> | null; ventaUsada?: boolean;
  mpMov?: Record<string, unknown> | null; historialError?: string;
};

function montar(permisos: unknown, e: Esc = {}) {
  h.permisos = permisos;
  const f = fakeAdmin((q: Q) => {
    switch (q.table) {
      case "sucursales":
        return { data: e.sinTienda ? [] : [{ id: "s1", nombre: "Parque de las Fiestas", pedidoya_store_id: "626966" }] };
      case "movimientos":
        if (q.single || q.maybeSingle) return { data: e.venta ?? null };
        return { data: VENTAS.map(([id, cuando]) => ({ id, created_at: cuando, canal: "pedido_ya_plataforma" })) };
      case "movimiento_items":
        if (q.filters.some((x) => x.op === "eq")) return { data: [{ subtotal: 10000 }] };
        return { data: VENTAS.map(([id, , total]) => ({ movimiento_id: id, subtotal: total })) };
      case "peya_liquidaciones":
        if (q.op === "upsert") return { data: { id: "L1" } };
        if (q.op === "update") return { data: null };
        if (q.filters.some((x) => x.op === "lt")) return { data: e.previa ?? null };
        if (q.filters.some((x) => x.col === "mp_operation_id")) return { data: [] };
        if (q.filters.some((x) => x.col === "id")) return { data: e.liquidacion ?? null };
        return { data: e.existente === undefined ? null : e.existente };
      case "peya_pedidos":
        if (q.op === "select" && q.maybeSingle) return { data: e.pedido ?? null };
        if (q.op === "select") return { data: e.ventaUsada ? [{ id: "otro" }] : [] };
        return { data: null };
      case "mp_cobros":
        return { data: e.mpMov ?? null };
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
const entrada = (o: Record<string, unknown> = {}) => ({
  pedidos: JSON.parse(JSON.stringify(pedidosCsv)), excel: excelResumen, estado: ESTADO,
  periodo: { desde: "2026-10-05", hasta: "2026-10-11" }, archivos: [], ...o,
});

beforeEach(() => { h.permisos = null; });

describe("guardarLiquidacionPeya", () => {
  it("sin sesión o sin permiso de cargar no escribe nada", async () => {
    for (const permisos of [null, SOLO_VE]) {
      const f = montar(permisos);
      expect(await guardarLiquidacionPeya(entrada())).toHaveProperty("error");
      expect(escrituras(f.calls)).toEqual([]);
    }
  });

  it("la semana de ejemplo: cierra a $0,00, queda confirmada y los 9 cruces + el pedido sin venta quedan guardados", async () => {
    const { calls } = montar(CARGA);
    const r = await guardarLiquidacionPeya(entrada());
    expect(r).toEqual({ id: "L1", estado: "confirmado", diferencia: 0 });

    const liq = calls.find((q) => q.table === "peya_liquidaciones" && q.op === "upsert")!;
    expect(liq.payload).toMatchObject({
      tienda_id: "626966", sucursal_id: "s1", periodo_desde: "2026-10-05", periodo_hasta: "2026-10-11", estado: "confirmado",
      ventas_netas: 91700, servicio_ventas: 21091, servicio_pago_linea: 2916.3, cargo_plus: 2820.5, cargos_cancelacion: 4870.25, impuestos_pedidos: 6479.1,
      ingreso_estimado: 54368.1, publicidad: -11121.55, iva_comisiones: -8814.61, retenciones_sirtac: -3668, total_liquidado: 37243.04, neto_calculado: 37243.04,
      diferencia: 0, fecha_pago_procesado: "2026-10-23", fecha_acreditacion_hasta: "2026-10-28", created_by: "damian",
    });
    const pedidos = calls.filter((q) => q.table === "peya_pedidos" && q.op === "upsert").flatMap((q) => q.payload as Record<string, unknown>[]);
    expect(pedidos).toHaveLength(11);
    const cuenta = (e: string) => pedidos.filter((p) => p.conciliacion === e).length;
    expect(cuenta("conciliado")).toBe(9);
    expect(cuenta("sin_venta")).toBe(1);
    expect(cuenta("no_aplica")).toBe(1);
    expect(pedidos.find((p) => p.nro_pedido === "2316119662")).toMatchObject({ conciliacion: "sin_venta", movimiento_id: null, total_parcial: 3400 });
    expect(pedidos.find((p) => p.nro_pedido === "2313299352")).toMatchObject({ conciliacion: "conciliado", movimiento_id: "v1", cobrado_por: "PedidosYa" });
    expect(historialDe(calls)).toEqual([expect.objectContaining({
      usuario_id: "damian", accion: "peya_liquidacion_confirmada", entidad_id: "L1",
      detalle: expect.objectContaining({ local: "Parque de las Fiestas", pedidos: 11, total_liquidado: 37243.04, diferencia: 0 }),
    })]);
  });

  it("si el Total liquidado no coincide NO se guarda nada y dice la diferencia", async () => {
    const f = montar(CARGA);
    const r = await guardarLiquidacionPeya(entrada({ estado: { ...ESTADO, total_liquidado: 3724304 + 100000 } }));
    expect(r.error).toMatch(/La cuenta no cierra, no se guarda/);
    expect(r.error).toMatch(/1\.000,00/);
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("si el Excel no coincide con el CSV no se guarda aunque no haya estado de cuenta", async () => {
    const f = montar(CARGA);
    const roto = { ...excelResumen, totales: { ...excelResumen.totales, venta_neta: excelResumen.totales.venta_neta + 100 } };
    const r = await guardarLiquidacionPeya(entrada({ estado: null, excel: roto }));
    expect(r.error).toMatch(/Ventas netas: CSV contra Excel/);
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("sin estado de cuenta se guarda como ESTIMADA y sin inventar fecha si no hay una liquidación anterior", async () => {
    const { calls } = montar(CARGA);
    const r = await guardarLiquidacionPeya(entrada({ estado: null }));
    expect(r).toMatchObject({ id: "L1", estado: "estimado" });
    const liq = calls.find((q) => q.table === "peya_liquidaciones" && q.op === "upsert")!.payload;
    expect(liq).toMatchObject({ estado: "estimado", total_liquidado: null, publicidad: null, fecha_pago_procesado: null, fecha_pago_estimada: null, confirmada_por: null });
    expect(historialDe(calls)[0]).toMatchObject({ accion: "peya_liquidacion_importada" });
  });

  it("sin estado de cuenta, la fecha se estima con el plazo de la última liquidación confirmada", async () => {
    const { calls } = montar(CARGA, { previa: { periodo_hasta: "2026-10-04", fecha_pago_procesado: "2026-10-16" } });
    await guardarLiquidacionPeya(entrada({ estado: null }));
    const liq = calls.find((q) => q.table === "peya_liquidaciones" && q.op === "upsert")!.payload;
    expect(liq).toMatchObject({ fecha_pago_estimada: "2026-10-23", fecha_pago_procesado: null });     // 12 días después de cerrar el período
  });

  it("avisa cuando el plazo de cobro cambió respecto de la semana anterior", async () => {
    const { calls } = montar(CARGA, { previa: { periodo_hasta: "2026-10-04", fecha_pago_procesado: "2026-10-14" } });   // plazo anterior: 10 días
    await guardarLiquidacionPeya(entrada());
    expect(calls.find((q) => q.table === "peya_liquidaciones" && q.op === "upsert")!.payload.alerta_plazo).toMatch(/Cambió el plazo de cobro: ahora 12 días/);
  });

  it("una liquidación ya acreditada no se puede reimportar; una confirmada no baja a estimada", async () => {
    let f = montar(CARGA, { existente: { estado: "acreditado" } as never });
    expect((await guardarLiquidacionPeya(entrada())).error).toMatch(/ya está acreditada/);
    expect(escrituras(f.calls)).toEqual([]);
    f = montar(CARGA, { existente: { estado: "confirmado" } as never });
    expect((await guardarLiquidacionPeya(entrada({ estado: null }))).error).toMatch(/ya está confirmada/);
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("una tienda sin local asignado, o un CSV con varias tiendas, se rechazan con un mensaje claro", async () => {
    let f = montar(CARGA, { sinTienda: true });
    expect((await guardarLiquidacionPeya(entrada())).error).toMatch(/no está asignada a un local/);
    expect(escrituras(f.calls)).toEqual([]);
    f = montar(CARGA);
    const dos = entrada();
    (dos.pedidos as { tienda_id: string }[])[0].tienda_id = "999999";
    expect((await guardarLiquidacionPeya(dos)).error).toMatch(/2 tiendas/);
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("rechaza un archivo adjunto con una ruta que no es del depósito y datos que no son lo que produce la lectura", async () => {
    const f = montar(CARGA);
    expect((await guardarLiquidacionPeya(entrada({ archivos: [{ tipo: "csv", nombre: "a.csv", path: "../../etc/passwd", bytes: 10 }] }))).error).toMatch(/ruta/);
    expect((await guardarLiquidacionPeya(entrada({ pedidos: [] }))).error).toMatch(/No hay pedidos/);
    expect((await guardarLiquidacionPeya(entrada({ estado: { ...ESTADO, total_liquidado: 10.5 } }))).error).toBeTruthy();
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("guarda las rutas de los originales subidos", async () => {
    const { calls } = montar(CARGA);
    const path = "2026-10/0b1c2d3e-0a1b-4c2d-8e3f-123456789abc.csv";
    await guardarLiquidacionPeya(entrada({ archivos: [{ tipo: "csv", nombre: "orderDetails.csv", path, bytes: 6621 }] }));
    expect(calls.find((q) => q.table === "peya_archivos" && q.op === "insert")!.payload).toEqual([
      expect.objectContaining({ liquidacion_id: "L1", tipo: "csv", nombre: "orderDetails.csv", path, bytes: 6621, subido_por: "damian" }),
    ]);
  });
});

describe("registrarAcreditacionPeya", () => {
  const liq = (o: Record<string, unknown> = {}) => ({
    id: "L1", estado: "confirmado", periodo_desde: "2026-10-05", periodo_hasta: "2026-10-11", total_liquidado: 37243.04, ingreso_estimado: 54368.1,
    fecha_pago_procesado: "2026-10-23", fecha_pago_estimada: null, ...o,
  });

  it("sin permiso no escribe", async () => {
    const f = montar(SOLO_VE, { liquidacion: liq() });
    expect(await registrarAcreditacionPeya({ id: "L1", fecha: "2026-10-12", monto: 37243.04, mp_operation_id: null })).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("registra que llegó el monto exacto: queda acreditada, y conciliada si se vincula con el movimiento de Mercado Pago", async () => {
    const m = montar(CARGA, { liquidacion: liq(), mpMov: { operation_id: "555", clase: "a_clasificar", clasificacion: null } });
    const r = await registrarAcreditacionPeya({ id: "L1", fecha: "2026-10-12", monto: 37243.04, mp_operation_id: "555" });
    expect(r).toEqual({});
    const upd = m.calls.find((q) => q.table === "peya_liquidaciones" && q.op === "update")!;
    expect(upd.payload).toMatchObject({ estado: "conciliado", fecha_acreditacion_real: "2026-10-12", monto_acreditado: 37243.04, mp_operation_id: "555" });
    expect(m.calls.find((q) => q.table === "mp_cobros" && q.op === "update")!.payload).toMatchObject({ clasificacion: "otro_ingreso" });
    expect(historialDe(m.calls)[0]).toMatchObject({ accion: "peya_acreditacion_registrada", detalle: expect.objectContaining({ esperado: 37243.04, acreditado: 37243.04, diferencia: 0, mercadopago: true }) });
  });

  it("si llegó un monto distinto queda «acreditado» (no conciliado) y la diferencia en el historial", async () => {
    const m = montar(CARGA, { liquidacion: liq() });
    await registrarAcreditacionPeya({ id: "L1", fecha: "2026-10-12", monto: 30000, mp_operation_id: null });
    expect(m.calls.find((q) => q.table === "peya_liquidaciones" && q.op === "update")!.payload).toMatchObject({ estado: "acreditado", monto_acreditado: 30000 });
    expect(historialDe(m.calls)[0].detalle).toMatchObject({ diferencia: -7243.04 });
  });

  it("no se registra el cobro de una liquidación estimada, ni una fecha futura o anterior al período", async () => {
    let f = montar(CARGA, { liquidacion: liq({ estado: "estimado", total_liquidado: null }) });
    expect((await registrarAcreditacionPeya({ id: "L1", fecha: "2026-10-12", monto: 100, mp_operation_id: null })).error).toMatch(/confirmá la liquidación/);
    f = montar(CARGA, { liquidacion: liq() });
    expect((await registrarAcreditacionPeya({ id: "L1", fecha: "2999-01-01", monto: 100, mp_operation_id: null })).error).toMatch(/futura/);
    expect((await registrarAcreditacionPeya({ id: "L1", fecha: "2026-10-01", monto: 100, mp_operation_id: null })).error).toMatch(/antes de que termine el período/);
    expect(escrituras(f.calls)).toEqual([]);
  });
});

describe("conciliarPedidoPeya (cruce a mano)", () => {
  const ped = { id: "P1", nro_pedido: "2316119662", liquidacion_id: "L1", total_parcial: 10000, estado: "entregado" };
  const liqRow = { id: "L1", sucursal_id: "s1", estado: "confirmado", periodo_desde: "2026-10-05", periodo_hasta: "2026-10-11" };

  it("cruza con una venta del mismo local y deja el estado según el importe", async () => {
    const { calls } = montar(CARGA, { pedido: ped, liquidacion: liqRow, venta: { id: "vx", sucursal_id: "s1", canal: "pedido_ya_plataforma", tipo: "venta", anulado_en: null } });
    expect(await conciliarPedidoPeya("P1", "vx")).toEqual({});
    expect(calls.find((q) => q.table === "peya_pedidos" && q.op === "update")!.payload).toMatchObject({ movimiento_id: "vx", conciliacion: "conciliado", diferencia_importe: 0 });
    expect(historialDe(calls)[0]).toMatchObject({ accion: "peya_conciliacion_manual", detalle: { pedido: "2316119662", venta: "vx", resultado: "conciliado" } });
  });

  it("rechaza una venta de otro local, una anulada, o ya cruzada con otro pedido", async () => {
    let f = montar(CARGA, { pedido: ped, liquidacion: liqRow, venta: { id: "vx", sucursal_id: "OTRO", canal: "pedido_ya_plataforma", tipo: "venta", anulado_en: null } });
    expect((await conciliarPedidoPeya("P1", "vx")).error).toMatch(/no es una venta de PedidosYa de ese local/);
    f = montar(CARGA, { pedido: ped, liquidacion: liqRow, venta: { id: "vx", sucursal_id: "s1", canal: "pedido_ya_plataforma", tipo: "venta", anulado_en: "2026-10-10" } });
    expect((await conciliarPedidoPeya("P1", "vx")).error).toMatch(/anulada/);
    f = montar(CARGA, { pedido: ped, liquidacion: liqRow, ventaUsada: true, venta: { id: "vx", sucursal_id: "s1", canal: "pedido_ya_plataforma", tipo: "venta", anulado_en: null } });
    expect((await conciliarPedidoPeya("P1", "vx")).error).toMatch(/ya está cruzada/);
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("sin permiso no hace nada", async () => {
    const f = montar(SOLO_VE, { pedido: ped, liquidacion: liqRow });
    expect(await conciliarPedidoPeya("P1", "vx")).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });
});

describe("aCobrarPeya", () => {
  it("separa lo confirmado de lo estimado, ignora lo ya acreditado y devuelve el próximo cobro", () => {
    const r = aCobrarPeya([
      { estado: "confirmado", total_liquidado: 37243.04, ingreso_estimado: 54368.1, fecha_pago_procesado: "2026-10-23", fecha_pago_estimada: null },
      { estado: "estimado", total_liquidado: null, ingreso_estimado: 40000, fecha_pago_procesado: null, fecha_pago_estimada: "2026-10-30" },
      { estado: "acreditado", total_liquidado: 99999, ingreso_estimado: 99999, fecha_pago_procesado: "2026-10-16", fecha_pago_estimada: null },
      { estado: "conciliado", total_liquidado: 88888, ingreso_estimado: 88888, fecha_pago_procesado: "2026-10-09", fecha_pago_estimada: null },
    ]);
    expect(r).toEqual({ confirmado: 37243.04, estimado: 40000, cantidad: 2, proxima: { fecha: "2026-10-23", confirmada: true } });
  });
  it("sin liquidaciones pendientes no hay próximo cobro", () => {
    expect(aCobrarPeya([])).toEqual({ confirmado: 0, estimado: 0, cantidad: 0, proxima: null });
  });
});
