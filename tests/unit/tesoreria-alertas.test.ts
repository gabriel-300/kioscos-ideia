import { describe, it, expect } from "vitest";
import { construirAlertas, type EntradaAlertas, type LiquidacionParaAlertas } from "@/lib/tesoreria/alertas";

const HOY = "2026-10-30";
const liq = (o: Partial<LiquidacionParaAlertas> = {}): LiquidacionParaAlertas => ({
  estado: "acreditado", periodo_desde: "2026-10-19", periodo_hasta: "2026-10-25", total_liquidado: 37243.04, monto_acreditado: 37243.04,
  fecha_acreditacion_hasta: "2026-10-28", alerta_plazo: null, ...o,
});
const base = (o: Partial<EntradaAlertas> = {}): EntradaAlertas => ({
  hoy: HOY, liquidaciones: [liq()],
  peyaSinVenta: { cantidad: 0, monto: 0 }, peyaImporteDistinto: { cantidad: 0, monto: 0 }, peyaVentasSinPedido: { cantidad: 0, monto: 0 },
  mpSinClasificar: { cantidad: 0, monto: 0 }, mpPagosSinVenta: 0, ...o,
});
const ids = (e: EntradaAlertas) => construirAlertas(e).map((a) => a.id);

describe("construirAlertas", () => {
  it("sin nada para revisar no hay alertas (lo normal no es una alerta)", () => {
    expect(construirAlertas(base())).toEqual([]);
    // Una liquidación confirmada que todavía no llegó a su fecha de cobro tampoco lo es.
    expect(construirAlertas(base({ liquidaciones: [liq({ estado: "confirmado", fecha_acreditacion_hasta: "2026-11-05", monto_acreditado: null })] }))).toEqual([]);
  });

  it("el pedido de $3.400 sin venta en el sistema es una alerta roja que explica por qué importa", () => {
    const [a] = construirAlertas(base({ peyaSinVenta: { cantidad: 1, monto: 3400 } }));
    expect(a).toMatchObject({ id: "peya-sin-venta", nivel: "rojo", cantidad: 1, href: "/admin/tesoreria?vista=pedidosya" });
    expect(a.titulo).toMatch(/^1 pedido de PedidosYa sin venta en el sistema \(.*3\.400,00\)$/);
    expect(a.detalle).toMatch(/descuadra el stock/);
  });

  it("usa el plural cuando son varios", () => {
    const a = construirAlertas(base({ peyaSinVenta: { cantidad: 3, monto: 9000 }, mpSinClasificar: { cantidad: 8, monto: 1069773 } }));
    expect(a.find((x) => x.id === "peya-sin-venta")?.titulo).toMatch(/^3 pedidos de PedidosYa sin venta/);
    expect(a.find((x) => x.id === "mp-sin-clasificar")?.titulo).toMatch(/^8 movimientos de Mercado Pago sin clasificar/);
  });

  it("un cobro confirmado que ya pasó su fecha máxima de acreditación está atrasado", () => {
    const a = construirAlertas(base({ liquidaciones: [liq({ estado: "confirmado", monto_acreditado: null, fecha_acreditacion_hasta: "2026-10-28" })] }));
    expect(a[0]).toMatchObject({ id: "peya-atrasado-2026-10-25", nivel: "rojo" });
    expect(a[0].titulo).toMatch(/19\/10\/2026 al 25\/10\/2026/);
    expect(a[0].detalle).toMatch(/28\/10\/2026/);
  });

  it("un cobro que llegó con otro monto es una alerta con la diferencia", () => {
    const a = construirAlertas(base({ liquidaciones: [liq({ monto_acreditado: 30000 })] }));
    expect(a[0]).toMatchObject({ id: "peya-diferencia-2026-10-25", nivel: "rojo" });
    expect(a[0].titulo).toMatch(/pagó .*7\.243,04 menos de lo esperado/);
  });

  it("avisa un cambio de plazo mientras la liquidación no esté acreditada, y no después", () => {
    const aviso = "Cambió el plazo de cobro: ahora 9 días después de cerrar el período (la semana anterior fueron 12).";
    expect(ids(base({ liquidaciones: [liq({ estado: "confirmado", monto_acreditado: null, fecha_acreditacion_hasta: "2026-11-10", alerta_plazo: aviso })] }))).toEqual(["peya-plazo-2026-10-25"]);
    expect(ids(base({ liquidaciones: [liq({ alerta_plazo: aviso })] }))).toEqual([]);
  });

  it("recuerda importar la liquidación si pasaron más de 14 días desde la última, pero no si nunca se usó", () => {
    expect(ids(base({ liquidaciones: [liq({ periodo_hasta: "2026-10-11" })] }))).toEqual(["peya-sin-importar"]);
    expect(ids(base({ liquidaciones: [liq({ periodo_hasta: "2026-10-20" })] }))).toEqual([]);
    expect(ids(base({ liquidaciones: [] }))).toEqual([]);
  });

  it("ordena lo rojo antes que lo ámbar", () => {
    const a = construirAlertas(base({
      mpSinClasificar: { cantidad: 1, monto: 100 }, peyaImporteDistinto: { cantidad: 1, monto: 500 }, peyaSinVenta: { cantidad: 1, monto: 3400 },
    }));
    expect(a.map((x) => x.nivel)).toEqual(["rojo", "ambar", "ambar"]);
    expect(a[0].id).toBe("peya-sin-venta");
  });

  it("los pagos de Mercado Pago sin venta apuntan a la conciliación y aclaran que son los últimos 30 días", () => {
    const [a] = construirAlertas(base({ mpPagosSinVenta: 31 }));
    expect(a).toMatchObject({ id: "mp-pagos-sin-venta", href: "/admin/conciliacion-mercadopago" });
    expect(a.titulo).toMatch(/31 pagos .* en los últimos 30 días/);
  });
});
