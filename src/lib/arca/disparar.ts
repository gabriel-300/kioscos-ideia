// Disparadores en segundo plano: la venta (o su anulación) termina y el cajero sigue trabajando;
// la comunicación con ARCA ocurre después de responder. Si falla, el comprobante queda
// 'pendiente' en la base y se reintenta (ver reintentarPendientes). Nunca lanza.

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { emitirFacturaDeVenta, emitirNotaCreditoPorAnulacion } from "./emitir";

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
