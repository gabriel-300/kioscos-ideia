import { describe, it, expect } from "vitest";
import { fakeAdmin, eqDe, type Q } from "../helpers/fake-supabase";
import { destinoSeguro } from "@/lib/auth/destino-seguro";
import { clienteDeLaSesion, esPrimeraCompra, leerConfigBeneficio, recordarContactoCliente, SIN_BENEFICIOS } from "@/lib/pedidos/beneficio-servidor";

describe("destinoSeguro", () => {
  it("acepta solo rutas internas", () => {
    expect(destinoSeguro("/pedir/abc", "/")).toBe("/pedir/abc");
    expect(destinoSeguro("/a?x=1", "/")).toBe("/a?x=1");
  });
  it("rechaza redirecciones abiertas y usa el destino por defecto", () => {
    for (const malo of [null, "", "@sitio-malo.com", "//sitio-malo.com", "/\\sitio-malo.com", "https://sitio-malo.com", "sitio"]) {
      expect(destinoSeguro(malo, "/por-defecto")).toBe("/por-defecto");
    }
  });
});

describe("leerConfigBeneficio", () => {
  it("lee los tres campos de la sucursal", async () => {
    const { admin } = fakeAdmin((q: Q) => q.table === "sucursales" ? { data: { descuento_cliente_pct: "7.5", descuento_cliente_solo_primera: true, envio_gratis_primera_compra: true } } : undefined);
    expect(await leerConfigBeneficio(admin, "s1")).toEqual({ descuentoPct: 7.5, descuentoSoloPrimera: true, envioGratisPrimera: true });
  });
  it("si la consulta falla (migración 099 sin aplicar) responde sin beneficios y no rompe", async () => {
    const { admin } = fakeAdmin(() => ({ error: { message: 'column "descuento_cliente_pct" does not exist' } }));
    expect(await leerConfigBeneficio(admin, "s1")).toEqual(SIN_BENEFICIOS);
  });
});

describe("esPrimeraCompra", () => {
  const mundo = (count: number) => fakeAdmin((q: Q) => (q.table === "pedidos" ? { count } : undefined));
  it("sin pedidos anteriores es la primera", async () => {
    expect(await esPrimeraCompra(mundo(0).admin, "c1")).toBe(true);
  });
  it("con algún pedido anterior ya no lo es", async () => {
    expect(await esPrimeraCompra(mundo(2).admin, "c1")).toBe(false);
  });
  it("no cuentan los carritos, cancelados ni vencidos, y filtra por cliente", async () => {
    const { admin, calls } = mundo(0);
    await esPrimeraCompra(admin, "c1");
    const q = calls[0];
    expect(eqDe(q, "cliente_id")).toBe("c1");
    const excluidos = q.filters.find((f) => f.op === "not")!;
    expect(excluidos.col).toBe("estado");
    for (const estado of ["carrito", "cancelado", "expirado"]) expect(String(excluidos.extra)).toContain(estado);
  });
});

describe("clienteDeLaSesion", () => {
  it("sin sesión no hay cliente y ni siquiera consulta", async () => {
    const { admin, calls } = fakeAdmin(() => ({ data: { id: "x" } }));
    expect(await clienteDeLaSesion(admin, null)).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("un usuario sin fila en clientes (ej. personal) no es cliente", async () => {
    const { admin } = fakeAdmin(() => ({ data: null }));
    expect(await clienteDeLaSesion(admin, "u1")).toBeNull();
  });
  it("con fila devuelve sus datos", async () => {
    const { admin } = fakeAdmin(() => ({ data: { id: "u1", nombre: "Ana", telefono: "3764" } }));
    expect(await clienteDeLaSesion(admin, "u1")).toEqual({ id: "u1", nombre: "Ana", telefono: "3764" });
  });
});

describe("recordarContactoCliente", () => {
  const actualiza = async (cliente: { nombre: string | null; telefono: string | null }, nombre: string, tel: string) => {
    const { admin, calls } = fakeAdmin(() => ({ data: null }));
    await recordarContactoCliente(admin, { id: "c1", ...cliente }, nombre, tel);
    return calls.find((c) => c.op === "update") ?? null;
  };

  it("guarda nombre y teléfono la primera vez", async () => {
    expect((await actualiza({ nombre: null, telefono: null }, " Ana ", " 3764123456 "))!.payload).toEqual({ nombre: "Ana", telefono: "3764123456", telefono_verificado_at: null });
  });
  it("si el teléfono cambia, se invalida la verificación anterior", async () => {
    const u = await actualiza({ nombre: "Ana", telefono: "3764111111" }, "Ana", "3764222222");
    expect(u!.payload).toMatchObject({ telefono: "3764222222", telefono_verificado_at: null });
  });
  it("no pisa el nombre que el cliente ya tenía y no escribe si no hay cambios", async () => {
    expect(await actualiza({ nombre: "Ana", telefono: "3764111111" }, "Otra", "3764111111")).toBeNull();
  });
});
