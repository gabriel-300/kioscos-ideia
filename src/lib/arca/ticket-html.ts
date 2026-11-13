// Ticket de venta para imprimir (80 mm). Lo usan el historial de la sucursal y el POS, con o sin factura.
// Sin factura: comprobante interno «sin validez fiscal». Con factura emitida (A o B): ticket fiscal con los
// datos del emisor, CAE, vencimiento y QR de ARCA. Solo arma el HTML; abrirTicket() es lo único que toca el navegador.

import { urlQrArca } from "./qr";
import { conRetencion, esFactura, letraDe } from "./tipos";
import { qrComoSvg } from "@/lib/pedidos/qr";
import { clienteConocido } from "./reglas";

/** Comprobante de ARCA de una venta, como lo leen el historial y el POS. */
export type ComprobanteVenta = {
  movimiento_id: string; cbte_tipo: number; punto_venta: number; numero: number | null; fecha: string;
  estado: "pendiente" | "emitido" | "error"; cae: string | null; cae_vto: string | null;
  doc_tipo: number; doc_nro: string; imp_total: number; imp_neto: number; imp_iva: number; ambiente: string; error: string | null;
  iva?: { alicuota: number; base: number; importe: number }[]; cond_iva_receptor?: number;
  local_direccion?: string | null;   // dirección del local donde se vendió (se imprime bajo «Local:»)
  referencia?: string | null;   // N° de orden de compra / expediente del cliente (opcional)
  emitido_en?: string | null;   // cuándo aprobó ARCA el comprobante (sirve para saber si una impresión es copia)
  emisor: { cuit: string; razon_social: string; domicilio?: string | null; ingresos_brutos?: string | null; inicio_actividades?: string | null } | null;
};

export type LineaTicket = { nombre: string; cantidad: number; precio: number | null; subtotal: number | null };

// Facturas (A=1, B=6); las notas de crédito (3 y 8) no se imprimen como ticket de venta.
export const esFacturaCbte = (c: { cbte_tipo: number }) => esFactura(c.cbte_tipo);
export const letraCbte = (c: { cbte_tipo: number }) => letraDe(c.cbte_tipo);
export const nroCbte = (c: { punto_venta: number; numero: number | null }) =>
  c.numero ? `${String(c.punto_venta).padStart(5, "0")}-${String(c.numero).padStart(8, "0")}` : "—";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const AR2 = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
const diaMesAnio = (iso: string) => iso.split("-").reverse().join("/");

