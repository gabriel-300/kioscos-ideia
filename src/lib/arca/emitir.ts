// Emisión de comprobantes: Factura B (6) y Nota de Crédito B (8).
//
// Garantías que importan:
//  · Una venta no se factura dos veces: la fila de comprobantes_arca se crea ANTES de hablar
//    con ARCA y el índice único (movimiento_id, cbte_tipo) hace de candado.
//  · Si un intento se corta por timeout, ARCA pudo haber autorizado igual: antes de reintentar
//    se consulta el número que se había pedido y, si existe, se adopta su CAE.
//  · Que ARCA esté caída NUNCA frena la venta: queda 'pendiente' y se reintenta.
//  · Un rechazo de ARCA (dato inválido) queda 'error' con el motivo, para que lo vea una persona.

import { fechaHoyAR } from "@/lib/fecha";
import { desglosarIva, importeArca, type TramoIva } from "./calculo";
import {
  ArcaError, consultarComprobante, ERR_NUMERO_NO_CORRELATIVO, solicitarCae, ultimoAutorizado,
  type Ambiente, type Auth,
} from "./cliente";
import { debeFacturarseSola, normalizarReceptor, type TipoFactura, type VentaParaFacturar } from "./reglas";
import { obtenerTicket } from "./ticket";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const FACTURA_A = 1;
export const NOTA_CREDITO_A = 3;
export const FACTURA_B = 6;
export const NOTA_CREDITO_B = 8;
const TIPOS_FACTURA = [FACTURA_A, FACTURA_B];
const esNotaDeCredito = (tipo: number) => tipo === NOTA_CREDITO_A || tipo === NOTA_CREDITO_B;
/** Nota de crédito que anula una factura, y la factura que anula una nota de crédito. */
const tipoNotaDe = (factura: number) => (factura === FACTURA_A ? NOTA_CREDITO_A : NOTA_CREDITO_B);
const tipoFacturaDe = (nota: number) => (nota === NOTA_CREDITO_A ? FACTURA_A : FACTURA_B);
const letra = (tipo: number) => (tipo === FACTURA_A || tipo === NOTA_CREDITO_A ? "A" : "B");
const LEASE_MS = 2 * 60_000;

export type ComprobanteRow = {
  id: string; movimiento_id: string; sucursal_id: string; emisor_id: string; ambiente: Ambiente;
  cbte_tipo: number; punto_venta: number; numero: number | null; numero_intentado: number | null;
  fecha: string; doc_tipo: number; doc_nro: string; cond_iva_receptor: number;
  imp_total: number; imp_neto: number; imp_iva: number;
  iva: { alicuota: number; idArca: number; base: number; importe: number }[];
  origen: "automatico" | "manual" | "anulacion";
  estado: "pendiente" | "emitido" | "error";
  cae: string | null; cae_vto: string | null; comprobante_asociado_id: string | null;
  error: string | null; intentos: number; tomado_en: string | null;
};

export type Emision =
  | { ok: true; comprobante: ComprobanteRow }
  | { ok: false; error: string; pendiente?: boolean; noCorresponde?: boolean };

const yyyymmdd = (iso: string) => iso.replaceAll("-", "");
const isoDeArca = (s: string) => (s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null);

// ── Preparar la factura de una venta ────────────────────────────────────────
type Opciones = { origen: "automatico" | "manual"; documento?: string | null; userId?: string | null; tipo?: TipoFactura };

