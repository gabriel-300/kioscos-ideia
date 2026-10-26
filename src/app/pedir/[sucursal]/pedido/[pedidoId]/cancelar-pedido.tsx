"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelarMiPedido } from "./cancelar-actions";

// "Cancelar pedido" del cliente, con confirmación en el mismo lugar (como en Rappi). Solo se muestra mientras el
// local no empezó con el pedido (lo decide la página).
export function CancelarPedido({ sucursalId, pedidoId, numero, pagoPendiente }: { sucursalId: string; pedidoId: string; numero: number | null; pagoPendiente: boolean }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function cancelar() {
    setError(null);
    startTransition(async () => {
      const res = await cancelarMiPedido(sucursalId, pedidoId);
      if (res.error) { setError(res.error); setConfirmando(false); router.refresh(); return; }
      router.refresh();
    });
  }

  return (
    <section className="rounded-3xl border border-pd-line bg-white p-5 md:p-6" aria-label="Cancelar pedido">
      {!confirmando ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] text-pd-ink-600">¿Cambiaste de idea? Podés cancelarlo mientras el local no lo haya empezado.</p>
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            className="pd-display h-11 shrink-0 rounded-full border border-pd-line-strong bg-white px-5 text-[14px] font-bold text-pd-ink-900"
          >
            Cancelar pedido
          </button>
        </div>
      ) : (
        <div>
          <p className="pd-display text-[17px] font-bold">¿Cancelar el pedido{numero ? ` #${numero}` : ""}?</p>
          <p className="mt-1 text-[14px] text-pd-ink-600">
            {pagoPendiente ? "Todavía no pagaste, así que no se te cobra nada. " : "Todavía no se cobró nada. "}No se puede deshacer.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={cancelar}
              style={{ color: "#fff" }}
              className="pd-display h-11 rounded-full bg-pd-ember px-6 text-[14px] font-bold disabled:opacity-60"
            >
              {pending ? "Cancelando…" : "Sí, cancelar pedido"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmando(false)}
              className="pd-display h-11 rounded-full border border-pd-line-strong bg-white px-6 text-[14px] font-bold text-pd-ink-900"
            >
              No, mantenerlo
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-[13px] font-semibold text-pd-ember">{error}</p>}
    </section>
  );
}
