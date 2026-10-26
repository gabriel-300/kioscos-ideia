"use client";

import { useState, useTransition } from "react";
import { avanzarEstadoPedido, asignarRepartidor, confirmarPagoRecibido, cancelarPedido, anularPedidoConVenta } from "../actions";

const SIGUIENTE_LABEL: Record<string, string> = {
  confirmado:             "Aceptar y preparar",
  pagado:                 "Marcar en preparación",
  en_preparacion_retiro:  "Marcar listo para retirar",
  en_preparacion_delivery: "Marcar en reparto",
  listo_retiro:           "Marcar entregado",
  en_reparto:             "Marcar entregado",
};

const SIGUIENTE_ESTADO: Record<string, string> = {
  confirmado:             "en_preparacion",
  pagado:                 "en_preparacion",
  en_preparacion_retiro:  "listo_retiro",
  en_preparacion_delivery: "en_reparto",
  listo_retiro:           "entregado",
  en_reparto:             "entregado",
};

export function PedidoOnlineAcciones({
  pedidoId, estado, tipoEntrega, tieneRepartidor, repartidores, miId = null, medioPago, puedeConfirmarPago, tieneVenta,
}: {
  pedidoId:           string;
  estado:             string;
  tipoEntrega:        string;
  tieneRepartidor:    boolean;
  repartidores:       { id: string; nombre: string }[];
  miId?:              string | null; // quien mira puede llevar envíos (vendedor/encargado)
  medioPago:          string | null;
  puedeConfirmarPago: boolean;
  tieneVenta:         boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const clave = estado === "en_preparacion" ? `en_preparacion_${tipoEntrega === "delivery" ? "delivery" : "retiro"}` : estado;
  const siguienteEstado = SIGUIENTE_ESTADO[clave];
  const siguienteLabel = SIGUIENTE_LABEL[clave];
  const bloqueadoSinRepartidor = estado === "en_preparacion" && tipoEntrega === "delivery" && !tieneRepartidor;
  const esperandoPagoMP = estado === "pendiente_pago" && medioPago === "mercadopago_link";
  const cancelable = !tieneVenta && !["entregado", "cancelado", "expirado", "carrito"].includes(estado);
  // Ya cobrado (tiene venta): no se cancela a secas, se anula el pedido y su venta, con motivo.
  const anulable = tieneVenta && !["cancelado", "expirado", "carrito"].includes(estado);

  function ejecutar(fn: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
    });
  }

  // La acción principal es un botón grande y de color (antes era un texto chico): es lo que
  // el cajero tiene que tocar. Lo secundario (reasignar, cancelar) queda chico.
  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {tipoEntrega === "delivery" && !tieneRepartidor && miId && ["confirmado", "pagado", "en_preparacion"].includes(estado) && (
          <button
            type="button"
            disabled={pending}
            onClick={() => ejecutar(() => asignarRepartidor(pedidoId, miId))}
            className="h-10 whitespace-nowrap rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            {pending ? "Guardando…" : "Yo lo llevo"}
          </button>
        )}
        {tipoEntrega === "delivery" && repartidores.length > 0 && ["confirmado", "pagado", "en_preparacion"].includes(estado) && (
          <select
            defaultValue=""
            disabled={pending}
            onChange={(e) => e.target.value && ejecutar(() => asignarRepartidor(pedidoId, e.target.value))}
            className="h-10 rounded-lg border border-neutral-300 bg-white px-2 text-sm disabled:opacity-40"
          >
            <option value="">{tieneRepartidor ? "Reasignar repartidor…" : "Asignar repartidor…"}</option>
            {repartidores.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        )}
        {esperandoPagoMP && puedeConfirmarPago && (
          <button
            type="button"
            disabled={pending}
            onClick={() => ejecutar(() => confirmarPagoRecibido(pedidoId))}
            className="h-10 whitespace-nowrap rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            {pending ? "Guardando…" : "Confirmar pago recibido"}
          </button>
        )}
        {siguienteLabel && (
          <button
            type="button"
            disabled={pending || bloqueadoSinRepartidor}
            onClick={() => ejecutar(() => avanzarEstadoPedido(pedidoId, siguienteEstado))}
            title={bloqueadoSinRepartidor ? "Asigná un repartidor primero" : undefined}
            className="h-10 whitespace-nowrap rounded-lg bg-tierra-700 px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            {pending ? "Guardando…" : siguienteLabel}
          </button>
        )}
      </div>
      {cancelable && (
        <button
          type="button"
          disabled={pending}
          onClick={() => { if (confirm("¿Cancelar este pedido?")) ejecutar(() => cancelarPedido(pedidoId)); }}
          className="text-xs text-neutral-400 hover:text-red-600 hover:underline disabled:opacity-40"
        >
          Cancelar pedido
        </button>
      )}
      {anulable && !anulando && (
        <button type="button" disabled={pending} onClick={() => setAnulando(true)} className="text-xs text-neutral-400 hover:text-red-600 hover:underline disabled:opacity-40">
          Anular pedido (ya cobrado)
        </button>
      )}
      {anulable && anulando && (
        <div className="w-full max-w-[260px] space-y-1.5 rounded-lg border border-red-200 bg-red-50 p-2.5">
          <p className="text-[11.5px] leading-snug text-red-900">Se anula el pedido y su venta (queda en el Historial). Si el cliente pagó de verdad por Mercado Pago, la plata hay que devolverla desde Mercado Pago (acá no se mueve).</p>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={120} placeholder="Motivo (obligatorio)" className="h-9 w-full rounded-md border border-red-200 bg-white px-2 text-sm" />
          <div className="flex gap-2">
            <button type="button" disabled={pending || motivo.trim().length < 3} onClick={() => ejecutar(() => anularPedidoConVenta(pedidoId, motivo))} className="h-9 flex-1 rounded-md bg-red-600 px-3 text-sm font-semibold text-white disabled:opacity-40">
              {pending ? "Anulando…" : "Confirmar anulación"}
            </button>
            <button type="button" disabled={pending} onClick={() => { setAnulando(false); setMotivo(""); }} className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-600">No</button>
          </div>
        </div>
      )}
      {error && <p className="max-w-[240px] text-right text-xs text-danger">{error}</p>}
    </div>
  );
}