export async function emitirFacturaDeVenta(db: Db, movimientoId: string, opc: Opciones): Promise<Emision> {
  const { data: mov, error } = await db
    .from("movimientos")
    .select(`id, tipo, canal, fecha, sucursal_id, anulado_en, pago_efectivo, pago_billetera, pago_tarjeta, pago_transferencia,
             movimiento_items ( subtotal, product:products ( alicuota_iva ) ),
             sucursal:sucursales ( arca_modo, arca_punto_venta, emisor:arca_emisores!sucursales_arca_emisor_id_fkey ( id, cuit, ambiente, activo ) )`)
    .eq("id", movimientoId)
    .maybeSingle();
  if (error || !mov) return { ok: false, error: "No se encontró la venta." };

  const suc = mov.sucursal;
  if (mov.tipo !== "venta") return { ok: false, error: "Solo se facturan ventas.", noCorresponde: true };
  if (mov.anulado_en) return { ok: false, error: "La venta está anulada.", noCorresponde: true };
  if (!suc || suc.arca_modo === "desactivado") return { ok: false, error: "Esta sucursal no tiene la facturación activada.", noCorresponde: true };
  if (!suc.emisor?.activo || !suc.arca_punto_venta) return { ok: false, error: "Falta configurar el emisor o el punto de venta de la sucursal." };
  if (opc.origen === "automatico" && !debeFacturarseSola(mov as VentaParaFacturar)) {
    return { ok: false, error: "No corresponde facturar sola (no se cobró con el QR de Mercado Pago ni por transferencia).", noCorresponde: true };
  }

  // La Factura A solo se emite a mano: lo digital sale siempre como B.
  const tipoFact = opc.origen === "manual" && opc.tipo === "A" ? FACTURA_A : FACTURA_B;

  // ¿Ya existe una factura de esta venta? Misma letra: emitida → se devuelve; pendiente/error → se reintenta
  // sobre la misma fila. Otra letra: no se emite una segunda (habría que anular la primera con una nota de crédito).
  const { data: previas } = await db.from("comprobantes_arca").select("*").eq("movimiento_id", movimientoId).in("cbte_tipo", TIPOS_FACTURA);
  const previo = (previas ?? []).find((c: ComprobanteRow) => c.cbte_tipo === tipoFact);
  const otra = (previas ?? []).find((c: ComprobanteRow) => c.cbte_tipo !== tipoFact);
  if (otra) {
    return { ok: false, error: `Esta venta ya tiene una Factura ${letra(otra.cbte_tipo)} (${otra.estado}). Para emitir una Factura ${letra(tipoFact)} hay que anular la anterior con una nota de crédito.`, noCorresponde: true };
  }
  if (previo?.estado === "emitido") return { ok: true, comprobante: previo };
  if (previo) return procesarComprobante(db, previo.id);

  const receptor = opc.origen === "manual" ? normalizarReceptor(opc.documento, letra(tipoFact) as TipoFactura) : normalizarReceptor(null);
  if (!receptor.receptor) return { ok: false, error: receptor.error ?? "Documento inválido." };

  type Item = { subtotal: number | null; product: { alicuota_iva: number | string | null } | null };
  const lineas = (mov.movimiento_items as Item[])
    .filter((i) => i.subtotal != null && Number(i.subtotal) !== 0)
    .map((i) => ({ subtotal: Number(i.subtotal), alicuota: Number(i.product?.alicuota_iva ?? 21) }));
  // Pedido online: el cobro incluye el envío, que no es un ítem de la venta. Se factura como una
  // línea más al 21% para que el comprobante coincida con lo que se cobró.
  if (mov.canal === "pedido_online") {
    const cobrado = ["pago_efectivo", "pago_billetera", "pago_tarjeta", "pago_transferencia"].reduce((s, k) => s + Number(mov[k] ?? 0), 0);
    const items = lineas.reduce((s, l) => s + l.subtotal, 0);
    const envio = Math.round((cobrado - items) * 100) / 100;
    if (envio > 0) lineas.push({ subtotal: envio, alicuota: 21 });
  }
  let d;
  try { d = desglosarIva(lineas); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "No se pudo calcular el IVA." }; }
  if (d.total <= 0) return { ok: false, error: "La venta no tiene importe para facturar.", noCorresponde: true };

  const { data: nuevo, error: errIns } = await db.from("comprobantes_arca").insert({
    movimiento_id: movimientoId, sucursal_id: mov.sucursal_id, emisor_id: suc.emisor.id, ambiente: suc.emisor.ambiente,
    cbte_tipo: tipoFact, punto_venta: suc.arca_punto_venta, fecha: fechaHoyAR(),
    doc_tipo: receptor.receptor.docTipo, doc_nro: receptor.receptor.docNro, cond_iva_receptor: receptor.receptor.condicionIva,
    imp_total: d.total, imp_neto: d.neto, imp_iva: d.iva, iva: d.tramos,
    origen: opc.origen, created_by: opc.userId ?? null,
  }).select("id").single();

  if (errIns) {
    if (errIns.code === "23505") { // otra instancia la creó justo antes
      const { data: otro } = await db.from("comprobantes_arca").select("id").eq("movimiento_id", movimientoId).eq("cbte_tipo", tipoFact).single();
      if (otro) return procesarComprobante(db, otro.id);
    }
    return { ok: false, error: `No se pudo registrar el comprobante: ${errIns.message}` };
  }
  return procesarComprobante(db, nuevo.id);
}

