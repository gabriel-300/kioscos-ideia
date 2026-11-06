// Disparadores en segundo plano: la venta (o su anulación) termina y el cajero sigue trabajando;
// la comunicación con ARCA ocurre después de responder. Si falla, el comprobante queda
// 'pendiente' en la base y se reintenta (ver reintentarPendientes). Nunca lanza.

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { emitirFacturaDeVenta, emitirNotaCreditoPorAnulacion } from "./emitir";
import { comoComprobanteVenta } from "./venta-factura";
import type { ComprobanteVenta } from "./ticket-html";

/** after() solo existe dentro de un request; si se llama desde otro lado se corre igual, sin esperar. */
function enSegundoPlano(tarea: () => Promise<void>): void {
  try { after(tarea); } catch { void tarea(); }
}

export function facturarVentaEnSegundoPlano(movimientoId: string, userId?: string | null): void {
  enSegundoPlano(async () => {
    try {
      const r = await emitirFacturaDeVenta(createAdminClient(), movimientoId, { origen: "automatico", userId });
      if (!r.ok && !r.noCorresponde) console.error(`[arca] factura de la venta ${movimientoId} pendiente: ${r.error}`);
    } catch (e) {
      console.error(`[arca] error inesperado al facturar la venta ${movimientoId}:`, e);
    }
  });
}

export function notaCreditoEnSegundoPlano(movimientoId: string, userId?: string | null): void {
  enSegundoPlano(async () => {
    try {
      const r = await emitirNotaCreditoPorAnulacion(createAdminClient(), movimientoId, userId);
      if (!r.ok) console.error(`[arca] nota de crédito de la venta ${movimientoId} pendiente: ${r.error}`);
    } catch (e) {
      console.error(`[arca] error inesperado al emitir la nota de crédito de ${movimientoId}:`, e);
    }
  });
}

/**
 * Facturación automática de una venta cobrada con QR de Mercado Pago o transferencia, ESPERANDO a ARCA hasta `esperaMs`.
 * Si responde a tiempo se devuelve el comprobante (el POS lo muestra y lo imprime en el momento). Si tarda más, la venta
 * sigue su camino y la factura se termina en segundo plano (se ve después en el historial). Nunca lanza.
 */
export async function facturarVentaAutomaticaEsperando(
  movimientoId: string, userId?: string | null, esperaMs = 8000,
): Promise<{ factura?: ComprobanteVenta; facturaError?: string }> {
  const db = createAdminClient();
  const trabajo = emitirFacturaDeVenta(db, movimientoId, { origen: "automatico", userId }).catch((e) => {
    console.error(`[arca] error inesperado al facturar la venta ${movimientoId}:`, e);
    return null;
  });
  // Mantiene vivo el trabajo aunque la respuesta al cajero salga antes de que termine.
  enSegundoPlano(async () => { await trabajo; });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<"tarda">((resolve) => { timer = setTimeout(() => resolve("tarda"), esperaMs); });
  const r = await Promise.race([trabajo, limite]);
  clearTimeout(timer);

  if (r === "tarda" || r === null) return {};
  if (r.ok) {
    try { return { factura: await comoComprobanteVenta(db, r.comprobante) }; }
    catch (e) { console.error("[arca] no se pudo armar el comprobante para el POS:", e); return {}; }
  }
  if (r.noCorresponde) return {};
  console.error(`[arca] factura de la venta ${movimientoId} pendiente: ${r.error}`);
  return { facturaError: r.error };
}
