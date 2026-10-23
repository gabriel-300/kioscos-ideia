import { PASO_KG, redondearKg, textoCantidad } from "./cantidad-peso";

// Cuando un producto del pedido no alcanza (el servidor lo avisa al confirmar), el cliente tiene que entender
// cuánto queda y qué hacer: "Quedan solo 300 g de Chipa y pediste 500 g". Puro: lo usa la tienda (cliente).
//
// `disponible` y `pedido` vienen en la unidad del carrito: unidades, o kilos si se vende por peso.

export type AjusteSinStock = {
  maximo: number; // lo más que se puede pedir ahora (0 = agotado); en pasos de 1 unidad o de 100 g
  texto:  string; // mensaje para el cliente
  aviso:  string; // lo que se le cuenta al volver al carrito con el pedido ajustado
};

export function ajusteSinStock(p: { nombre: string; disponible: number; pedido: number; porPeso: boolean }): AjusteSinStock {
  const nombre = p.nombre.trim();
  const queda = Math.max(0, Number.isFinite(p.disponible) ? p.disponible : 0);
  const maximo = p.porPeso
    ? redondearKg(Math.floor(redondearKg(queda) / PASO_KG + 1e-9) * PASO_KG)
    : Math.floor(queda);

  if (maximo <= 0) {
    return {
      maximo: 0,
      texto: `${nombre} se agotó. Sacalo del pedido para seguir.`,
      aviso: `Sacamos ${nombre} del pedido porque se agotó.`,
    };
  }
  return {
    maximo,
    texto: `Quedan solo ${textoCantidad(maximo, p.porPeso)} de ${nombre} y pediste ${textoCantidad(p.pedido, p.porPeso)}. Bajá la cantidad para seguir.`,
    aviso: `Ajustamos ${nombre} a ${textoCantidad(maximo, p.porPeso)}, que es lo que queda.`,
  };
}
