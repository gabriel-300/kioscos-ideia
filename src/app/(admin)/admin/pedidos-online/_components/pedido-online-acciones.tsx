"use client";

import { useState, useTransition } from "react";
import { avanzarEstadoPedido, asignarRepartidor, confirmarPagoRecibido, cancelarPedido } from "../actions";

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
  pedidoId, estado, tipoEntrega, tieneRepartidor, repartidores, medioPago, puedeConfirmarPago, tieneVenta,
}: {
  pedidoId:           string;
  estado:             string;
  tipoEntrega:        string;
  tieneRepartidor:    boolean;
  repartidores:       { id: string; nombre: string }[];
  medioPago:          string | null;
  puedeConfirmarPago: boolean;
  tieneVenta:         boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const clave = estado === "en_preparacion" ? `en_preparacion_${tipoEntrega === "delivery" ? "delivery" : "retiro"}` : estado;
  const siguienteEstado = SIGUIENTE_ESTADO[clave];
  const siguienteLabel = SIGUIENTE_LABEL[clave];
  const bloqueadoSinRepartidor = estado === "en_preparacion" && tipoEntrega === "delivery" && !tieneRepartidor;
  const esperandoPagoMP = estado === "pendiente_pago" && medioPago === "mercadopago_link";
  const cancelable = !tieneVenta && !["entregado", "cancelado", "expirado", "carrito"].includes(estado);

  function ejecutar(fn: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {tipoEntrega === "delivery" && ["confirmado", "pagado", "en_preparacion"].includes(estado) && (
        <select
          defaultValue=""
          disabled={pending}
          onChange={(e) => e.target.value && ejecutar(() => asignarRepartidor(pedidoId, e.target.value))}
          className="h-8 rounded-lg border border-neutral-300 bg-white px-2 text-xs disabled:opacity-40"
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
          className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-40 whitespace-nowrap"
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
          className="text-xs font-medium text-tierra-700 hover:underline disabled:opacity-40 whitespace-nowrap"
        >
          {pending ? "Guardando…" : siguienteLabel}
        </button>
      )}
      {cancelable && (
        <button
          type="button"
          disabled={pending}
          onClick={() => { if (confirm("¿Cancelar este pedido?")) ejecutar(() => cancelarPedido(pedidoId)); }}
          className="text-[11px] text-neutral-400 hover:text-red-600 hover:underline disabled:opacity-40"
        >
          Cancelar pedido
        </button>
      )}
      {error && <p className="text-[11px] text-danger text-right max-w-[200px]">{error}</p>}
    </div>
  );
}
