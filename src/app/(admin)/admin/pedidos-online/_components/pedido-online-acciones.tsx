"use client";

import { useState, useTransition } from "react";
import { avanzarEstadoPedido, asignarRepartidor } from "../actions";

const SIGUIENTE_LABEL: Record<string, string> = {
  pagado:        "Marcar en preparación",
  en_preparacion_retiro: "Marcar listo para retirar",
  en_preparacion_delivery: "Marcar en reparto",
  listo_retiro:  "Marcar entregado",
  en_reparto:    "Marcar entregado",
};

const SIGUIENTE_ESTADO: Record<string, string> = {
  pagado:        "en_preparacion",
  en_preparacion_retiro: "listo_retiro",
  en_preparacion_delivery: "en_reparto",
  listo_retiro:  "entregado",
  en_reparto:    "entregado",
};

export function PedidoOnlineAcciones({
  pedidoId, estado, tipoEntrega, tieneRepartidor, repartidores,
}: {
  pedidoId:        string;
  estado:          string;
  tipoEntrega:     string;
  tieneRepartidor: boolean;
  repartidores:    { id: string; nombre: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const clave = estado === "en_preparacion" ? `en_preparacion_${tipoEntrega === "delivery" ? "delivery" : "retiro"}` : estado;
  const siguienteEstado = SIGUIENTE_ESTADO[clave];
  const siguienteLabel = SIGUIENTE_LABEL[clave];
  const bloqueadoSinRepartidor = estado === "en_preparacion" && tipoEntrega === "delivery" && !tieneRepartidor;

  function avanzar() {
    if (!siguienteEstado) return;
    setError(null);
    startTransition(async () => {
      const res = await avanzarEstadoPedido(pedidoId, siguienteEstado);
      if (res.error) setError(res.error);
    });
  }

  function asignar(repartidorId: string) {
    if (!repartidorId) return;
    setError(null);
    startTransition(async () => {
      const res = await asignarRepartidor(pedidoId, repartidorId);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {tipoEntrega === "delivery" && (estado === "pagado" || estado === "en_preparacion") && (
        <select
          defaultValue=""
          disabled={pending}
          onChange={(e) => asignar(e.target.value)}
          className="h-8 rounded-lg border border-neutral-300 bg-white px-2 text-xs disabled:opacity-40"
        >
          <option value="">{tieneRepartidor ? "Reasignar repartidor…" : "Asignar repartidor…"}</option>
          {repartidores.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </select>
      )}
      {siguienteLabel && (
        <button
          type="button"
          disabled={pending || bloqueadoSinRepartidor}
          onClick={avanzar}
          title={bloqueadoSinRepartidor ? "Asigná un repartidor primero" : undefined}
          className="text-xs font-medium text-tierra-700 hover:underline disabled:opacity-40 whitespace-nowrap"
        >
          {pending ? "Guardando…" : siguienteLabel}
        </button>
      )}
      {error && <p className="text-[11px] text-danger text-right max-w-[180px]">{error}</p>}
    </div>
  );
}