// ── Nota de crédito al anular una venta facturada ───────────────────────────
export async function emitirNotaCreditoPorAnulacion(db: Db, movimientoId: string, userId?: string | null): Promise<Emision | { ok: true; sinFactura: true }> {
  const { data: facturas } = await db.from("comprobantes_arca").select("*").eq("movimiento_id", movimientoId).in("cbte_tipo", TIPOS_FACTURA);
  if (!facturas?.length) return { ok: true, sinFactura: true };

  // Facturas que nunca llegaron a emitirse: no hay nada que anular en ARCA, solo se frenan.
  for (const f of facturas as ComprobanteRow[]) {
    if (f.estado !== "emitido") {
      await db.from("comprobantes_arca").update({ estado: "error", error: "La venta se anuló antes de facturarse.", tomado_en: null }).eq("id", f.id);
    }
  }
  const factura = (facturas as ComprobanteRow[]).find((f) => f.estado === "emitido");
  if (!factura) return { ok: true, sinFactura: true };
  const tipoNota = tipoNotaDe(factura.cbte_tipo);

  const { data: existente } = await db.from("comprobantes_arca").select("*").eq("movimiento_id", movimientoId).eq("cbte_tipo", tipoNota).maybeSingle();
  if (existente?.estado === "emitido") return { ok: true, comprobante: existente };
  if (existente) return procesarComprobante(db, existente.id);

  const { data: nc, error } = await db.from("comprobantes_arca").insert({
    movimiento_id: movimientoId, sucursal_id: factura.sucursal_id, emisor_id: factura.emisor_id, ambiente: factura.ambiente,
    cbte_tipo: tipoNota, punto_venta: factura.punto_venta, fecha: fechaHoyAR(),
    doc_tipo: factura.doc_tipo, doc_nro: factura.doc_nro, cond_iva_receptor: factura.cond_iva_receptor,
    imp_total: factura.imp_total, imp_neto: factura.imp_neto, imp_iva: factura.imp_iva, iva: factura.iva,
    origen: "anulacion", comprobante_asociado_id: factura.id, created_by: userId ?? null,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") {
      const { data: otro } = await db.from("comprobantes_arca").select("id").eq("movimiento_id", movimientoId).eq("cbte_tipo", tipoNota).single();
      if (otro) return procesarComprobante(db, otro.id);
    }
    return { ok: false, error: `No se pudo registrar la nota de crédito: ${error.message}` };
  }
  return procesarComprobante(db, nc.id);
}

// ── Hablar con ARCA ─────────────────────────────────────────────────────────
async function soltar(db: Db, id: string, cambios: Record<string, unknown>) {
  await db.from("comprobantes_arca").update({ tomado_en: null, ...cambios }).eq("id", id);
}

