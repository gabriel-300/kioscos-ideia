import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";
import { ACCIONES_HISTORIAL, ETIQUETA_ACCION, describirHistorial as describirReal, registrarHistorial } from "@/lib/tesoreria/historial";

// El formato de moneda argentino separa el $ del número con un espacio "duro" (U+00A0): se normaliza para comparar texto legible.
const describirHistorial: typeof describirReal = (f) => describirReal(f).replace(/ /g, " ");

// El historial de Tesorería: un registro de solo agregar de lo que se hace. Acá se prueba el texto que se muestra, la
// escritura, que la lista de acciones coincida con la de la base y el registro de cambios de permisos en Staff.

const h = vi.hoisted(() => ({ admin: null as any, quien: "adm1" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireAdmin: async () => ({ userId: h.quien }) }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin }));

import { actualizarStaff } from "@/app/(admin)/admin/staff/actions";

describe("describirHistorial", () => {
  it("cuenta en castellano lo que pasó, con importes y quién o qué", () => {
    expect(describirHistorial({ accion: "egreso_creado", detalle: { monto: 29600, descripcion: "Lo de Mario", comprobante: "sin", pagado: true, origen: "retiro_caja" } }))
      .toBe("Cargó un egreso de $ 29.600 «Lo de Mario» (sin factura, pagado con retiro de caja)");
    expect(describirHistorial({ accion: "egreso_creado", detalle: { monto: 1000, descripcion: "Petri", comprobante: "con", pagado: false } }))
      .toBe("Cargó un egreso de $ 1.000 «Petri» (con factura, queda por pagar)");
    expect(describirHistorial({ accion: "egreso_pagado", detalle: { monto: 1000, descripcion: "Petri", origen: "transferencia" } }))
      .toBe("Marcó pagado «Petri» de $ 1.000 con transferencia");
    expect(describirHistorial({ accion: "egreso_anulado", detalle: { monto: 1000, descripcion: "Petri" } })).toBe("Anuló «Petri» de $ 1.000");
    expect(describirHistorial({ accion: "entrega_descartada", detalle: { proveedor: null } })).toBe("Marcó «no corresponde» un ingreso del kiosco (sin proveedor)");
    expect(describirHistorial({ accion: "entrega_restaurada", detalle: { proveedor: "Petri" } })).toBe("Devolvió a la lista un ingreso del kiosco (Petri)");
  });

  it("el efectivo inicial muestra el antes y el después, o la primera carga", () => {
    expect(describirHistorial({ accion: "efectivo_inicial_cambiado", detalle: { anterior: 50000, nuevo: 60000 } })).toBe("Cambió el efectivo inicial de $ 50.000 a $ 60.000");
    expect(describirHistorial({ accion: "efectivo_inicial_cambiado", detalle: { anterior: null, nuevo: 50000 } })).toBe("Cargó el efectivo inicial: $ 50.000");
  });

  it("un permiso dado o sacado dice a quién", () => {
    expect(describirHistorial({ accion: "permiso_cambiado", detalle: { persona: "Abril", permiso: "es_administrativo", nuevo: true } })).toBe("Le dio a Abril el permiso de administrativo de Tesorería");
    expect(describirHistorial({ accion: "permiso_cambiado", detalle: { persona: "Damián", permiso: "es_socio", nuevo: false } })).toBe("Le sacó a Damián el permiso de socio");
  });

  it("no se rompe con un detalle incompleto", () => {
    expect(describirHistorial({ accion: "egreso_anulado", detalle: {} })).toContain("un egreso");
  });

  it("toda acción tiene su etiqueta", () => {
    for (const a of ACCIONES_HISTORIAL) expect(ETIQUETA_ACCION[a], a).toBeTruthy();
  });
});

describe("la lista de acciones coincide con la de la base", () => {
  it("las del CHECK de la migración 104 son exactamente las del código", () => {
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/104_tesoreria_historial.sql"), "utf8");
    const bloque = sql.match(/check \(accion in \(([\s\S]*?)\)\)/)?.[1] ?? "";
    const enLaBase = [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(enLaBase).toEqual([...ACCIONES_HISTORIAL].sort());
  });

  it("la migración hace el historial de solo agregar (trigger y permisos)", () => {
    const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/104_tesoreria_historial.sql"), "utf8");
    expect(sql).toMatch(/before update or delete on public\.tesoreria_historial/);
    expect(sql).toMatch(/before truncate on public\.tesoreria_historial/);
    expect(sql).toMatch(/revoke update, delete, truncate on public\.tesoreria_historial from service_role/);
  });
});

describe("registrarHistorial", () => {
  it("escribe usuario, acción, entidad, detalle y motivo recortado; devuelve el error de la base", async () => {
    let f = fakeAdmin(() => ({ data: null }));
    expect(await registrarHistorial(f.admin, { usuario_id: "u1", accion: "egreso_anulado", entidad_id: "e1", detalle: { monto: 5 }, motivo: "  duplicado  " })).toEqual({});
    expect(f.calls[0].payload).toEqual({ usuario_id: "u1", accion: "egreso_anulado", entidad_id: "e1", detalle: { monto: 5 }, motivo: "duplicado" });

    f = fakeAdmin(() => ({ error: { message: "boom" } }));
    expect(await registrarHistorial(f.admin, { usuario_id: "u1", accion: "egreso_creado" })).toEqual({ error: "boom" });
    expect(f.calls[0].payload).toMatchObject({ entidad_id: null, detalle: {}, motivo: null });
  });
});

describe("Staff: quién tiene permiso de Tesorería queda en el historial", () => {
  function montar(antes: { es_socio: boolean; es_administrativo: boolean }, historialError?: string) {
    h.quien = "adm1";
    const f = fakeAdmin((q: Q) => {
      if (q.table === "profiles" && q.op === "select") return { data: antes };
      if (q.table === "tesoreria_historial") return historialError ? { error: { message: historialError } } : { data: null };
      return { data: null };
    });
    f.admin.auth = { admin: { updateUserById: async () => ({ error: null }) } };
    h.admin = f.admin;
    return f;
  }
  const historial = (calls: Q[]) => calls.filter((q) => q.table === "tesoreria_historial" && q.op === "insert").map((q) => q.payload);

  it("darle el permiso de administrativo anota quién se lo dio y a quién", async () => {
    const { calls } = montar({ es_socio: false, es_administrativo: false });
    await actualizarStaff("abril1", { nombre: "Abril", esAdministrativo: true });
    expect(historial(calls)).toEqual([expect.objectContaining({
      usuario_id: "adm1", accion: "permiso_cambiado", entidad_id: "abril1", detalle: { persona: "Abril", permiso: "es_administrativo", nuevo: true },
    })]);
  });

  it("sacar un permiso también queda, y guardar sin cambiar nada no anota nada", async () => {
    let f = montar({ es_socio: true, es_administrativo: true });
    await actualizarStaff("dam1", { nombre: "Damián", esSocio: true, esAdministrativo: false });
    expect(historial(f.calls)).toEqual([expect.objectContaining({ detalle: { persona: "Damián", permiso: "es_administrativo", nuevo: false } })]);

    f = montar({ es_socio: true, es_administrativo: true });
    await actualizarStaff("dam1", { nombre: "Damián", esSocio: true, esAdministrativo: true });
    expect(historial(f.calls)).toHaveLength(0);
  });

  it("si el historial no se puede escribir, Staff sigue funcionando", async () => {
    montar({ es_socio: false, es_administrativo: false }, "no existe la tabla");
    await expect(actualizarStaff("abril1", { nombre: "Abril", esAdministrativo: true })).resolves.toBeUndefined();
  });
});
