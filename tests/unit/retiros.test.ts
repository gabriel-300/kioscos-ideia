import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeAdmin, type Q } from "../helpers/fake-supabase";
import { RETIRO_FOTO_DESDE, retiroRequiereFoto, validarRetiro } from "@/lib/retiros";

// Retiro de caja: compra de emergencia (lo normal) o pago esporádico a un proveedor autorizado por un administrador.
// La foto es obligatoria desde RETIRO_FOTO_DESDE, y el servidor valida de nuevo todo lo que manda el navegador.

const h = vi.hoisted(() => ({ session: { userId: "emp1", role: "vendedor" }, admin: null as any, accesoError: null as string | null }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireStaff: async () => h.session }));
vi.mock("@/lib/auth/sucursal-access", () => ({ requireSucursalAccess: async () => h.accesoError }));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => h.admin }));

import { registrarRetiro } from "@/app/(admin)/admin/sucursales/[id]/retiro-actions";

const base = { sucursal_id: "s1", monto: 5900, motivo: "uber para chipitas" };

describe("validarRetiro", () => {
  it("acepta una compra de emergencia chica sin foto", () => {
    const r = validarRetiro(base);
    expect("valor" in r && r.valor).toMatchObject({ monto: 5900, motivo: "uber para chipitas", comprobante_image_url: null, proveedor_id: null, autorizado_por: null });
  });

  it("la foto es obligatoria desde el monto límite, y no antes", () => {
    expect(retiroRequiereFoto(RETIRO_FOTO_DESDE - 1)).toBe(false);
    expect(retiroRequiereFoto(RETIRO_FOTO_DESDE)).toBe(true);
    expect("error" in validarRetiro({ ...base, monto: RETIRO_FOTO_DESDE - 1 })).toBe(false);
    expect("error" in validarRetiro({ ...base, monto: RETIRO_FOTO_DESDE })).toBe(true);
    expect("error" in validarRetiro({ ...base, monto: RETIRO_FOTO_DESDE, comprobante_image_url: "https://x/y.webp" })).toBe(false);
    expect("error" in validarRetiro({ ...base, monto: RETIRO_FOTO_DESDE, comprobante_image_url: "   " })).toBe(true);
  });

  it.each([0, -1, NaN, Infinity, 200_000_000])("rechaza el monto %s", (monto) => {
    expect("error" in validarRetiro({ ...base, monto })).toBe(true);
  });

  it("exige motivo y limita su largo", () => {
    expect("error" in validarRetiro({ ...base, motivo: "  " })).toBe(true);
    expect("error" in validarRetiro({ ...base, motivo: "x".repeat(301) })).toBe(true);
  });

  it("un pago a proveedor exige quién lo autorizó; sin proveedor, el autorizante se ignora", () => {
    expect("error" in validarRetiro({ ...base, proveedor_id: "p1" })).toBe(true);
    const con = validarRetiro({ ...base, proveedor_id: "p1", autorizado_por: "adm1" });
    expect("valor" in con && [con.valor.proveedor_id, con.valor.autorizado_por]).toEqual(["p1", "adm1"]);
    const sin = validarRetiro({ ...base, autorizado_por: "adm1" });
    expect("valor" in sin && [sin.valor.proveedor_id, sin.valor.autorizado_por]).toEqual([null, null]);
  });
});

type Esc = { proveedorExiste?: boolean; autorizadorRol?: string | null; insertError?: string };

function montar(e: Esc = {}) {
  h.session = { userId: "emp1", role: "vendedor" };
  h.accesoError = null;
  const f = fakeAdmin((q: Q) => {
    if (q.table === "proveedores") return { data: e.proveedorExiste === false ? null : { id: "p1" } };
    if (q.table === "retiros_caja" && q.op === "insert") return e.insertError ? { error: { message: e.insertError } } : { data: null };
    return { data: null };
  });
  f.admin.auth = { admin: { getUserById: async () => ({ data: { user: e.autorizadorRol === null ? null : { app_metadata: { role: e.autorizadorRol ?? "admin" } } } }) } };
  h.admin = f.admin;
  return f;
}

beforeEach(() => { h.session = { userId: "emp1", role: "vendedor" }; });

describe("registrarRetiro", () => {
  it("guarda un retiro común sin las columnas de proveedor (anda aunque la migración 103 no esté aplicada)", async () => {
    const { calls } = montar();
    expect(await registrarRetiro(base)).toEqual({});
    const insert = calls.find((q) => q.table === "retiros_caja" && q.op === "insert")!;
    expect(insert.payload).toMatchObject({ sucursal_id: "s1", monto: 5900, created_by: "emp1" });
    expect(insert.payload).not.toHaveProperty("proveedor_id");
    expect(insert.payload).not.toHaveProperty("autorizado_por");
  });

  it("no guarda un retiro grande sin foto (lo valida el servidor, no solo la pantalla)", async () => {
    const { calls } = montar();
    expect(await registrarRetiro({ ...base, monto: 25000 })).toEqual({ error: expect.stringContaining("foto") });
    expect(calls.some((q) => q.op === "insert")).toBe(false);
  });

  it("un pago a proveedor guarda proveedor y quién lo autorizó", async () => {
    const { calls } = montar();
    expect(await registrarRetiro({ ...base, proveedor_id: "p1", autorizado_por: "adm1" })).toEqual({});
    expect(calls.find((q) => q.table === "retiros_caja" && q.op === "insert")!.payload).toMatchObject({ proveedor_id: "p1", autorizado_por: "adm1" });
  });

  it("rechaza un autorizante que no es administrador, y un proveedor que no está en la lista", async () => {
    let f = montar({ autorizadorRol: "vendedor" });
    expect(await registrarRetiro({ ...base, proveedor_id: "p1", autorizado_por: "emp2" })).toEqual({ error: expect.stringContaining("administrador") });
    expect(f.calls.some((q) => q.op === "insert")).toBe(false);

    f = montar({ autorizadorRol: null });
    expect(await registrarRetiro({ ...base, proveedor_id: "p1", autorizado_por: "nadie" })).toEqual({ error: expect.stringContaining("administrador") });

    f = montar({ proveedorExiste: false });
    expect(await registrarRetiro({ ...base, proveedor_id: "p1", autorizado_por: "adm1" })).toEqual({ error: expect.stringContaining("proveedor") });
    expect(f.calls.some((q) => q.op === "insert")).toBe(false);
  });

  it("sin acceso a la sucursal no escribe nada, y los errores de la base se devuelven (no se lanzan)", async () => {
    let f = montar();
    h.accesoError = "No tenés acceso a esta sucursal";
    expect(await registrarRetiro(base)).toEqual({ error: "No tenés acceso a esta sucursal" });
    expect(f.calls.some((q) => q.op === "insert")).toBe(false);

    f = montar({ insertError: "violates check constraint" });
    expect(await registrarRetiro(base)).toEqual({ error: "violates check constraint" });
  });
});
