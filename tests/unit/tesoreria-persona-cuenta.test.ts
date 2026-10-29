import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";
import { calcularCuentaPersona, validarMovimientoPersona, type MovimientoPersona } from "@/lib/tesoreria/persona-cuenta";
import { calcularSaldoMp, type MovimientoMp } from "@/lib/tesoreria/cuenta-mp";
import { cargarFlujosPersonas } from "@/lib/tesoreria/persona-cuenta-consultas";

const h = vi.hoisted(() => ({ permisos: null as unknown, admin: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tesoreria/permisos", () => ({ permisosTesoreria: async () => h.permisos }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin }));

import { anularMovimientoPersona, registrarMovimientoPersona } from "@/app/(admin)/admin/tesoreria/persona-actions";

const JAVIER = "11111111-1111-4111-8111-111111111111";

const mov = (o: Partial<MovimientoPersona> & Pick<MovimientoPersona, "tipo" | "fecha" | "monto">): MovimientoPersona => ({
  id: `${o.tipo}-${o.fecha}-${o.monto}`, persona_id: JAVIER, origen: null, nota: null, created_at: "2026-10-30T00:00:00Z", created_by: null, ...o,
});

describe("calcularCuentaPersona", () => {
  it("debe = saldo inicial + adelantos − reposiciones − descuentos de sueldo", () => {
    const c = calcularCuentaPersona([
      mov({ tipo: "saldo_inicial", fecha: "2026-10-27", monto: 4476000 }),
      mov({ tipo: "adelanto", fecha: "2026-11-02", monto: 300000, origen: "efectivo_tesoreria" }),
      mov({ tipo: "reposicion", fecha: "2026-11-05", monto: 1000000, origen: "transferencia" }),
      mov({ tipo: "descuento_sueldo", fecha: "2026-11-10", monto: 200000 }),
    ]);
    expect(c).toEqual({ desde: "2026-10-27", saldoInicial: 4476000, adelantos: 300000, reposiciones: 1000000, descuentos: 200000, debe: 3576000 });
  });

  it("lo anterior al saldo inicial no suma ni resta (el saldo inicial ya lo trae)", () => {
    const c = calcularCuentaPersona([
      mov({ tipo: "saldo_inicial", fecha: "2026-10-27", monto: 1000 }),
      mov({ tipo: "adelanto", fecha: "2026-10-20", monto: 999, origen: "transferencia" }),
    ]);
    expect(c.debe).toBe(1000);
  });

  it("sin saldo inicial cuenta todo; si repone de más queda a favor (negativo)", () => {
    expect(calcularCuentaPersona([mov({ tipo: "adelanto", fecha: "2026-11-01", monto: 500, origen: "mercadopago" })])).toMatchObject({ desde: null, debe: 500 });
    expect(calcularCuentaPersona([
      mov({ tipo: "saldo_inicial", fecha: "2026-10-27", monto: 100 }),
      mov({ tipo: "reposicion", fecha: "2026-11-01", monto: 150, origen: "efectivo_tesoreria" }),
    ]).debe).toBe(-50);
  });
});

describe("validarMovimientoPersona", () => {
  const base = { persona_id: JAVIER, tipo: "adelanto", fecha: "2026-11-02", monto: 1000, origen: "efectivo_tesoreria", nota: null };
  const hoy = "2026-11-10";

  it("un adelanto y una reposición exigen de dónde salió o adónde entró la plata", () => {
    expect(validarMovimientoPersona({ ...base, origen: null }, hoy)).toEqual({ error: "Indicá de dónde salió la plata" });
    expect(validarMovimientoPersona({ ...base, tipo: "reposicion", origen: "retiro_caja" }, hoy)).toEqual({ error: "Indicá adónde entró la plata" });
    expect(validarMovimientoPersona(base, hoy)).toHaveProperty("valor");
  });

  it("el saldo inicial y el descuento de sueldo no llevan origen aunque lo manden", () => {
    for (const tipo of ["saldo_inicial", "descuento_sueldo"]) {
      const r = validarMovimientoPersona({ ...base, tipo }, hoy);
      expect(r).toHaveProperty("valor");
      expect((r as { valor: { origen: unknown } }).valor.origen).toBeNull();
    }
  });

  it("acepta un saldo inicial en cero pero ningún otro movimiento en cero", () => {
    expect(validarMovimientoPersona({ ...base, tipo: "saldo_inicial", monto: 0 }, hoy)).toHaveProperty("valor");
    expect(validarMovimientoPersona({ ...base, monto: 0 }, hoy)).toHaveProperty("error");
    expect(validarMovimientoPersona({ ...base, tipo: "saldo_inicial", monto: -1 }, hoy)).toHaveProperty("error");
  });

  it("rechaza fecha futura o inválida, persona mal escrita y tipo desconocido", () => {
    expect(validarMovimientoPersona({ ...base, fecha: "2026-12-01" }, hoy)).toHaveProperty("error");
    expect(validarMovimientoPersona({ ...base, fecha: "2026-02-30" }, hoy)).toHaveProperty("error");
    expect(validarMovimientoPersona({ ...base, persona_id: "no-es-uuid" }, hoy)).toHaveProperty("error");
    expect(validarMovimientoPersona({ ...base, tipo: "regalo" }, hoy)).toHaveProperty("error");
  });
});

describe("Mercado Pago con adelantos y reposiciones de personas", () => {
  const ini: MovimientoMp = { id: "ini", tipo: "saldo_inicial", fecha: "2026-10-27", monto: 840531, nota: null, created_at: "2026-10-30T00:00:00Z", created_by: null };
  it("un adelanto desde Mercado Pago baja el saldo y una reposición lo sube", () => {
    const s = calcularSaldoMp({
      movimientos: [ini], cobros: [], ahoraMs: Date.parse("2026-11-01T12:00:00-03:00"),
      pagos: [{ monto: 100000, fecha: "2026-10-27" }],
      reposiciones: [{ monto: 30000, fecha: "2026-10-27" }],
    });
    expect(s).toMatchObject({ pagos: 100000, ingresos: 30000, total: 840531 - 100000 + 30000 });
  });
});

describe("cargarFlujosPersonas", () => {
  it("suma adelantos y reposiciones del origen pedido desde la fecha pedida", async () => {
    const f = fakeAdmin((q: Q) => q.table === "persona_cuenta" ? { data: [{ tipo: "adelanto", monto: "250000" }, { tipo: "reposicion", monto: "40000" }, { tipo: "adelanto", monto: "50000" }] } : undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await cargarFlujosPersonas(f.admin as any, "efectivo_tesoreria", "2026-10-27")).toEqual({ adelantos: 300000, reposiciones: 40000 });
    const q = f.calls[0];
    expect(q.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", col: "origen", val: "efectivo_tesoreria" }),
      expect.objectContaining({ op: "gte", col: "fecha", val: "2026-10-27" }),
      expect.objectContaining({ op: "is", col: "anulado_en" }),
    ]));
  });

  it("sin la migración 129 devuelve cero; cualquier otro error se propaga", async () => {
    let f = fakeAdmin(() => ({ error: { message: 'relation "public.persona_cuenta" does not exist' } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await cargarFlujosPersonas(f.admin as any, "mercadopago", "2026-10-27")).toEqual({ adelantos: 0, reposiciones: 0 });
    f = fakeAdmin(() => ({ error: { message: "connection reset" } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(cargarFlujosPersonas(f.admin as any, "mercadopago", "2026-10-27")).rejects.toThrow();
  });
});

// ── Acciones ────────────────────────────────────────────────────────────────
const CARGA = { userId: "damian", puedeVer: true, puedeCargar: true };
const SOLO_VE = { userId: "javier", puedeVer: true, puedeCargar: false };
type Esc = { insertError?: string; anulaFilas?: number; historialError?: string; sinPersona?: boolean };

function montar(permisos: unknown, e: Esc = {}) {
  h.permisos = permisos;
  const f = fakeAdmin((q: Q) => {
    if (q.table === "profiles") return { data: e.sinPersona ? null : { id: JAVIER, full_name: " Javier Acuña " } };
    if (q.table === "persona_cuenta") {
      if (q.op === "insert") return e.insertError ? { error: { message: e.insertError } } : { data: { id: "p1" } };
      if (q.op === "update") return { data: Array.from({ length: e.anulaFilas ?? 1 }, () => ({ id: "p1", persona_id: JAVIER, tipo: "adelanto", monto: 300000 })) };
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

describe("registrarMovimientoPersona", () => {
  const adelanto = { persona_id: JAVIER, tipo: "adelanto", fecha: "2020-01-05", monto: 300000, origen: "efectivo_tesoreria", nota: "para el alquiler" };

  it("sin permiso de cargar no escribe nada", async () => {
    for (const permisos of [null, SOLO_VE]) {
      const f = montar(permisos);
      expect(await registrarMovimientoPersona(adelanto)).toHaveProperty("error");
      expect(escrituras(f.calls)).toEqual([]);
    }
  });

  it("guarda el adelanto con quién lo cargó y lo anota con el nombre de la persona", async () => {
    const { calls } = montar(CARGA);
    expect(await registrarMovimientoPersona(adelanto)).toEqual({});
    expect(calls.find((q) => q.table === "persona_cuenta" && q.op === "insert")!.payload)
      .toMatchObject({ persona_id: JAVIER, tipo: "adelanto", monto: 300000, origen: "efectivo_tesoreria", created_by: "damian" });
    expect(historialDe(calls)).toEqual([expect.objectContaining({
      accion: "persona_adelanto", entidad_id: "p1", motivo: "para el alquiler",
      detalle: { persona: "Javier Acuña", monto: 300000, fecha: "2020-01-05", origen: "efectivo_tesoreria" },
    })]);
  });

  it("cada tipo queda con su propia acción en el historial", async () => {
    const esperadas = { saldo_inicial: "persona_saldo_inicial", reposicion: "persona_reposicion", descuento_sueldo: "persona_descuento_sueldo" };
    for (const [tipo, accion] of Object.entries(esperadas)) {
      const { calls } = montar(CARGA);
      await registrarMovimientoPersona({ ...adelanto, tipo, origen: tipo === "reposicion" ? "transferencia" : null });
      expect(historialDe(calls)[0]).toMatchObject({ accion });
    }
  });

  it("un segundo saldo inicial da un mensaje claro, y sin la migración 129 lo dice", async () => {
    montar(CARGA, { insertError: 'duplicate key value violates unique constraint "persona_cuenta_saldo_inicial_uni"' });
    expect((await registrarMovimientoPersona({ ...adelanto, tipo: "saldo_inicial", origen: null })).error).toMatch(/ya tiene un saldo inicial/);
    montar(CARGA, { insertError: 'relation "public.persona_cuenta" does not exist' });
    expect((await registrarMovimientoPersona(adelanto)).error).toMatch(/migración 129/);
  });

  it("rechaza datos inválidos y personas que no existen antes de escribir", async () => {
    let f = montar(CARGA);
    expect(await registrarMovimientoPersona({ ...adelanto, monto: 0 })).toHaveProperty("error");
    expect(await registrarMovimientoPersona({ ...adelanto, fecha: "2999-01-01" })).toHaveProperty("error");
    expect(f.calls).toEqual([]);
    f = montar(CARGA, { sinPersona: true });
    expect((await registrarMovimientoPersona(adelanto)).error).toMatch(/No se encontró/);
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("si no pudo anotar el historial lo avisa", async () => {
    montar(CARGA, { historialError: "boom" });
    expect((await registrarMovimientoPersona(adelanto)).error).toMatch(/no quedó anotado en el historial/);
  });
});

describe("anularMovimientoPersona", () => {
  it("exige motivo y permiso", async () => {
    let f = montar(CARGA);
    expect(await anularMovimientoPersona("p1", " ")).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
    f = montar(SOLO_VE);
    expect(await anularMovimientoPersona("p1", "lo cargué dos veces")).toHaveProperty("error");
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("anula con quién y por qué, y lo anota; si ya estaba anulado no anota nada", async () => {
    let f = montar(CARGA);
    expect(await anularMovimientoPersona("p1", " cargado dos veces ")).toEqual({});
    expect(f.calls.find((q) => q.table === "persona_cuenta" && q.op === "update")!.payload).toMatchObject({ anulado_por: "damian", anulado_motivo: "cargado dos veces" });
    expect(historialDe(f.calls)).toEqual([expect.objectContaining({
      accion: "persona_movimiento_anulado", detalle: { persona: "Javier Acuña", tipo: "adelanto", monto: 300000 },
    })]);

    f = montar(CARGA, { anulaFilas: 0 });
    expect((await anularMovimientoPersona("p1", "motivo válido")).error).toMatch(/ya estaba anulado/);
    expect(historialDe(f.calls)).toEqual([]);
  });
});
