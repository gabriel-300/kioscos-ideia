"use client";

import { useState, useTransition } from "react";
import { avanzarEstadoPedido } from "../../pedidos-online/actions";

export function MarcarEntregadoButton({ pedidoId }: { pedidoId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await avanzarEstadoPedido(pedidoId, "entregado");
            if (res.error) setError(res.error);
          });
        }}
        className="h-8 px-3 rounded-lg bg-tierra-700 text-white text-xs font-semibold disabled:opacity-40"
      >
        {pending ? "Guardando…" : "Marcar entregado"}
      </button>
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}
