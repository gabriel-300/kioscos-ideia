import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";
import nextConfig from "../../next.config";

// Las acciones de Tesorería escriben plata con el cliente admin (sin RLS): el permiso, la validación y el vínculo con
// lo que cargó el kiosco se verifican acá con el doble en memoria de Supabase.

const h = vi.hoisted(() => ({ permisos: null as any, admin: null as any }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tesoreria/permisos", () => ({ permisosTesoreria: async () => h.permisos }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin }));

import { anularEgreso, completarCostosEntrega, descartarEntrega, fijarVencimiento, guardarEfectivoInicial, marcarEgresoPagado, registrarEgreso, restaurarEntrega } from "@/app/(admin)/admin/tesoreria/actions";
import type { EgresoEntrada } from "@/lib/tesoreria/tipos";

const CARGA = { userId: "damian", puedeVer: true, puedeCargar: true };
const SOLO_VE = { userId: "javier", puedeVer: true, puedeCargar: false };

const entrada: EgresoEntrada = {
  fecha: "2026-10-04", monto: 29600, sucursal_id: "s1", categoria: "mercaderia", proveedor_id: null,
  descripcion: "Lo de Mario - fiambre", comprobante: "sin", comprobante_numero: null, comprobante_path: null,
  pagado: true, origen: "retiro_caja", gasto_fijo_id: null, nota: null, retiros_caja_ids: ["r1"], entregas_ids: [],
};

type Esc = { retirosDisponibles?: string[]; tomaRetiros?: string[]; insertError?: string; anulacionFilas?: number; pagoFilas?: number; descarteFilas?: number;
  efectivoActual?: number; cambiosPrevios?: number; historialError?: string; historialSinMigracion?: boolean;
  fechaCorte?: string;                 // fecha del saldo_inicial de la cuenta proveedor+kiosco
  repetido?: { fecha: string; monto: number };   // otro egreso vigente con el mismo comprobante_numero
  proveedorDelEgreso?: string | null;  // proveedor_id del egreso que se quiere marcar pagado
  egresoPrevio?: Record<string, unknown> | null;   // fila del egreso al que se le fija el vencimiento
  sinMigracion113?: boolean;           // la columna fecha_vencimiento no existe
};

function montar(permisos: unknown, e: Esc = {}) {
  h.permisos = permisos;
  const f = fakeAdmin((q: Q) => {
    switch (q.table) {
      case "tesoreria_config": return { data: { fecha_inicio: "2026-10-01", efectivo_inicial: e.efectivoActual ?? 0 } };
      case "tesoreria_historial":
        if (q.op === "select") return e.historialSinMigracion ? { error: { message: "relation does not exist" } } : { data: null, count: e.cambiosPrevios ?? 0 };
        return e.historialError ? { error: { message: e.historialError } } : { data: null };
      case "sucursales":       return { data: [{ id: "s1" }, { id: "s2" }] };
      case "movimientos":
        if (q.op === "update" && "tesoreria_descartado_en" in (q.payload ?? {})) return { data: Array.from({ length: e.descarteFilas ?? 1 }, () => ({ id: "m1", proveedor: "Petri" })) };
        return { data: null };
      case "retiros_caja":
        if (q.op === "select") return { data: (e.retirosDisponibles ?? ["r1"]).map((id) => ({ id, sucursal_id: "s1" })) };
        if (q.op === "update" && q.payload?.egreso_id) return { data: (e.tomaRetiros ?? ["r1"]).map((id) => ({ id })) };
        return { data: null };
      case "proveedor_cuenta":
        if (q.op === "select" && e.fechaCorte) {
          return { data: [{ id: "si", tipo: "saldo_inicial", proveedor_id: "p1", sucursal_id: "s1", fecha: e.fechaCorte, monto: 0, origen: null, nota: null, created_at: `${e.fechaCorte}T00:00:00Z`, created_by: null }] };
        }
        return { data: q.op === "select" ? [] : null };
      case "egresos":
        if (q.op === "select") {
          if (q.filters.some((f) => f.col === "comprobante_numero")) return { data: e.repetido ? [{ id: "e0", ...e.repetido }] : [] };   // chequeo de remito repetido
          if (q.filters.some((f) => f.col === "pagado")) return { data: [] };                                                           // compras pendientes de la cuenta
          if (e.sinMigracion113) return { error: { message: "column egresos.fecha_vencimiento does not exist" } };
          if (e.egresoPrevio !== undefined) return { data: e.egresoPrevio };                                                              // el egreso al que se le fija el vencimiento
          return { data: e.proveedorDelEgreso ? { proveedor_id: e.proveedorDelEgreso } : null };                                         // el egreso a marcar pagado
        }
        if (q.op === "insert") return e.insertError ? { error: { message: e.insertError } } : { data: { id: "e1" } };
        if (q.op === "update" && q.payload?.anulado_en) return { data: Array.from({ length: e.anulacionFilas ?? 1 }, () => ({ id: "e1", monto: 1500, descripcion: "Lo de Mario" })) };
        if (q.op === "update" && q.payload?.pagado) return { data: Array.from({ length: e.pagoFilas ?? 1 }, () => ({ id: "e1", monto: 1500, descripcion: "Lo de Mario" })) };
        return { data: null };
      default: return { data: null };
    }
  });
  h.admin = f.admin;
  return f;
}

const escrituras = (calls: Q[]) => calls.filter((q) => q.op !== "select");

beforeEach(() => { h.permisos = null; });

const historialDe = (calls: Q[]) => calls.filter((q) => q.table === "tesoreria_historial" && q.op === "insert").map((q) => q.payload);

describe("historial: cada acción deja su registro (quién, qué y por qué)", () => {
  it("cargar un egreso anota quién, el importe y con qué se pagó", async () => {
    const { calls } = montar(CARGA);
    await registrarEgreso(entrada);
    expect(historialDe(calls)).toEqual([expect.objectContaining({
      usuario_id: "damian", accion: "egreso_creado", entidad_id: "e1",
      detalle: expect.objectContaining({ monto: 29600, descripcion: "Lo de Mario - fiambre", comprobante: "sin", pagado: true, origen: "retiro_caja", retiros_de_caja: 1 }),
    })]);
  });

  it("marcar pagado, anular, descartar y restaurar anotan con el motivo cuando lo hay", async () => {
    let f = montar(CARGA);
    await marcarEgresoPagado("e1", { origen: "transferencia", fecha_pago: "2026-10-04" });
    expect(historialDe(f.calls)).toEqual([expect.objectContaining({ accion: "egreso_pagado", entidad_id: "e1", detalle: expect.objectContaining({ monto: 1500, origen: "transferencia" }) })]);

    f = montar(CARGA);
    await anularEgreso("e1", " lo cargué dos veces ");
    expect(historialDe(f.calls)).toEqual([expect.objectContaining({ accion: "egreso_anulado", motivo: "lo cargué dos veces", detalle: { monto: 1500, descripcion: "Lo de Mario" } })]);

    f = montar(CARGA);
    await descartarEntrega("m1", "se cargó dos veces");
    expect(historialDe(f.calls)).toEqual([expect.objectContaining({ accion: "entrega_descartada", entidad_id: "m1", motivo: "se cargó dos veces", detalle: { proveedor: "Petri" } })]);

    f = montar(CARGA);
    await restaurarEntrega("m1");
    expect(historialDe(f.calls)).toEqual([expect.objectContaining({ accion: "entrega_restaurada", entidad_id: "m1" })]);
  });

  it("lo que falla o no corresponde NO deja registro", async () => {
    let f = montar(CARGA, { anulacionFilas: 0 });
    await anularEgreso("e1", "otro motivo");
    expect(historialDe(f.calls)).toHaveLength(0);
    f = montar(SOLO_VE);
    await registrarEgreso(entrada);
    expect(f.calls).toHaveLength(0);
  });

  it("si el cambio se guardó pero no se pudo anotar, se avisa (no pasa desapercibido)", async () => {
    montar(CARGA, { historialError: "boom" });
    expect(await anularEgreso("e1", "motivo valido")).toEqual({ error: expect.stringContaining("no quedó anotado en el historial") });
  });
});

describe("efectivo inicial: la primera carga es libre, los cambios piden motivo y quedan con antes y después", () => {
  it("la primera vez no pide motivo y anota el valor nuevo", async () => {
    const { calls } = montar(CARGA, { cambiosPrevios: 0, efectivoActual: 0 });
    expect(await guardarEfectivoInicial(50000)).toEqual({});
    expect(calls.find((q) => q.table === "tesoreria_config" && q.op === "update")!.payload).toMatchObject({ efectivo_inicial: 50000, updated_by: "damian" });
    expect(historialDe(calls)).toEqual([expect.objectContaining({ accion: "efectivo_inicial_cambiado", usuario_id: "damian", detalle: { anterior: null, nuevo: 50000 } })]);
  });

  it("desde la segunda exige motivo, y deja el valor anterior y el nuevo", async () => {
    let f = montar(CARGA, { cambiosPrevios: 1, efectivoActual: 50000 });
    expect(await guardarEfectivoInicial(60000, "  ")).toEqual({ error: expect.stringContaining("por qué") });
    expect(f.calls.some((q) => q.table === "tesoreria_config" && q.op === "update")).toBe(false);

    f = montar(CARGA, { cambiosPrevios: 1, efectivoActual: 50000 });
    expect(await guardarEfectivoInicial(60000, "conté el efectivo y eran $60.000")).toEqual({});
    expect(historialDe(f.calls)).toEqual([expect.objectContaining({ motivo: "conté el efectivo y eran $60.000", detalle: { anterior: 50000, nuevo: 60000 } })]);
  });

  it("no acepta el mismo valor, montos inválidos, ni a quien no es administrativo", async () => {
    montar(CARGA, { efectivoActual: 50000 });
    expect(await guardarEfectivoInicial(50000, "igual")).toEqual({ error: expect.stringContaining("ya tiene ese valor") });
    expect(await guardarEfectivoInicial(-1, "motivo")).toEqual({ error: expect.any(String) });
    expect(await guardarEfectivoInicial(NaN, "motivo")).toEqual({ error: expect.any(String) });
    const f = montar(SOLO_VE);
    expect(await guardarEfectivoInicial(10, "motivo")).toEqual({ error: expect.stringContaining("administrativo") });
    expect(f.calls).toHaveLength(0);
  });

  it("sin la migración 104 avisa en vez de cambiar el valor sin dejar rastro", async () => {
    const f = montar(CARGA, { historialSinMigracion: true });
    expect(await guardarEfectivoInicial(70000)).toEqual({ error: expect.stringContaining("104") });
    expect(f.calls.some((q) => q.table === "tesoreria_config" && q.op === "update")).toBe(false);
  });
});

describe("permisos", () => {
  it("sin sesión, o solo con permiso de ver, no se escribe nada", async () => {
    for (const permisos of [null, SOLO_VE]) {
      const { calls } = montar(permisos);
      expect(await registrarEgreso(entrada)).toEqual({ error: expect.stringContaining("administrativo") });
      expect(await anularEgreso("e1", "error de carga")).toEqual({ error: expect.stringContaining("administrativo") });
      expect(await marcarEgresoPagado("e1", { origen: "transferencia", fecha_pago: "2026-10-04" })).toEqual({ error: expect.stringContaining("administrativo") });
      expect(calls).toHaveLength(0);
    }
  });
});

describe("registrarEgreso", () => {
  it("guarda el egreso con quién lo cargó y se queda con el retiro de caja del kiosco", async () => {
    const { calls } = montar(CARGA);
    expect(await registrarEgreso(entrada)).toEqual({});
    const insert = calls.find((q) => q.table === "egresos" && q.op === "insert")!;
    expect(insert.payload).toMatchObject({ created_by: "damian", origen: "retiro_caja", fecha_pago: "2026-10-04", monto: 29600, pagado: true });
    expect(insert.payload).not.toHaveProperty("retiros_caja_ids");   // los vínculos no son columnas de egresos
    const toma = calls.find((q) => q.table === "retiros_caja" && q.op === "update")!;
    expect(toma.payload).toEqual({ egreso_id: "e1" });
    expect(toma.filters.some((f) => f.op === "is" && f.col === "egreso_id" && f.val === null)).toBe(true);   // no pisa uno ya tomado
  });

  it("rechaza un retiro que ya fue registrado o no corresponde, sin crear nada", async () => {
    const { calls } = montar(CARGA, { retirosDisponibles: [] });
    expect(await registrarEgreso(entrada)).toEqual({ error: expect.stringContaining("ya fue registrado") });
    expect(escrituras(calls)).toHaveLength(0);
  });

  it("si otro administrativo se llevó el retiro en el medio, deshace lo suyo y avisa", async () => {
    const { calls } = montar(CARGA, { tomaRetiros: [] });
    expect(await registrarEgreso(entrada)).toEqual({ error: expect.stringContaining("Alguien más") });
    expect(calls.some((q) => q.table === "egresos" && q.op === "delete")).toBe(true);
    expect(calls.some((q) => q.table === "retiros_caja" && q.op === "update" && q.payload?.egreso_id === null)).toBe(true);
  });

  it("no acepta una sucursal que no entra en Tesorería", async () => {
    const { calls } = montar(CARGA);
    const r = await registrarEgreso({ ...entrada, sucursal_id: "villa-sarita" });
    expect(r).toEqual({ error: expect.stringContaining("no entra en Tesorería") });
    expect(escrituras(calls)).toHaveLength(0);
  });

  it("devuelve el error de validación sin tocar la base", async () => {
    const { calls } = montar(CARGA);
    expect(await registrarEgreso({ ...entrada, monto: -5 })).toEqual({ error: expect.any(String) });
    expect(calls).toHaveLength(0);
  });

  it("si la base rechaza el insert, devuelve el error (no lanza)", async () => {
    montar(CARGA, { insertError: "violates check constraint" });
    expect(await registrarEgreso(entrada)).toEqual({ error: "violates check constraint" });
  });
});

describe("registrarEgreso: compras de un proveedor de la lista (cuenta corriente)", () => {
  const compra: EgresoEntrada = {
    ...entrada, proveedor_id: "p1", sucursal_id: "s1", pagado: false, origen: null, retiros_caja_ids: [],
    fecha: "2026-10-04", comprobante: "sin", comprobante_numero: "0005-123",
  };
  const insertsEgreso = (calls: Q[]) => calls.filter((q) => q.table === "egresos" && q.op === "insert");

  it("una compra con proveedor «se debe» y se guarda con su kiosco y número", async () => {
    const { calls } = montar(CARGA);
    expect(await registrarEgreso(compra)).toEqual({});
    expect(insertsEgreso(calls)).toHaveLength(1);
    expect(insertsEgreso(calls)[0].payload).toMatchObject({ proveedor_id: "p1", sucursal_id: "s1", pagado: false, origen: null, comprobante_numero: "0005-123" });
  });

  it("una compra con fecha igual o anterior al corte del saldo inicial se rechaza con la fecha, sin guardar", async () => {
    for (const [fechaCorte, dma] of [["2026-10-04", "04/10/2026"], ["2026-10-05", "05/10/2026"]]) {
      const { calls } = montar(CARGA, { fechaCorte });
      const r = await registrarEgreso(compra);   // compra del 04/10/2026
      expect(r).toEqual({ error: expect.stringContaining(dma) });
      expect(insertsEgreso(calls)).toEqual([]);
    }
    const { calls } = montar(CARGA, { fechaCorte: "2026-10-01" });
    expect(await registrarEgreso({ ...compra, fecha: "2026-10-02" })).toEqual({});   // posterior al corte
    expect(insertsEgreso(calls)).toHaveLength(1);
  });

  it("un remito con el mismo proveedor, kiosco y número que otro vigente se rechaza con el número, sin guardar", async () => {
    const { calls } = montar(CARGA, { repetido: { fecha: "2026-10-02", monto: 5000 } });
    const r = await registrarEgreso(compra);
    expect(r.error).toContain("0005-123");
    expect(r.error).toContain("02/10/2026");
    expect(insertsEgreso(calls)).toEqual([]);
    const chequeo = calls.find((q) => q.table === "egresos" && q.op === "select" && q.filters.some((f) => f.col === "comprobante_numero"))!;
    expect(chequeo.filters).toContainEqual(expect.objectContaining({ op: "eq", col: "proveedor_id", val: "p1" }));
    expect(chequeo.filters).toContainEqual(expect.objectContaining({ op: "eq", col: "sucursal_id", val: "s1" }));
    expect(chequeo.filters).toContainEqual(expect.objectContaining({ op: "is", col: "anulado_en", val: null }));   // los anulados no cuentan
  });

  it("con otro número el remito se guarda", async () => {
    const { calls } = montar(CARGA);   // no hay otro egreso con ese número
    expect(await registrarEgreso({ ...compra, comprobante_numero: "0005-124" })).toEqual({});
    expect(insertsEgreso(calls)).toHaveLength(1);
  });

  it("sin número de comprobante no se chequea repetido", async () => {
    const { calls } = montar(CARGA, { repetido: { fecha: "2026-10-02", monto: 5000 } });
    expect(await registrarEgreso({ ...compra, comprobante_numero: null })).toEqual({});
    expect(calls.some((q) => q.table === "egresos" && q.filters.some((f) => f.col === "comprobante_numero"))).toBe(false);
  });

  it("una compra con proveedor marcada «ya se pagó», o sin kiosco, no toca la base", async () => {
    const { calls } = montar(CARGA);
    expect(await registrarEgreso({ ...compra, pagado: true, origen: "efectivo_tesoreria" })).toHaveProperty("error");
    expect(await registrarEgreso({ ...compra, sucursal_id: null })).toHaveProperty("error");
    expect(calls).toHaveLength(0);
  });

  it("sin proveedor no se consulta la cuenta ni el remito repetido", async () => {
    const { calls } = montar(CARGA, { repetido: { fecha: "2026-10-02", monto: 5000 }, fechaCorte: "2026-10-05" });
    expect(await registrarEgreso({ ...compra, proveedor_id: null, comprobante_numero: "0005-123" })).toEqual({});
    expect(calls.some((q) => q.table === "proveedor_cuenta")).toBe(false);
  });
});

describe("anularEgreso", () => {
  it("anula con motivo y libera lo que tenía vinculado (vuelve a «Para registrar»)", async () => {
    const { calls } = montar(CARGA);
    expect(await anularEgreso("e1", " lo cargué dos veces ")).toEqual({});
    const anula = calls.find((q) => q.table === "egresos" && q.op === "update")!;
    expect(anula.payload).toMatchObject({ anulado_por: "damian", anulado_motivo: "lo cargué dos veces" });
    expect(calls.some((q) => q.table === "retiros_caja" && q.payload?.egreso_id === null)).toBe(true);
    expect(calls.some((q) => q.table === "movimientos" && q.payload?.egreso_id === null)).toBe(true);
    expect(calls.some((q) => q.op === "delete")).toBe(false);   // nunca se borra una fila de plata
  });

  it("exige motivo y no anula dos veces", async () => {
    montar(CARGA);
    expect(await anularEgreso("e1", "  ")).toEqual({ error: expect.stringContaining("motivo") });
    montar(CARGA, { anulacionFilas: 0 });
    expect(await anularEgreso("e1", "otro motivo")).toEqual({ error: expect.stringContaining("ya estaba anulado") });
  });
});

describe("no corresponde (ingresos del kiosco sin compra)", () => {
  it("marca la entrega con quién, cuándo y por qué, sin tocar el stock (solo columnas de Tesorería)", async () => {
    const { calls } = montar(CARGA);
    expect(await descartarEntrega("m1", " se cargó dos veces ")).toEqual({});
    const up = calls.find((q) => q.table === "movimientos" && q.op === "update")!;
    expect(up.payload).toMatchObject({ tesoreria_descartado_por: "damian", tesoreria_descartado_motivo: "se cargó dos veces" });
    expect(Object.keys(up.payload).every((k) => k.startsWith("tesoreria_"))).toBe(true);
    expect(up.filters.some((f) => f.op === "is" && f.col === "egreso_id" && f.val === null)).toBe(true);   // no pisa una ya registrada
  });

  it("exige motivo, no descarta dos veces y no se puede deshacer sin permiso", async () => {
    montar(CARGA);
    expect(await descartarEntrega("m1", "  ")).toEqual({ error: expect.stringContaining("por qué") });
    montar(CARGA, { descarteFilas: 0 });
    expect(await descartarEntrega("m1", "otro motivo")).toEqual({ error: expect.stringContaining("ya fue") });
    montar(SOLO_VE);
    expect(await descartarEntrega("m1", "motivo")).toEqual({ error: expect.stringContaining("administrativo") });
    expect(await restaurarEntrega("m1")).toEqual({ error: expect.stringContaining("administrativo") });
  });

  it("se puede volver a la lista", async () => {
    const { calls } = montar(CARGA);
    expect(await restaurarEntrega("m1")).toEqual({});
    expect(calls.find((q) => q.table === "movimientos" && q.op === "update")!.payload).toEqual({ tesoreria_descartado_en: null, tesoreria_descartado_por: null, tesoreria_descartado_motivo: null });
  });
});

describe("marcarEgresoPagado", () => {
  it("marca pagada una compra pendiente", async () => {
    const { calls } = montar(CARGA);
    expect(await marcarEgresoPagado("e1", { origen: "transferencia", fecha_pago: "2026-10-04" })).toEqual({});
    const up = calls.find((q) => q.table === "egresos" && q.op === "update")!;
    expect(up.payload).toMatchObject({ pagado: true, origen: "transferencia", fecha_pago: "2026-10-04", updated_by: "damian" });
    expect(up.filters.some((f) => f.op === "eq" && f.col === "pagado" && f.val === false)).toBe(true);   // solo las pendientes
  });

  it("una compra de un proveedor de la lista se paga desde Proveedores: manda allá y no actualiza nada", async () => {
    const { calls } = montar(CARGA, { proveedorDelEgreso: "p1" });
    const r = await marcarEgresoPagado("e1", { origen: "transferencia", fecha_pago: "2026-10-04" });
    expect(r).toEqual({ error: expect.stringContaining("Proveedores") });
    expect(escrituras(calls)).toEqual([]);
  });

  it("una compra sin proveedor sigue marcándose pagada", async () => {
    const { calls } = montar(CARGA, { proveedorDelEgreso: null });
    expect(await marcarEgresoPagado("e1", { origen: "transferencia", fecha_pago: "2026-10-04" })).toEqual({});
    expect(calls.some((q) => q.table === "egresos" && q.op === "update")).toBe(true);
  });

  it("no acepta retiro de caja como forma de pago, ni una compra que ya estaba pagada", async () => {
    montar(CARGA);
    expect(await marcarEgresoPagado("e1", { origen: "retiro_caja", fecha_pago: "2026-10-04" })).toEqual({ error: expect.any(String) });
    montar(CARGA, { pagoFilas: 0 });
    expect(await marcarEgresoPagado("e1", { origen: "transferencia", fecha_pago: "2026-10-04" })).toEqual({ error: expect.stringContaining("ya estaba pagada") });
  });
});

describe("redirecciones de las pantallas que se unificaron en Tesorería", () => {
  it("Pagos a proveedores y Socios (globales y por kiosco) llegan a Tesorería, y son temporales", async () => {
    const reglas = (await nextConfig.redirects!()) as { source: string; destination: string; permanent: boolean }[];
    for (const source of ["/admin/pagos-proveedores", "/admin/socios", "/admin/sucursales/:id/pagos-proveedores", "/admin/sucursales/:id/socios"]) {
      const r = reglas.find((x) => x.source === source);
      expect(r?.destination, source).toBe("/admin/tesoreria?vista=egresos");
      expect(r?.permanent, source).toBe(false);
    }
  });
});

describe("dos personas cargando el mismo remito a la vez", () => {
  it("si la base lo frena por el índice único, se muestra el mismo mensaje claro (no el error crudo)", async () => {
    montar(CARGA, { insertError: 'duplicate key value violates unique constraint "egresos_remito_unico"' });
    const r = await registrarEgreso({ ...entrada, origen: "efectivo_tesoreria", retiros_caja_ids: [], comprobante_numero: "2416" });
    expect(r).toEqual({ error: expect.stringContaining("Ya está cargado el remito o factura N° 2416") });
  });
});
describe("fijarVencimiento (migración 113)", () => {
  const previo = { id: "e1", fecha: "2026-10-01", descripcion: "Remito N° 2264 — Petri", pagado: false, anulado_en: null, fecha_vencimiento: null };
  const updatesVence = (calls: Q[]) => calls.filter((q) => q.table === "egresos" && q.op === "update");

  it("sin permiso de cargar no escribe nada", async () => {
    const f = montar(SOLO_VE, { egresoPrevio: previo });
    expect(await fijarVencimiento("e1", "2026-11-10")).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("fija el vencimiento con quién lo hizo y lo anota en el historial (antes y después)", async () => {
    const f = montar(CARGA, { egresoPrevio: previo });
    expect(await fijarVencimiento("e1", "2026-11-10")).toEqual({});
    const u = updatesVence(f.calls);
    expect(u).toHaveLength(1);
    expect(u[0].payload).toMatchObject({ fecha_vencimiento: "2026-11-10", updated_by: "damian" });
    expect(historialDe(f.calls)).toEqual([expect.objectContaining({ accion: "egreso_vencimiento", entidad_id: "e1", detalle: { descripcion: "Remito N° 2264 — Petri", anterior: null, nuevo: "2026-11-10" } })]);
  });

  it("corregirlo guarda el valor anterior; sacarlo lo deja vacío", async () => {
    let f = montar(CARGA, { egresoPrevio: { ...previo, fecha_vencimiento: "2026-11-10" } });
    expect(await fijarVencimiento("e1", "2026-11-20")).toEqual({});
    expect(historialDe(f.calls)[0]).toMatchObject({ detalle: { anterior: "2026-11-10", nuevo: "2026-11-20" } });
    f = montar(CARGA, { egresoPrevio: { ...previo, fecha_vencimiento: "2026-11-10" } });
    expect(await fijarVencimiento("e1", null)).toEqual({});
    expect(updatesVence(f.calls)[0].payload).toMatchObject({ fecha_vencimiento: null });
  });

  it("si no cambia nada, no escribe ni anota", async () => {
    const f = montar(CARGA, { egresoPrevio: { ...previo, fecha_vencimiento: "2026-11-10" } });
    expect(await fijarVencimiento("e1", "2026-11-10")).toEqual({});
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("rechaza fecha inválida, anterior a la compra, comprobante pagado, anulado o inexistente", async () => {
    let f = montar(CARGA, { egresoPrevio: previo });
    expect(await fijarVencimiento("e1", "2026-99-99")).toHaveProperty("error");
    expect(await fijarVencimiento("e1", "2026-09-30")).toEqual({ error: expect.stringContaining("anterior") });
    expect(escrituras(f.calls)).toEqual([]);
    f = montar(CARGA, { egresoPrevio: { ...previo, pagado: true } });
    expect(await fijarVencimiento("e1", "2026-11-10")).toEqual({ error: expect.stringContaining("pagado") });
    f = montar(CARGA, { egresoPrevio: { ...previo, anulado_en: "2026-10-05T00:00:00Z" } });
    expect(await fijarVencimiento("e1", "2026-11-10")).toHaveProperty("error");
    f = montar(CARGA, { egresoPrevio: null });
    expect(await fijarVencimiento("e1", "2026-11-10")).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("si falta la migración 113, lo dice", async () => {
    montar(CARGA, { sinMigracion113: true });
    expect(await fijarVencimiento("e1", "2026-11-10")).toEqual({ error: expect.stringContaining("migración 113") });
  });

  it("si se guardó pero no se pudo anotar en el historial, avisa", async () => {
    montar(CARGA, { egresoPrevio: previo, historialError: "boom" });
    expect(await fijarVencimiento("e1", "2026-11-10")).toEqual({ error: expect.stringContaining("historial") });
  });
});

describe("completarCostosEntrega (costos de una mercadería que ingresó al kiosco)", () => {
  const entrega = {
    id: "m1", tipo: "entrega", sucursal_id: "s1", proveedor: "Petri", anulado_en: null,
    movimiento_items: [
      { id: "i1", product_id: "pa", cantidad: 10, precio_unitario: null },
      { id: "i2", product_id: "pb", cantidad: 2.5, precio_unitario: null },
    ],
  };
  const hechos = (calls: Q[], tabla: string, op: Q["op"]) => calls.filter((q) => q.table === tabla && q.op === op);

  function montarCostos(e: { mov?: Record<string, unknown> | null; costosActuales?: { product_id: string; costo: number | null }[]; permisos?: unknown; errorItems?: string; historialError?: string } = {}) {
    h.permisos = e.permisos === undefined ? CARGA : e.permisos;
    const f = fakeAdmin((q: Q) => {
      switch (q.table) {
        case "movimientos": return { data: e.mov === undefined ? entrega : e.mov };
        case "sucursales": return { data: [{ id: "s1" }] };
        case "movimiento_items": return q.op === "update" && e.errorItems ? { error: { message: e.errorItems } } : { data: null };
        case "product_prices": return { data: e.costosActuales ?? [] };
        case "tesoreria_historial": return e.historialError ? { error: { message: e.historialError } } : { data: null };
        default: return { data: null };
      }
    });
    h.admin = f.admin;
    return f;
  }

  it("sin permiso de cargar no escribe nada", async () => {
    const f = montarCostos({ permisos: SOLO_VE });
    expect(await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: 100 }])).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("guarda el costo y el importe de cada línea (cantidad × costo) y lo anota en el historial", async () => {
    const f = montarCostos();
    expect(await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: 120 }, { id: "i2", precio_unitario: 99.99 }])).toEqual({});
    const upd = hechos(f.calls, "movimiento_items", "update");
    expect(upd.map((q) => q.payload)).toEqual([{ precio_unitario: 120, subtotal: 1200 }, { precio_unitario: 99.99, subtotal: 249.98 }]);
    expect(historialDe(f.calls)).toEqual([expect.objectContaining({ accion: "entrega_costos", entidad_id: "m1", detalle: { proveedor: "Petri", productos: 2, total: 1449.98, alertas: 0 } })]);
  });

  it("un costo vacío deja la línea sin costo", async () => {
    const f = montarCostos({ mov: { ...entrega, movimiento_items: [{ id: "i1", product_id: "pa", cantidad: 10, precio_unitario: 50 }] } });
    expect(await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: null }])).toEqual({});
    expect(hechos(f.calls, "movimiento_items", "update")[0].payload).toEqual({ precio_unitario: null, subtotal: null });
  });

  it("si el costo cambió respecto del actual del producto, deja un aviso de precio (y reemplaza uno viejo sin resolver)", async () => {
    const f = montarCostos({ costosActuales: [{ product_id: "pa", costo: 100 }, { product_id: "pb", costo: 99.99 }] });
    await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: 120 }, { id: "i2", precio_unitario: 99.99 }]);
    const nuevas = hechos(f.calls, "alertas_precio", "insert");
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0].payload).toEqual([{ movimiento_id: "m1", product_id: "pa", proveedor: "Petri", costo_anterior: 100, costo_nuevo: 120 }]);
    expect(hechos(f.calls, "alertas_precio", "delete")).toHaveLength(1);
  });

  it("sin costo actual cargado no hay aviso", async () => {
    const f = montarCostos({ costosActuales: [{ product_id: "pa", costo: null }] });
    await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: 120 }]);
    expect(hechos(f.calls, "alertas_precio", "insert")).toEqual([]);
  });

  it("si no cambia nada, no escribe ni anota", async () => {
    const f = montarCostos({ mov: { ...entrega, movimiento_items: [{ id: "i1", product_id: "pa", cantidad: 10, precio_unitario: 120 }] } });
    expect(await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: 120 }])).toEqual({});
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("rechaza costos inválidos, líneas ajenas, ingresos anulados o inexistentes y locales fuera de Tesorería, sin escribir", async () => {
    let f = montarCostos();
    expect(await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: -1 }])).toHaveProperty("error");
    expect(await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: Number.NaN }])).toHaveProperty("error");
    expect(await completarCostosEntrega("m1", [])).toHaveProperty("error");
    expect(await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: 1 }, { id: "i1", precio_unitario: 2 }])).toHaveProperty("error");
    expect(await completarCostosEntrega("m1", [{ id: "ajena", precio_unitario: 5 }])).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
    f = montarCostos({ mov: { ...entrega, anulado_en: "2026-10-05T00:00:00Z" } });
    expect(await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: 5 }])).toHaveProperty("error");
    f = montarCostos({ mov: null });
    expect(await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: 5 }])).toHaveProperty("error");
    f = montarCostos({ mov: { ...entrega, tipo: "venta" } });
    expect(await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: 5 }])).toHaveProperty("error");
    f = montarCostos({ mov: { ...entrega, sucursal_id: "otra" } });
    expect(await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: 5 }])).toEqual({ error: expect.stringContaining("Tesorería") });
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("si la base falla al guardar un costo, devuelve el error", async () => {
    montarCostos({ errorItems: "boom" });
    expect(await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: 5 }])).toEqual({ error: "boom" });
  });

  it("si se guardó pero no se pudo anotar en el historial, avisa", async () => {
    montarCostos({ historialError: "boom" });
    expect(await completarCostosEntrega("m1", [{ id: "i1", precio_unitario: 5 }])).toEqual({ error: expect.stringContaining("historial") });
  });
});
