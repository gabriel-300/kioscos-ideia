// Buscador de facturas para reimprimir (pantalla «Facturas» de cada sucursal). Lógica pura.

import type { ComprobanteVenta } from "./ticket-html";
import { letraDe } from "./tipos";

export type FilaFactura = {
  movimientoId: string;
  fecha: string;           // fecha de la venta (yyyy-mm-dd)
  creadaEn: string;        // cuándo se registró la venta (ISO)
  lineas: { nombre: string; cantidad: number; precio: number | null; subtotal: number | null }[];
  comprobante: ComprobanteVenta;
};

const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Número tal como se imprime: 00002-00000001. */
export const numeroImpreso = (c: { punto_venta: number; numero: number | null }) =>
  c.numero ? `${String(c.punto_venta).padStart(5, "0")}-${String(c.numero).padStart(8, "0")}` : "";

/** Lo que se busca en cada factura: número (con y sin guion ni ceros), importe, documento del cliente y letra. */
function textoBuscable(f: FilaFactura): string {
  const c = f.comprobante;
  const num = numeroImpreso(c);
  const importe = Number(c.imp_total);
  return sinAcentos([
    num, num.replace("-", ""), String(c.numero ?? ""), `pv ${c.punto_venta}`,
    // el importe, como lo escribe cada persona: 2500.5, 2500.50, 2500,5, 2500,50 y 2.500,5
    String(importe), importe.toFixed(2), String(importe).replace(".", ","), importe.toFixed(2).replace(".", ","),
    importe.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
    c.doc_nro && c.doc_nro !== "0" ? c.doc_nro : "consumidor final",
    c.cond_iva_receptor === 4 ? "exento iva sujeto exento" : "",
    `factura ${letraDe(c.cbte_tipo)}`,
    f.lineas.map((l) => l.nombre).join(" "),
  ].join(" | "));
}

/**
 * Filtra por todas las palabras escritas (todas tienen que aparecer). Vacío = todas.
 * Las palabras de 1 o 2 caracteres («a», «b», «3») tienen que coincidir con una palabra entera: si no, una letra
 * suelta coincidiría con casi cualquier texto.
 */
export function filtrarFacturas(filas: FilaFactura[], consulta: string): FilaFactura[] {
  const palabras = sinAcentos(consulta).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return filas;
  return filas.filter((f) => {
    const t = textoBuscable(f);
    const enteras = new Set(t.split(/[^a-z0-9]+/).filter(Boolean));
    return palabras.every((p) => (p.length <= 2 ? enteras.has(p) : t.includes(p)));
  });
}