export function armarTicketHtml(p: {
  lineas: LineaTicket[];
  total: number;
  fecha: string;             // yyyy-mm-dd
  id: string;                // últimos 8 caracteres del id de la venta, en mayúsculas
  sucursalNombre: string;
  factura?: ComprobanteVenta | null;
  imprimir?: boolean;        // true (por defecto) agrega el window.print() automático
  copia?: boolean;           // reimpresión de una factura ya entregada: lleva la marca «COPIA»
}): string {
  const { factura } = p;
  const fiscal = !!factura && factura.estado === "emitido" && !!factura.cae && !!factura.numero && !!factura.emisor;
  const f = fiscal ? factura! : null;
  const fechaLarga = new Date(p.fecha + "T00:00:00").toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const qrSvg = f
    ? qrComoSvg(urlQrArca({ fecha: f.fecha, cuit: f.emisor!.cuit, puntoVenta: f.punto_venta, tipoCmp: f.cbte_tipo, numero: Number(f.numero), importe: Number(f.imp_total), docTipo: f.doc_tipo, docNro: f.doc_nro, cae: f.cae! }))
    : "";

  const cli = f ? clienteConocido(f.doc_nro) : null;
  const rows = p.lineas.map((l) => `
    <tr>
      <td style="padding:4px 0;border-bottom:1px solid #eee">${esc(l.nombre)}</td>
      <td style="padding:4px 0;border-bottom:1px solid #eee;text-align:center">${l.cantidad}</td>
      <td style="padding:4px 0;border-bottom:1px solid #eee;text-align:right">${AR.format(l.precio ?? 0)}</td>
      <td style="padding:4px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${l.subtotal != null ? AR.format(l.subtotal) : "—"}</td>
    </tr>`).join("");

  const cabeceraFiscal = f ? `<h1>${esc(f.emisor!.razon_social)}</h1>
  <div class="sub">CUIT ${f.emisor!.cuit} · IVA Responsable Inscripto</div>
  ${f.emisor!.domicilio ? `<div class="sub">${esc(f.emisor!.domicilio)}</div>` : ""}
  ${f.emisor!.ingresos_brutos ? `<div class="sub">IIBB ${esc(f.emisor!.ingresos_brutos)}${f.emisor!.inicio_actividades ? " · Inicio act. " + diaMesAnio(f.emisor!.inicio_actividades) : ""}</div>` : ""}
  <div class="divider"></div>
  <div style="text-align:center;font-weight:800;font-size:15px">FACTURA ${letraCbte(f)} · Cód. ${String(f.cbte_tipo).padStart(3, "0")}</div>
  ${p.copia ? '<div class="sub" style="font-weight:800">*** COPIA — REIMPRESIÓN ***</div>' : ""}
  ${conRetencion(f.cbte_tipo) ? '<div style="text-align:center;font-weight:800;font-size:11px">OPERACIÓN SUJETA A RETENCIÓN</div>' : ""}
  <div class="sub">N° ${nroCbte(f)} · ${diaMesAnio(f.fecha)}</div>
  <div class="sub">${letraCbte(f) === "A" ? "CUIT " + f.doc_nro + " · IVA Responsable Inscripto" : (f.cond_iva_receptor === 4 ? "IVA SUJETO EXENTO · CUIT " + f.doc_nro : "A CONSUMIDOR FINAL" + (f.doc_nro && f.doc_nro !== "0" ? " · Doc. " + f.doc_nro : ""))}</div>
  ${cli ? `<div class="sub" style="font-weight:700">${esc(cli.nombre)}</div><div class="sub">${esc(cli.domicilio)}</div>` : ""}
  <div class="sub">Condición de venta: Contado</div>
  ${f.referencia ? `<div class="sub">Orden de compra / Expte.: <b>${esc(f.referencia)}</b></div>` : ""}
  ${f.ambiente === "homologacion" ? '<div class="sub" style="font-weight:800">*** PRUEBA — SIN VALIDEZ FISCAL ***</div>' : ""}` : `<h1>ANGIRU FOOD</h1>`;

  const ivaA = f && letraCbte(f) === "A"
    ? `<div style="margin-top:8px;font-size:11px">Importe neto gravado: <b>${AR2.format(f.imp_neto)}</b><br>${(f.iva ?? []).map((t) => "IVA " + String(t.alicuota).replace(".", ",") + "%: <b>" + AR2.format(t.importe) + "</b>").join("<br>")}</div>` : "";
  const ivaB = f && letraCbte(f) === "B"
    ? `<div style="margin-top:8px;font-size:10.5px">Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)<br>IVA contenido: <b>${AR2.format(f.imp_iva)}</b></div>` : "";
  const pieFiscal = f
    ? `<div style="margin-top:8px;font-size:11px">CAE: <b>${f.cae}</b><br>Vto. CAE: ${diaMesAnio(f.cae_vto ?? "")}</div>
  <div style="width:34mm;margin:8px auto 0">${qrSvg}</div>` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Ticket ${p.id}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body { font-family: monospace; font-size: 12px; width: 80mm; margin: 0; padding: 6mm 4mm; color:#111; }
    h1 { font-size: 19px; font-weight: 800; text-align:center; letter-spacing:1.5px; margin: 0; }
    .sub { color: #555; text-align:center; font-size: 11px; margin-top:2px; }
    .divider { border-top:2px solid #333; margin:9px 0; }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top:9px; }
    th, td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; color: #999; padding-bottom: 4px; border-bottom: 2px solid #000; }
    th:nth-child(2),th:nth-child(3),th:nth-child(4){text-align:right}
    th:first-child, td:first-child { width: 34%; white-space: normal; }
    th:nth-child(2), td:nth-child(2) { width: 10%; }
    th:nth-child(3), td:nth-child(3) { width: 25%; }
    th:nth-child(4), td:nth-child(4) { width: 31%; }
    td:nth-child(n+2) { overflow: visible; text-overflow: clip; font-size: 11px; }
    .total { font-size: 16px; font-weight: 800; text-align: right; margin-top: 10px; border-top: 2px solid #000; padding-top: 6px; }
    .footer { text-align: center; margin-top: 16px; }
    .footer .thanks { font-size:13px; font-weight:bold; letter-spacing:.5px; }
    .footer .legal { font-size:9.5px; color:#999; margin-top:8px; border-top:1px dashed #ccc; padding-top:8px; }
  </style></head><body>
  ${cabeceraFiscal}
  <div class="sub">${f ? "Local: " : ""}${esc(p.sucursalNombre)}</div>${f?.local_direccion ? `<div class="sub">${esc(f.local_direccion)}</div>` : ""}
  <div class="sub">${fechaLarga} · #${p.id}</div>
  <div class="divider"></div>
  <table>
    <thead><tr><th>Producto</th><th style="text-align:right">Cant</th><th style="text-align:right">Precio</th><th style="text-align:right">Subtotal</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total">TOTAL: ${AR.format(p.total)}</div>
  ${ivaA}
  ${ivaB}
  ${pieFiscal}
  <div class="footer"><div class="thanks">¡GRACIAS POR SU COMPRA!</div>${fiscal ? "" : '<div class="legal">Este comprobante no tiene validez fiscal</div>'}</div>
  ${p.imprimir === false ? "" : "<script>window.onload=()=>{window.print();window.onafterprint=()=>window.close()}</script>"}
  </body></html>`;
}

/** Minutos desde la emisión a partir de los cuales una impresión se considera reimpresión (y sale marcada COPIA). */
export const MINUTOS_PARA_COPIA = 10;

/**
 * ¿Esta impresión es una copia? Sí si la factura se emitió hace más de MINUTOS_PARA_COPIA. Así no sale «COPIA» el
 * primer ticket de una factura que tardó en emitirse (el POS ya entregó el original en los primeros minutos).
 */
export function esReimpresion(emitidoEn: string | null | undefined, ahora: number = Date.now()): boolean {
  if (!emitidoEn) return false;
  const t = new Date(emitidoEn).getTime();
  return Number.isFinite(t) && ahora - t > MINUTOS_PARA_COPIA * 60_000;
}

/** Abre el ticket en una ventana y dispara la impresión. Solo en el navegador. */
export function abrirTicket(html: string): void {
  const w = window.open("", "_blank", "width=340,height=500");
  w?.document.write(html);
  w?.document.close();
}

/**
 * Abre la ventana de impresión de inmediato (dentro del clic, para que el navegador no la bloquee) y carga el ticket
 * cuando los datos llegan. Si no hay ticket o falla, cierra la ventana y devuelve false.
 */
export async function abrirTicketDespues(obtenerHtml: () => Promise<string | null>): Promise<boolean> {
  const w = window.open("", "_blank", "width=340,height=500");
  if (!w) return false;
  w.document.write("<p style=\"font-family:sans-serif;padding:16px\">Preparando el ticket…</p>");
  try {
    const html = await obtenerHtml();
    if (!html) { w.close(); return false; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    return true;
  } catch {
    w.close();
    return false;
  }
}
