// Productos que se venden por peso (products.unit_label = "kg"): el cliente no pide "1 chipa",
// pide 300 g. En la tienda se muestra el precio de 100 g, se elige entre cantidades rápidas (100, 200, 300 g,
// medio kilo, un kilo) y se ajusta de a 100 g. La
// cantidad que viaja al servidor es siempre en kilos (0.3 = 300 g), igual que en la caja.
// Puro: lo usan la tienda (cliente) y el catálogo (servidor).

export const PASO_KG = 0.1;
export const INICIAL_KG = 0.2;
// Lo que más se pide: el cliente toca y listo, sin pensar en kilos.
export const OPCIONES_RAPIDAS_KG = [0.1, 0.2, 0.3, 0.5, 1];

// El precio del kilo asusta ($15.000 por kg); el cliente piensa en 100 g. Solo para mostrar: se cobra sobre el kilo.
export function precioPor100g(precioKg: number): number {
  return Math.round(precioKg / 10);
}
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
