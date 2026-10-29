import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";
import { FICHA_VACIA, cambiosDeFicha, faltantesDeFicha, normalizarCbuAlias, validarFichaPersonal, type FichaPersonal } from "@/lib/personal/ficha";
import { cargarFiadoPersona } from "@/lib/personal/ficha-consultas";

const h = vi.hoisted(() => ({ permisos: null as unknown, admin: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tesoreria/permisos", () => ({ permisosTesoreria: async () => h.permisos }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin }));

import { guardarFichaPersonal } from "@/app/(admin)/admin/staff/ficha-actions";

const PERSONA = "22222222-2222-4222-8222-222222222222";
const valida = (e: Record<string, unknown>) => {
  const r = validarFichaPersonal(e);
  if ("error" in r) throw new Error(r.error);
  return r.valor;
};

describe("validarFichaPersonal", () => {
  it("una ficha vacía es válida: todo es opcional", () => {
    expect(valida({})).toEqual(FICHA_VACIA);
  });

  it("limpia espacios, normaliza el CUIL a 11 dígitos y redondea los números", () => {
    const f = valida({ puesto: "  Vendedor   mañana ", cuil: "20-12345678-6", sueldo_acordado: "850000,555", horas_semanales: "24.04", dia_pago: "5" });
    expect(f).toMatchObject({ puesto: "Vendedor mañana", cuil: "20123456786", sueldo_acordado: 850000.56, horas_semanales: 24, dia_pago: 5 });
  });

  it("rechaza un CUIL con el dígito verificador mal", () => {
    expect(validarFichaPersonal({ cuil: "20-12345678-1" })).toEqual({ error: "El CUIL no es válido: revisá los 11 dígitos" });
  });

  it("valida las fechas con calendario estricto y que el egreso no sea anterior al ingreso", () => {
    expect(validarFichaPersonal({ fecha_ingreso: "2026-02-30" })).toHaveProperty("error");
    expect(validarFichaPersonal({ fecha_ingreso: "2026-11-01", fecha_egreso: "2026-10-01" })).toEqual({ error: "La fecha de egreso no puede ser anterior a la de ingreso" });
    expect(validarFichaPersonal({ fecha_ingreso: "2026-11-01" })).toHaveProperty("valor");   // un alta futura (noviembre) es válida
  });

  it("rechaza opciones que no existen, horas fuera de rango y día de pago inválido", () => {
    expect(validarFichaPersonal({ jornada: "nocturna" })).toHaveProperty("error");
    expect(validarFichaPersonal({ forma_pago: "cheque" })).toHaveProperty("error");
    expect(validarFichaPersonal({ horas_semanales: 80 })).toHaveProperty("error");
    expect(validarFichaPersonal({ dia_pago: 0 })).toHaveProperty("error");
    expect(validarFichaPersonal({ dia_pago: 5.5 })).toHaveProperty("error");
    expect(validarFichaPersonal({ tope_descuento_pct: 120 })).toHaveProperty("error");
  });

  it("el sueldo en recibo no puede superar al acordado", () => {
    expect(validarFichaPersonal({ sueldo_acordado: 500000, sueldo_en_recibo: 600000 })).toEqual({ error: "El sueldo en recibo no puede ser mayor que el sueldo acordado" });
    expect(validarFichaPersonal({ sueldo_acordado: 900000, sueldo_en_recibo: 500000 })).toHaveProperty("valor");
  });

  it("el CBU son 22 dígitos y el alias de 6 a 20 caracteres", () => {
    expect(normalizarCbuAlias("0000003100012345678901")).toBe("0000003100012345678901");
    expect(normalizarCbuAlias("000000310001234567890")).toBe("invalido");
    expect(normalizarCbuAlias("mi.alias.mp")).toBe("mi.alias.mp");
    expect(normalizarCbuAlias("ab")).toBe("invalido");
    expect(normalizarCbuAlias("  ")).toBeNull();
  });

  it("rechaza un email mal escrito y textos demasiado largos", () => {
    expect(validarFichaPersonal({ email_personal: "no-es-un-mail" })).toEqual({ error: "El email no es válido" });
    expect(validarFichaPersonal({ notas: "x".repeat(501) })).toHaveProperty("error");
  });
});

describe("cambiosDeFicha", () => {
  it("devuelve solo lo que cambió; un numeric de la base ('1000.00') no cuenta como cambio si vale lo mismo", () => {
    const nueva: FichaPersonal = { ...FICHA_VACIA, sueldo_acordado: 1000, puesto: "Encargada", jornada: "media" };
    const antes = { sueldo_acordado: "1000.00", puesto: "Vendedora", jornada: "media" };
    expect(cambiosDeFicha(antes, nueva)).toEqual({ puesto: { antes: "Vendedora", despues: "Encargada" } });
  });

  it("una ficha nueva lista todo lo cargado", () => {
    expect(Object.keys(cambiosDeFicha(null, { ...FICHA_VACIA, puesto: "Vendedor", dia_pago: 5 }))).toEqual(["puesto", "dia_pago"]);
  });
});

describe("faltantesDeFicha", () => {
  it("pide lo mínimo para liquidar y, si es transferencia, el CBU", () => {
    expect(faltantesDeFicha(FICHA_VACIA)).toEqual(["CUIL", "fecha de ingreso", "jornada", "sueldo acordado", "forma de pago"]);
    expect(faltantesDeFicha({ ...FICHA_VACIA, forma_pago: "transferencia" })).toContain("CBU o alias");
  });

  it("si está registrada pide además lo del alta", () => {
    const f = faltantesDeFicha({ ...FICHA_VACIA, registro: "registrado" });
    expect(f).toEqual(expect.arrayContaining(["fecha de alta registrada", "convenio", "categoría", "sueldo en recibo"]));
  });
});

describe("cargarFiadoPersona", () => {
  it("suma lo comprado fiado (sin anuladas) y resta lo pagado", async () => {
    const f = fakeAdmin((q: Q) => {
      if (q.table === "movimientos") return { data: [{ movimiento_items: [{ subtotal: "1000" }, { subtotal: "500" }] }, { movimiento_items: [{ subtotal: 2500 }] }] };
      if (q.table === "cta_corriente_pagos") return { data: [{ monto: "1200" }] };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await cargarFiadoPersona(f.admin as any, PERSONA)).toEqual({ vendido: 4000, pagado: 1200, saldo: 2800, ventas: 2 });
    const q = f.calls.find((c) => c.table === "movimientos")!;
    expect(q.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", col: "canal", val: "cuenta_corriente" }),
      expect.objectContaining({ op: "is", col: "anulado_en" }),
    ]));
  });
});

// ── Acción ──────────────────────────────────────────────────────────────────
const CARGA = { userId: "damian", puedeVer: true, puedeCargar: true };
const SOLO_VE = { userId: "javier", puedeVer: true, puedeCargar: false };
type Esc = { fichaPrevia?: Record<string, unknown> | null; upsertError?: string; historialError?: string; sinPersona?: boolean; faltaTabla?: boolean };

function montar(permisos: unknown, e: Esc = {}) {
  h.permisos = permisos;
  const f = fakeAdmin((q: Q) => {
    if (q.table === "profiles") return { data: e.sinPersona ? null : { id: PERSONA, full_name: " Matias Garcia " } };
    if (q.table === "personal_ficha") {
      if (q.op === "upsert") return e.upsertError ? { error: { message: e.upsertError } } : { data: null };
      if (e.faltaTabla) return { error: { message: 'relation "public.personal_ficha" does not exist' } };
      return { data: e.fichaPrevia ?? null };
    }
    if (q.table === "tesoreria_historial") return e.historialError ? { error: { message: e.historialError } } : { data: null };
  });
  h.admin = f.admin;
  return f;
}
const escrituras = (calls: Q[]) => calls.filter((q) => q.op !== "select");
const historialDe = (calls: Q[]) => calls.filter((q) => q.table === "tesoreria_historial" && q.op === "insert").map((q) => q.payload);

beforeEach(() => { h.permisos = null; });

describe("guardarFichaPersonal", () => {
  const entrada = { puesto: "Vendedor", jornada: "media", horas_semanales: 24, sueldo_acordado: 500000, forma_pago: "efectivo_tesoreria" };

  it("sin permiso de cargar no escribe nada", async () => {
    for (const permisos of [null, SOLO_VE]) {
      const f = montar(permisos);
      expect(await guardarFichaPersonal(PERSONA, entrada)).toHaveProperty("error");
      expect(escrituras(f.calls)).toEqual([]);
    }
  });

  it("crea la ficha con quién la cargó y la anota sin guardar los valores sensibles", async () => {
    const { calls } = montar(CARGA);
    expect(await guardarFichaPersonal(PERSONA, { ...entrada, cuil: "20-12345678-6" })).toEqual({});
    expect(calls.find((q) => q.op === "upsert")!.payload).toMatchObject({ persona_id: PERSONA, puesto: "Vendedor", jornada: "media", cuil: "20123456786", created_by: "damian" });
    const [h1] = historialDe(calls) as { accion: string; detalle: { persona: string; alta: boolean; campos: string[] } }[];
    expect(h1).toMatchObject({ accion: "persona_ficha", entidad_id: PERSONA, detalle: { persona: "Matias Garcia", alta: true } });
    expect(JSON.stringify(h1.detalle)).not.toContain("20123456786");
    expect(JSON.stringify(h1.detalle)).not.toContain("500000");
  });

  it("al modificar una ficha guarda quién y cuándo, y anota solo los campos que cambiaron", async () => {
    const { calls } = montar(CARGA, { fichaPrevia: { puesto: "Vendedor", jornada: "completa", horas_semanales: "24.0", sueldo_acordado: "500000.00", forma_pago: "efectivo_tesoreria" } });
    expect(await guardarFichaPersonal(PERSONA, entrada)).toEqual({});
    expect(calls.find((q) => q.op === "upsert")!.payload).toMatchObject({ updated_by: "damian" });
    expect(historialDe(calls)).toEqual([expect.objectContaining({ detalle: { persona: "Matias Garcia", alta: false, campos: ["jornada"] } })]);
  });

  it("si no cambió nada no escribe ni anota", async () => {
    const f = montar(CARGA, { fichaPrevia: { puesto: "Vendedor", jornada: "media", horas_semanales: "24.0", sueldo_acordado: "500000.00", forma_pago: "efectivo_tesoreria" } });
    expect(await guardarFichaPersonal(PERSONA, entrada)).toEqual({});
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("rechaza datos inválidos y personas que no existen antes de escribir", async () => {
    let f = montar(CARGA);
    expect(await guardarFichaPersonal(PERSONA, { cuil: "123" })).toHaveProperty("error");
    expect(await guardarFichaPersonal("no-es-uuid", entrada)).toHaveProperty("error");
    expect(f.calls).toEqual([]);
    f = montar(CARGA, { sinPersona: true });
    expect((await guardarFichaPersonal(PERSONA, entrada)).error).toMatch(/No se encontró/);
    expect(escrituras(f.calls)).toEqual([]);
  });

  it("traduce un CUIL o legajo repetido y avisa si falta la migración 130", async () => {
    montar(CARGA, { upsertError: 'duplicate key value violates unique constraint "personal_ficha_cuil_uni"' });
    expect((await guardarFichaPersonal(PERSONA, entrada)).error).toMatch(/otra persona con ese CUIL/);
    montar(CARGA, { upsertError: 'duplicate key value violates unique constraint "personal_ficha_legajo_uni"' });
    expect((await guardarFichaPersonal(PERSONA, entrada)).error).toMatch(/otra persona con ese número de legajo/);
    montar(CARGA, { faltaTabla: true });
    expect((await guardarFichaPersonal(PERSONA, entrada)).error).toMatch(/migración 130/);
  });

  it("si no pudo anotar el historial lo avisa", async () => {
    montar(CARGA, { historialError: "boom" });
    expect((await guardarFichaPersonal(PERSONA, entrada)).error).toMatch(/no quedó anotado en el historial/);
  });
});
