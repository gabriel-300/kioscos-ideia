// «Para revisar» de Tesorería: casos que hoy solo se veían si se entraba a la pantalla de cada cosa. Función pura: recibe lo ya consultado
// y devuelve la lista de avisos, de lo más grave a lo menos. El Resumen la muestra; el aviso del menú usa conteos más baratos (layout.tsx).
//
// Qué NO es una alerta: lo que es normal que esté pendiente (una liquidación que todavía no llegó a su fecha de cobro, un retiro de caja
// recién cargado: ese ya tiene su propio contador). Cada alerta dice qué pasó, por qué importa y adónde ir a resolverla.

import { diasEntre } from "./peya";

export type NivelAlerta = "rojo" | "ambar";
export interface AlertaTesoreria {
  id:       string;
  nivel:    NivelAlerta;
  titulo:   string;
  detalle:  string;
  href:     string;
  cantidad: number;
}

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const dma = (f: string) => f.split("-").reverse().join("/");
const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

export interface LiquidacionParaAlertas {
  estado: "estimado" | "confirmado" | "acreditado" | "conciliado";
  periodo_desde: string; periodo_hasta: string;
  total_liquidado: number | null; monto_acreditado: number | null;
  fecha_acreditacion_hasta: string | null; alerta_plazo: string | null;
}

export interface EntradaAlertas {
  hoy: string;                                                   // AAAA-MM-DD
  liquidaciones: LiquidacionParaAlertas[];                       // todas las importadas
  peyaSinVenta: { cantidad: number; monto: number };             // pedidos entregados, sin venta en el sistema y sin revisar (pesos)
  peyaImporteDistinto: { cantidad: number; monto: number };      // idem con otro importe: monto = suma de las diferencias absolutas
  peyaVentasSinPedido: { cantidad: number; monto: number };      // ventas cargadas como PedidosYa que PedidosYa no informa
  mpSinClasificar: { cantidad: number; monto: number };          // movimientos de Mercado Pago que no son venta de caja y nadie clasificó
  mpPagosSinVenta: number;                                       // pagos QR de Mercado Pago de los últimos 30 días, confirmados y sin venta vinculada
}

const DIAS_SIN_IMPORTAR = 14;