export async function procesarComprobante(db: Db, id: string): Promise<Emision> {
  const { data: actual } = await db.from("comprobantes_arca").select("*").eq("id", id).maybeSingle();
  if (!actual) return { ok: false, error: "Comprobante inexistente." };
  if (actual.estado === "emitido") return { ok: true, comprobante: actual };

  // Candado: solo una instancia procesa a la vez (el candado vence a los 2 minutos).
  const vencido = new Date(Date.now() - LEASE_MS).toISOString();
  const { data: row } = await db.from("comprobantes_arca")
    .update({ tomado_en: new Date().toISOString(), intentos: actual.intentos + 1 })
    .eq("id", id).neq("estado", "emitido").or(`tomado_en.is.null,tomado_en.lt.${vencido}`)
    .select("*").maybeSingle();
  if (!row) return { ok: false, error: "El comprobante se está emitiendo en este momento.", pendiente: true };
  const c = row as ComprobanteRow;

  try {
    // Una factura de una venta que se anuló mientras esperaba no se emite.
    if (TIPOS_FACTURA.includes(c.cbte_tipo)) {
      const { data: m } = await db.from("movimientos").select("anulado_en").eq("id", c.movimiento_id).maybeSingle();
      if (m?.anulado_en) {
        await soltar(db, id, { estado: "error", error: "La venta se anuló antes de facturarse." });
        return { ok: false, error: "La venta se anuló antes de facturarse.", noCorresponde: true };
      }
    }

    const { data: emisor } = await db.from("arca_emisores").select("cuit").eq("id", c.emisor_id).single();
    if (!emisor) throw new ArcaError("El emisor del comprobante ya no existe.", false);
    const auth: Auth = { ticket: await obtenerTicket(db, c.ambiente), cuit: emisor.cuit };

    // ¿El intento anterior se cortó pero ARCA sí lo autorizó?
    if (c.numero_intentado) {
      const ya = await consultarComprobante(c.ambiente, auth, c.punto_venta, c.cbte_tipo, c.numero_intentado);
      if (ya && Math.abs(ya.total - Number(c.imp_total)) < 0.005) {
        return await guardarEmitido(db, id, c.numero_intentado, ya.cae, isoDeArca(ya.caeVto));
      }
    }

    let asociado;
    if (esNotaDeCredito(c.cbte_tipo)) {
      const { data: f } = await db.from("comprobantes_arca").select("numero, fecha, punto_venta").eq("id", c.comprobante_asociado_id).single();
      if (!f?.numero) throw new ArcaError("La factura original no tiene número.", false);
      asociado = { tipo: tipoFacturaDe(c.cbte_tipo), ptoVta: f.punto_venta as number, numero: Number(f.numero), cuit: emisor.cuit as string, fecha: yyyymmdd(f.fecha as string) };
    }

    const tramos: TramoIva[] = c.iva.map((t) => ({ alicuota: t.alicuota, idArca: t.idArca, base: Number(t.base), importe: Number(t.importe) }));
    let ultimoMotivo = "";
    for (let intento = 0; intento < 3; intento++) {
      const numero = (await ultimoAutorizado(c.ambiente, auth, c.punto_venta, c.cbte_tipo)) + 1;
      await db.from("comprobantes_arca").update({ numero_intentado: numero }).eq("id", id);

      const r = await solicitarCae(c.ambiente, auth, {
        ptoVta: c.punto_venta, tipo: c.cbte_tipo, numero, fecha: yyyymmdd(c.fecha),
        docTipo: c.doc_tipo, docNro: c.doc_nro, condicionIvaReceptor: c.cond_iva_receptor ?? 5,
        total: importeArca(Number(c.imp_total)), neto: importeArca(Number(c.imp_neto)), iva: importeArca(Number(c.imp_iva)),
        tramos: tramos.map((t) => ({ idArca: t.idArca, base: importeArca(t.base), importe: importeArca(t.importe) })),
        asociado,
      });
      if (r.aprobado) return await guardarEmitido(db, id, numero, r.cae, isoDeArca(r.caeVto));

      ultimoMotivo = r.errores.join(" | ");
      if (!ultimoMotivo.includes(ERR_NUMERO_NO_CORRELATIVO)) break; // rechazo real: no se reintenta solo
    }
    await soltar(db, id, { estado: "error", error: ultimoMotivo.slice(0, 1000) });
    return { ok: false, error: ultimoMotivo };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const transitorio = e instanceof ArcaError ? e.transitorio : true;
    await soltar(db, id, { estado: transitorio ? "pendiente" : "error", error: msg.slice(0, 1000) });
    return { ok: false, error: msg, pendiente: transitorio };
  }
}

async function guardarEmitido(db: Db, id: string, numero: number, cae: string, caeVto: string | null): Promise<Emision> {
  const { data, error } = await db.from("comprobantes_arca").update({
    estado: "emitido", numero, cae, cae_vto: caeVto, emitido_en: new Date().toISOString(), error: null, tomado_en: null,
  }).eq("id", id).select("*").single();
  // Caso grave: ARCA autorizó pero no pudimos guardarlo. El log lleva todo lo necesario para repararlo a mano.
  if (error) {
    console.error(`[arca] AUTORIZADO pero sin guardar: comprobante ${id} número ${numero} CAE ${cae}: ${error.message}`);
    return { ok: false, error: `ARCA autorizó el comprobante ${numero} (CAE ${cae}) pero no se pudo guardar: ${error.message}` };
  }
  return { ok: true, comprobante: data };
}

// ── Reintentos ──────────────────────────────────────────────────────────────
/** Reintenta los pendientes (ARCA caída, red). Los 'error' no se reintentan solos: los revisa una persona. */
export async function reintentarPendientes(db: Db, limite = 20): Promise<{ intentados: number; emitidos: number }> {
  const vencido = new Date(Date.now() - LEASE_MS).toISOString();
  const { data } = await db.from("comprobantes_arca").select("id")
    .eq("estado", "pendiente").or(`tomado_en.is.null,tomado_en.lt.${vencido}`)
    .order("created_at", { ascending: true }).limit(limite);
  let emitidos = 0;
  for (const { id } of (data ?? []) as { id: string }[]) {
    if ((await procesarComprobante(db, id)).ok) emitidos++;
  }
  return { intentados: (data ?? []).length, emitidos };
}
