"use client";

import { useState, useTransition } from "react";
import { calificarMiPedido } from "./calificacion-actions";
import type { Calificacion } from "@/lib/pedidos/calificacion";

// Agradecimiento y calificación (estrellas + comentario opcional) cuando el pedido ya se entregó. Si el cliente
// ya había calificado, muestra lo que dejó.

const TEXTO_ESTRELLAS = ["", "Muy malo", "Malo", "Regular", "Bueno", "Excelente"];

function Estrellas({ valor, onElegir, deshabilitado }: { valor: number; onElegir?: (n: number) => void; deshabilitado?: boolean }) {
  return (
    <div className="flex justify-center gap-1.5" role={onElegir ? "radiogroup" : undefined} aria-label="Calificación">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onElegir || deshabilitado}
          onClick={() => onElegir?.(n)}
          role={onElegir ? "radio" : undefined}
          aria-checked={onElegir ? valor === n : undefined}
          aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
          className="p-0.5 text-[38px] leading-none transition-transform active:scale-90 disabled:cursor-default"
          style={{ color: n <= valor ? "#F5A524" : "#D9D2C8" }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function CalificarPedido({ sucursalId, pedidoId, nombre, inicial }: { sucursalId: string; pedidoId: string; nombre: string | null; inicial: Calificacion | null }) {
  const [enviada, setEnviada] = useState<Calificacion | null>(inicial);
  const [estrellas, setEstrellas] = useState(0);
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function enviar() {
    if (estrellas === 0) { setError("Elegí de 1 a 5 estrellas"); return; }
    setError(null);
    startTransition(async () => {
      const res = await calificarMiPedido(sucursalId, pedidoId, estrellas, comentario);
      if (res.error) { setError(res.error); return; }
      setEnviada({ estrellas, comentario: comentario.trim() || null });
    });
  }

  return (
    <section className="rounded-3xl border border-pd-line bg-white p-5 text-center md:p-7" aria-label="Calificá tu pedido">
      <p className="pd-display text-[24px] font-extrabold leading-tight">¡Gracias{nombre ? `, ${nombre}` : ""}!</p>
      <p className="mt-1.5 text-[14.5px] text-pd-ink-600">Esperamos que lo disfrutes. Tu opinión nos ayuda a mejorar.</p>

      {enviada ? (
        <div className="mt-5">
          <Estrellas valor={enviada.estrellas} />
          <p className="mt-2 text-[14px] font-semibold text-pd-ink-900">Tu calificación: {TEXTO_ESTRELLAS[enviada.estrellas]}</p>
          {enviada.comentario && <p className="mx-auto mt-2 max-w-[460px] whitespace-pre-line text-[14px] italic text-pd-ink-600">“{enviada.comentario}”</p>}
          <p className="mt-3 text-[13px] text-pd-success">Recibimos tu calificación. ¡Gracias por tomarte el tiempo!</p>
        </div>
      ) : (
        <div className="mt-5">
          <p className="mb-1 text-[13.5px] font-semibold text-pd-ink-900">¿Cómo fue el servicio?</p>
          <Estrellas valor={estrellas} onElegir={(n) => { setEstrellas(n); setError(null); }} deshabilitado={pending} />
          <p className="mt-1 h-5 text-[13px] font-semibold text-pd-ink-600">{TEXTO_ESTRELLAS[estrellas]}</p>
          <textarea
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Contanos más (opcional): la atención, el pedido, el envío…"
            className="mx-auto mt-2 block w-full max-w-[460px] rounded-2xl border border-pd-line-strong bg-white px-4 py-3 text-left text-[14.5px]"
          />
          {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-pd-ember">{error}</p>}
          <button
            type="button"
            onClick={enviar}
            disabled={pending}
            style={{ color: "#fff" }}
            className="pd-display mt-4 inline-flex h-12 items-center justify-center rounded-2xl bg-pd-ember px-8 text-[15px] font-bold disabled:opacity-60"
          >
            {pending ? "Enviando…" : "Enviar calificación"}
          </button>
        </div>
      )}
    </section>
  );
}
