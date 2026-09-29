// Beneficios para clientes registrados: un % de descuento sobre los productos
// y/o envío gratis en la primera compra. Puro (sin base ni red) y sin imports
// de servidor: lo usa el servidor para cobrar y la pantalla para mostrar de
// cuánto es el beneficio, con la misma cuenta.
//
// El descuento es solo sobre productos, nunca sobre el envío.

export type ConfigBeneficio = {
  descuentoPct:       number;  // 0 = sin descuento
  descuentoSoloPrimera: boolean;
  envioGratisPrimera: boolean;
};

export type Beneficio = {
  descuentoProductos: number;  // monto a restar del subtotal
  envioBonificado:    boolean; // el envío se cobra $0
};

const SIN_BENEFICIO: Beneficio = { descuentoProductos: 0, envioBonificado: false };

export function redondearCentavos(n: number): number {
  return Math.round(n * 100) / 100;
}

export function hayBeneficios(c: ConfigBeneficio): boolean {
  return c.descuentoPct > 0 || c.envioGratisPrimera;
}

export function calcularBeneficio(p: {
  subtotal:        number;
  esCliente:       boolean;
  esPrimeraCompra: boolean;
  esDelivery:      boolean;
  config:          ConfigBeneficio;
}): Beneficio {
  if (!p.esCliente) return SIN_BENEFICIO;

  const { config } = p;
  const aplicaDescuento = config.descuentoPct > 0 && (!config.descuentoSoloPrimera || p.esPrimeraCompra);
  return {
    descuentoProductos: aplicaDescuento ? redondearCentavos(p.subtotal * (config.descuentoPct / 100)) : 0,
    envioBonificado:    p.esDelivery && config.envioGratisPrimera && p.esPrimeraCompra,
  };
}

// Reparte el descuento entre las líneas del pedido en proporción a su
// subtotal, así la venta (y el margen por producto) reflejan lo que de verdad
// se cobró. La última línea absorbe el redondeo: la suma da exactamente
// subtotal - descuento.
export function repartirDescuento<T extends { subtotal: number }>(items: T[], descuento: number): T[] {
  if (!(descuento > 0) || items.length === 0) return items;
  const total = items.reduce((s, i) => s + i.subtotal, 0);
  if (!(total > 0)) return items;

  let acumulado = 0;
  return items.map((item, idx) => {
    const esUltima = idx === items.length - 1;
    const parte = esUltima ? redondearCentavos(descuento - acumulado) : redondearCentavos(descuento * (item.subtotal / total));
    acumulado += parte;
    return { ...item, subtotal: redondearCentavos(item.subtotal - parte) };
  });
}

const PESOS = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

// Texto corto para invitar a registrarse ("5% de descuento y envío gratis en tu primera compra").
export function describirBeneficio(c: ConfigBeneficio): string | null {
  const partes: string[] = [];
  if (c.descuentoPct > 0) {
    partes.push(`${PESOS.format(c.descuentoPct)}% de descuento${c.descuentoSoloPrimera ? " en tu primera compra" : ""}`);
  }
  if (c.envioGratisPrimera) partes.push(c.descuentoPct > 0 && c.descuentoSoloPrimera ? "envío gratis" : "envío gratis en tu primera compra");
  if (partes.length === 0) return null;
  const texto = partes.join(" y ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
