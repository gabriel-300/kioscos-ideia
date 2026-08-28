"use client";

import { useTransition } from "react";
import { marcarPedidoRealizado } from "../actions";

export function MarcarPedidoButton({ productId, sucursalId }: { productId: string; sucursalId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => { void marcarPedidoRealizado(productId, sucursalId); })}
      className="text-xs font-medium text-tierra-700 hover:underline disabled:opacity-40 whitespace-nowrap"
    >
      {pending ? "Marcando…" : "Marcar pedido"}
    </button>
  );
}
