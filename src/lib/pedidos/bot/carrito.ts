import type { ItemCatalogo } from "../catalogo";
import type { ItemCarritoInput } from "../pricing";
import type { ItemCarrito } from "./estado";

// Operaciones puras sobre el carrito del bot.

const PESOS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
export const formatoPesos = (n: number) => PESOS.format(n);

// Un id de producto y uno de promo nunca chocan (uuid), pero la clave incluye
// el tipo para no depender de eso.
const clave = (id: string, esPromo: boolean) => `${esPromo ? "promo" : "prod"}:${id}`;

export type IndiceCatalogo = Map<string, ItemCatalogo>;

export function indexarCatalogo(items: ItemCatalogo[]): IndiceCatalogo {
  return new Map(items.map((i) => [clave(i.id, i.esPromo), i]));
}

export function buscarItem(indice: IndiceCatalogo, id: string, esPromo: boolean): ItemCatalogo | undefined {
  return indice.get(clave(id, esPromo));
}

export function agregarAlCarrito(carrito: ItemCarrito[], id: string, esPromo: boolean, cantidad: number): ItemCarrito[] {
  const idx = carrito.findIndex((c) => c.id === id && c.esPromo === esPromo);
  if (idx < 0) return [...carrito, { id, esPromo, cantidad }];
  const copia = [...carrito];
  copia[idx] = { ...copia[idx], cantidad: copia[idx].cantidad + cantidad };
  return copia;
}

export function fusionarCarritos(base: ItemCarrito[], agregar: ItemCarrito[]): ItemCarrito[] {
  return agregar.reduce((acc, i) => agregarAlCarrito(acc, i.id, i.esPromo, i.cantidad), base);
}

// Líneas del carrito con precio actual de la sucursal. Lo que ya no está en el
// catálogo se omite (el servidor lo rechaza igual al confirmar).
export function formatearCarrito(carrito: ItemCarrito[], indice: IndiceCatalogo): { texto: string; total: number } {
  let total = 0;
  const lineas: string[] = [];
  for (const c of carrito) {
    const item = buscarItem(indice, c.id, c.esPromo);
    if (!item) continue;
    const subtotal = item.price * c.cantidad;
    total += subtotal;
    lineas.push(`${c.cantidad}x ${item.name} — ${formatoPesos(subtotal)}`);
  }
  return { texto: lineas.join("\n"), total };
}

export function aItemsPedido(carrito: ItemCarrito[]): ItemCarritoInput[] {
  return carrito.map((c) => (c.esPromo ? { promo_id: c.id, cantidad: c.cantidad } : { product_id: c.id, cantidad: c.cantidad }));
}
