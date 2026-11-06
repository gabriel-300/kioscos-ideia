// Factura pedida en el momento del cobro (casilla «Emitir factura» del POS).
//
// Diferencia con la facturación automática: acá el cajero SÍ espera a ARCA, para poder imprimir la
// factura en el mismo momento. Si ARCA falla, la venta ya está registrada: se devuelve el motivo y
// la factura queda pendiente (se reintenta sola, o con el botón «Facturar» del historial).

import { emitirFacturaDeVenta, type ComprobanteRow } from "./emitir";
import { normalizarReceptor, type TipoFactura } from "./reglas";
import type { ComprobanteVenta } from "./ticket-html";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type PedidoFactura = { documento?: string | null; tipo?: TipoFactura };

/** Se corre ANTES de crear la venta: si el pedido no se puede cumplir, la venta ni se registra. */
export async function validarPedidoFactura(db: Db, sucursalId: string, canal: string | null, pedido: PedidoFactura): Promise<string | null> {
  if ((canal ?? "consumidor_final") !== "consumidor_final") return "La factura se emite solo en ventas de consumidor final.";
  const { data: suc } = await db.from("sucursales").select("arca_modo, arca_punto_venta, emisor:arca_emisores!sucursales_arca_emisor_id_fkey(activo)").eq("id", sucursalId).maybeSingle();
  if (!suc || suc.arca_modo === "desactivado" || !suc.arca_punto_venta || !suc.emisor?.activo) {
    return "Esta sucursal no tiene la facturación activada.";
  }
  const r = normalizarReceptor(pedido.documento, pedido.tipo === "A" ? "A" : "B");
  return r.receptor ? null : (r.error ?? "Documento inválido.");
}

/** Emite la factura de una venta ya registrada y devuelve el comprobante listo para imprimir. */
export async function facturarVentaAhora(db: Db, movimientoId: string, pedido: PedidoFactura, userId: string): Promise<{ factura?: ComprobanteVenta; error?: string }> {
  const r = await emitirFacturaDeVenta(db, movimientoId, { origen: "manual", documento: pedido.documento, tipo: pedido.tipo === "A" ? "A" : "B", userId });
  if (!r.ok) return { error: r.error };
  return { factura: await comoComprobanteVenta(db, r.comprobante) };
}

export async function comoComprobanteVenta(db: Db, c: ComprobanteRow): Promise<ComprobanteVenta> {
  const { data: emisor } = await db.from("arca_emisores").select("cuit, razon_social, domicilio, ingresos_brutos, inicio_actividades").eq("id", c.emisor_id).maybeSingle();
  return {
    movimiento_id: c.movimiento_id, cbte_tipo: c.cbte_tipo, punto_venta: c.punto_venta, numero: c.numero, fecha: c.fecha,
    estado: c.estado, cae: c.cae, cae_vto: c.cae_vto, doc_tipo: c.doc_tipo, doc_nro: c.doc_nro,
    imp_total: Number(c.imp_total), imp_neto: Number(c.imp_neto), imp_iva: Number(c.imp_iva), ambiente: c.ambiente, error: c.error,
    iva: c.iva, cond_iva_receptor: c.cond_iva_receptor, emisor: emisor ?? null,
  };
}
