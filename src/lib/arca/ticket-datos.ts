// Datos para REIMPRIMIR el ticket de una factura ya emitida. Lógica pura.

import type { LineaTicket } from "./ticket-html";

type ItemVenta = {
  cantidad: number;
  precio_unitario: number | null;
  subtotal: number | null;
  product: { name: string } | null;
};

/**
 * Líneas del ticket de una venta. El total que cuenta es el de la FACTURA: en un pedido online el cobro incluye el
 * envío, que no es un ítem de la venta; si los ítems suman menos que la factura, la diferencia sale como una línea
 * más para que el ticket cierre con lo facturado (igual que se hizo al emitir).
 */
export function lineasParaReimprimir(items: ItemVenta[], totalFactura: number): LineaTicket[] {
  const lineas: LineaTicket[] = items.map((i) => ({
    nombre: i.product?.name ?? "Producto",
    cantidad: Math.round(Number(i.cantidad) * 10000) / 10000,
    precio: i.precio_unitario,
    subtotal: i.subtotal,
  }));
  const sumaItems = items.reduce((s, i) => s + Number(i.subtotal ?? 0), 0);
  const diferencia = Math.round((totalFactura - sumaItems) * 100) / 100;
  if (diferencia > 0.005) lineas.push({ nombre: "Envío y otros", cantidad: 1, precio: diferencia, subtotal: diferencia });
  return lineas;
}
