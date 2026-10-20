// Productos que se venden por peso (products.unit_label = "kg"): el cliente no pide "1 chipa",
// pide 300 g. En la tienda se cambia de a 100 g y el primer "Agregar" arranca en 500 g. La
// cantidad que viaja al servidor es siempre en kilos (0.3 = 300 g), igual que en la caja.
// Puro: lo usan la tienda (cliente) y el catálogo (servidor).

export const PASO_KG = 0.1;
export const INICIAL_KG = 0.5;
// Menos de un paso de stock no alcanza para vender nada.
export const STOCK_MINIMO_KG = PASO_KG;

const KILOS = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 });

// Sin arrastrar errores de coma flotante (0.1 + 0.2 = 0.30000000000000004).
export function redondearKg(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function sumarKg(actual: number, delta: number): number {
  return redondearKg(actual + delta);
}

// "300 g", "1,2 kg"; los productos por unidad se muestran tal cual ("2").
export function textoCantidad(qty: number, porPeso: boolean): string {
  if (!porPeso) return String(qty);
  return qty < 1 ? `${Math.round(qty * 1000)} g` : `${KILOS.format(qty)} kg`;
}