export function construirAlertas(e: EntradaAlertas): AlertaTesoreria[] {
  const a: AlertaTesoreria[] = [];
  const peya = "/admin/tesoreria?vista=pedidosya";

  if (e.peyaSinVenta.cantidad > 0) {
    const n = e.peyaSinVenta.cantidad;
    a.push({
      id: "peya-sin-venta", nivel: "rojo", cantidad: n, href: peya,
      titulo: `${n} ${plural(n, "pedido de PedidosYa sin venta en el sistema", "pedidos de PedidosYa sin venta en el sistema")} (${AR.format(e.peyaSinVenta.monto)})`,
      detalle: "PedidosYa los entregó y te los paga, pero el kiosco no los cargó: puede ser una venta olvidada que descuadra el stock. Averiguá qué pasó y dejalo revisado.",
    });
  }
  if (e.peyaImporteDistinto.cantidad > 0) {
    const n = e.peyaImporteDistinto.cantidad;
    a.push({
      id: "peya-importe-distinto", nivel: "ambar", cantidad: n, href: peya,
      titulo: `${n} ${plural(n, "pedido de PedidosYa con otro importe", "pedidos de PedidosYa con otro importe")} que la venta del kiosco (${AR.format(e.peyaImporteDistinto.monto)} de diferencia)`,
      detalle: "La venta más cercana en el tiempo tiene un importe distinto al que informa PedidosYa. Puede ser un error de carga del kiosco.",
    });
  }
  if (e.peyaVentasSinPedido.cantidad > 0) {
    const n = e.peyaVentasSinPedido.cantidad;
    a.push({
      id: "peya-ventas-sin-pedido", nivel: "ambar", cantidad: n, href: peya,
      titulo: `${n} ${plural(n, "venta cargada como PedidosYa que PedidosYa no informa", "ventas cargadas como PedidosYa que PedidosYa no informa")} (${AR.format(e.peyaVentasSinPedido.monto)})`,
      detalle: "El kiosco las registró como PedidosYa pero no figuran en el CSV de la semana: pueden ser un pedido cancelado o una venta cargada en el canal equivocado.",
    });
  }

  // Cobros: lo confirmado que ya debería haber llegado y no se registró, plazos que cambiaron y montos que no coinciden.
  for (const l of e.liquidaciones) {
    const periodo = `${dma(l.periodo_desde)} al ${dma(l.periodo_hasta)}`;
    if (l.estado === "confirmado" && l.fecha_acreditacion_hasta && l.fecha_acreditacion_hasta < e.hoy && l.total_liquidado !== null) {
      a.push({
        id: `peya-atrasado-${l.periodo_hasta}`, nivel: "rojo", cantidad: 1, href: peya,
        titulo: `El cobro de PedidosYa del ${periodo} (${AR.format(l.total_liquidado)}) está atrasado`,
        detalle: `Tenía que acreditarse como máximo el ${dma(l.fecha_acreditacion_hasta)} y no se registró. Mirá si entró a Mercado Pago; si no, reclamalo a PedidosYa.`,
      });
    }
    if (l.alerta_plazo && (l.estado === "estimado" || l.estado === "confirmado")) {
      a.push({ id: `peya-plazo-${l.periodo_hasta}`, nivel: "ambar", cantidad: 1, href: peya, titulo: `Cambió el plazo de cobro de PedidosYa (${periodo})`, detalle: l.alerta_plazo });
    }
    if (l.estado === "acreditado" && l.total_liquidado !== null && l.monto_acreditado !== null && Math.round((l.monto_acreditado - l.total_liquidado) * 100) !== 0) {
      const dif = Math.round((l.monto_acreditado - l.total_liquidado) * 100) / 100;
      a.push({
        id: `peya-diferencia-${l.periodo_hasta}`, nivel: "rojo", cantidad: 1, href: peya,
        titulo: `PedidosYa pagó ${AR.format(Math.abs(dif))} ${dif < 0 ? "menos" : "más"} de lo esperado (${periodo})`,
        detalle: `Se esperaban ${AR.format(l.total_liquidado)} y llegaron ${AR.format(l.monto_acreditado)}. Revisá el estado de cuenta de esa semana.`,
      });
    }
  }

  // Recordatorio de la rutina semanal: solo si ya se usó alguna vez (si nunca se importó, no es un olvido).
  const ultimo = e.liquidaciones.map((l) => l.periodo_hasta).sort().at(-1);
  if (ultimo && diasEntre(ultimo, e.hoy) > DIAS_SIN_IMPORTAR) {
    a.push({
      id: "peya-sin-importar", nivel: "ambar", cantidad: 1, href: peya,
      titulo: `Hace ${diasEntre(ultimo, e.hoy)} días que no se importa una liquidación de PedidosYa`,
      detalle: `La última llega hasta el ${dma(ultimo)}. El estado de cuenta se publica unos días después de cerrar cada semana: bajá el CSV y el Excel e importalos.`,
    });
  }

  if (e.mpSinClasificar.cantidad > 0) {
    const n = e.mpSinClasificar.cantidad;
    a.push({
      id: "mp-sin-clasificar", nivel: "ambar", cantidad: n, href: "/admin/tesoreria?vista=mercadopago",
      titulo: `${n} ${plural(n, "movimiento de Mercado Pago sin clasificar", "movimientos de Mercado Pago sin clasificar")} (${AR.format(e.mpSinClasificar.monto)})`,
      detalle: "No son una venta de caja y el sistema no supone qué son. Hasta que los clasifiques no suman al saldo de la cuenta.",
    });
  }
  if (e.mpPagosSinVenta > 0) {
    const n = e.mpPagosSinVenta;
    a.push({
      id: "mp-pagos-sin-venta", nivel: "ambar", cantidad: n, href: "/admin/conciliacion-mercadopago",
      titulo: `${n} ${plural(n, "pago de Mercado Pago confirmado sin venta registrada", "pagos de Mercado Pago confirmados sin venta registrada")} en los últimos 30 días`,
      detalle: "El cliente pagó por QR y la venta no quedó atada a ese pago. Es plata que entró sin una venta que la respalde.",
    });
  }

  return a.sort((x, y) => (x.nivel === y.nivel ? 0 : x.nivel === "rojo" ? -1 : 1));
}
