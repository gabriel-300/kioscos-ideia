import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";
import nextConfig from "../../next.config";

// Las acciones de Tesorería escriben plata con el cliente admin (sin RLS): el permiso, la validación y el vínculo con
// lo que cargó el kiosco se verifican acá con el doble en memoria de Supabase.

const h = vi.hoisted(() => ({ permisos: null as any, admin: null as any }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tesoreria/permisos", () => ({ permisosTesoreria: async () => h.permisos }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin }));

import { anularEgreso, descartarEntrega, marcarEgresoPagado, registrarEgreso, restaurarEntrega } from "@/app/(admin)/admin/tesoreria/actions";
import type { EgresoEntrada } from "@/lib/tesoreria/tipos";

const CARGA = { userId: "damian", puedeVer: true, puedeCargar: true };
const SOLO_VE = { userId: "javier", puedeVer: true, puedeCargar: false };

const entrada: EgresoEntrada = {
  fecha: "2026-10-04", monto: 29600, sucursal_id: "s1", categoria: "mercaderia", proveedor_id: null,
  descripcion: "Lo de Mario - fiambre", comprobante: "sin", comprobante_numero: null, comprobante_path: null,
  pagado: true, origen: "retiro_caja", gasto_fijo_id: null, nota: null, retiros_caja_ids: ["r1"], entregas_ids: [],
};

type Esc = { retirosDisponibles?: string[]; tomaRetiros?: string[]; insertError?: string; anulacionFilas?: number; pagoFilas?: number; descarteFilas?: number };

function montar(permisos: unknown, e: Esc = {}) {
  h.permisos = permisos;
  const f = fakeAdmin((q: Q) => {
    switch (q.table) {
      case "tesoreria_config": return { data: { fecha_inicio: "2026-10-01", efectivo_inicial: 0 } };
      case "sucursales":       return { data: [{ id: "s1" }, { id: "s2" }] };
      case "movimientos":
        if (q.op === "update" && "tesoreria_descartado_en" in (q.payload ?? {})) return { data: Array.from({ length: e.descarteFilas ?? 1 }, () => ({ id: "m1" })) };
        return { data: null };
      case "retiros_caja":
        if (q.op === "select") return { data: (e.retirosDisponibles ?? ["r1"]).map((id) => ({ id, sucursal_id: "s1" })) };
        if (q.op === "update" && q.payload?.egreso_id) return { data: (e.tomaRetiros ?? ["r1"]).map((id) => ({ id })) };
        return { data: null };
      case "egresos":
        if (q.op === "insert") return e.insertError ? { error: { message: e.insertError } } : { data: { id: "e1" } };
        if (q.op === "update" && q.payload?.anulado_en) return { data: Array.from({ length: e.anulacionFilas ?? 1 }, () => ({ id: "e1" })) };
        if (q.op === "update" && q.payload?.pagado) return { data: Array.from({ length: e.pagoFilas ?? 1 }, () => ({ id: "e1" })) };
        return { data: null };
      default: return { data: null };
    }
  });
  h.admin = f.admin;
  return f;
}

const escrituras = (calls: Q[]) => calls.filter((q) => q.op !== "select");

beforeEach(() => { h.permisos = null; });

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
