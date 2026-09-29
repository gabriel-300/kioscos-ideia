import { describe, it, expect } from "vitest";
import { fakeAdmin, eqDe, type Q } from "../helpers/fake-supabase";
import { contarPedidosPorAtender, cuentaComoPorAtender, pagoPorLinkVigente, sucursalesVisibles } from "@/lib/pedidos/por-atender";

const AHORA = Date.parse("2026-09-30T15:00:00Z");
const p = (estado: string, medio_pago: string | null = "efectivo", expira_en: string | null = null) => ({ estado, medio_pago, expira_en });

describe("qué cuenta como 'por atender'", () => {
  it("cuentan los pedidos nuevos: efectivo confirmado y Mercado Pago ya pagado", () => {
    expect(cuentaComoPorAtender(p("confirmado"), AHORA)).toBe(true);
    expect(cuentaComoPorAtender(p("pagado", "mercadopago_link"), AHORA)).toBe(true);
  });
  it("no cuentan los que ya se están atendiendo o terminaron", () => {
    for (const e of ["en_preparacion", "listo_retiro", "en_reparto", "entregado", "cancelado", "expirado", "carrito"]) {
      expect(cuentaComoPorAtender(p(e), AHORA)).toBe(false);
    }
  });
  it("un pago por link cuenta mientras no venció (el local tiene que mandar el link y confirmar)", () => {
    expect(pagoPorLinkVigente(p("pendiente_pago", "mercadopago_link", "2026-09-30T16:00:00Z"), AHORA)).toBe(true);
    expect(pagoPorLinkVigente(p("pendiente_pago", "mercadopago_link", null), AHORA)).toBe(true);
  });
  it("vencido, o con otro medio de pago (QR abandonado), es ruido", () => {
    expect(pagoPorLinkVigente(p("pendiente_pago", "mercadopago_link", "2026-09-30T14:00:00Z"), AHORA)).toBe(false);
    expect(pagoPorLinkVigente(p("pendiente_pago", "mercadopago_qr", "2026-09-30T16:00:00Z"), AHORA)).toBe(false);
  });
});

describe("sucursalesVisibles", () => {
  const mundo = (over: { sucursales?: any[]; asignadas?: any[]; perfil?: any } = {}) => fakeAdmin((q: Q) => {
    if (q.table === "sucursales") return { data: over.sucursales ?? [] };
    if (q.table === "profile_sucursales") return { data: over.asignadas ?? [] };
    if (q.table === "profiles") return { data: over.perfil ?? null };
  });

  it("admin ve todas (null) sin consultar nada", async () => {
    const { admin, calls } = mundo();
    expect(await sucursalesVisibles(admin, "u1", "admin")).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("encargado y concesionario ven la sucursal que tienen a cargo", async () => {
    const { admin, calls } = mundo({ sucursales: [{ id: "s1" }] });
    expect(await sucursalesVisibles(admin, "u1", "encargado")).toEqual(["s1"]);
    expect(eqDe(calls[0], "encargado_user_id")).toBe("u1");
  });
  it("un vendedor con varias sucursales las ve todas", async () => {
    const { admin } = mundo({ asignadas: [{ sucursal_id: "s1" }, { sucursal_id: "s2" }] });
    expect(await sucursalesVisibles(admin, "u1", "vendedor")).toEqual(["s1", "s2"]);
  });
  it("un vendedor sin filas en profile_sucursales cae a la columna vieja de su perfil", async () => {
    const { admin } = mundo({ perfil: { sucursal_id: "s9" } });
    expect(await sucursalesVisibles(admin, "u1", "vendedor")).toEqual(["s9"]);
  });
  it("cualquier otro rol (repartidor, desconocido) no ve ninguna", async () => {
    expect(await sucursalesVisibles(mundo().admin, "u1", "repartidor")).toEqual([]);
  });
});

describe("contarPedidosPorAtender", () => {
  const filas = [
    p("confirmado"), p("pagado", "mercadopago_link"), p("en_preparacion"),
    p("pendiente_pago", "mercadopago_link", "2999-01-01T00:00:00Z"),
    p("pendiente_pago", "mercadopago_link", "2000-01-01T00:00:00Z"),
  ];
  const mundo = (asignadas: any[] = []) => fakeAdmin((q: Q) => {
    if (q.table === "pedidos") return { data: filas };
    if (q.table === "profile_sucursales") return { data: asignadas };
  });

  it("admin: cuenta sobre todas las sucursales (sin filtro)", async () => {
    const { admin, calls } = mundo();
    expect(await contarPedidosPorAtender(admin, "u1", "admin")).toBe(3);
    expect(calls.find((c) => c.table === "pedidos")!.filters.some((f) => f.col === "sucursal_id")).toBe(false);
  });
  it("vendedor: solo pide las sucursales que tiene asignadas", async () => {
    const { admin, calls } = mundo([{ sucursal_id: "s1" }]);
    await contarPedidosPorAtender(admin, "u1", "vendedor");
    const f = calls.find((c) => c.table === "pedidos")!.filters.find((x) => x.col === "sucursal_id")!;
    expect(f.val).toEqual(["s1"]);
  });
  it("sin sucursales asignadas devuelve 0 sin consultar pedidos", async () => {
    const { admin, calls } = mundo([]);
    expect(await contarPedidosPorAtender(admin, "u1", "repartidor")).toBe(0);
    expect(calls.some((c) => c.table === "pedidos")).toBe(false);
  });
});
