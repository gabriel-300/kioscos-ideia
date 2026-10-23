"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EstadoChat } from "@/lib/pedidos/chat";

// Chat de un pedido online (migración 124), compartido por las tres pantallas: el seguimiento del cliente
// (estilo "tienda", clases pd-*), la lista de pedidos del local y Mis entregas (estilo "panel").
// No usa websockets: mientras está abierto y la pestaña visible, consulta el hilo cada 8 s con la acción
// del servidor que le pasan (mismo enfoque de polling liviano que ActualizarSolo y el aviso de pedidos).
// Al consultar, lo que escribió el otro lado queda marcado como leído.

const INTERVALO_MS = 8_000;
const MAX_TEXTO = 500;
const ETIQUETA = { cliente: "Cliente", local: "Local", repartidor: "Repartidor" } as const;

type Props = {
  pedidoId: string;
  cargar: (pedidoId: string) => Promise<EstadoChat | { error: string }>;
  enviar: (pedidoId: string, texto: string) => Promise<{ error?: string }>;
  estilo: "tienda" | "panel";
  /** Con `desplegable` el chat arranca cerrado, con un botón y el indicador de mensajes sin leer. */
  desplegable?: boolean;
  sinLeerInicial?: number;
  titulo?: string;
};

const CLASES = {
  tienda: {
    caja: "rounded-3xl border border-pd-line bg-white p-5 md:p-7",
    titulo: "pd-display text-[18px] font-bold text-pd-ink-900",
    lista: "mt-3 flex max-h-[320px] min-h-[96px] flex-col gap-2 overflow-y-auto rounded-2xl bg-pd-paper p-3",
    propio: "self-end rounded-2xl rounded-br-md bg-pd-ember text-white",
    ajeno: "self-start rounded-2xl rounded-bl-md border border-pd-line bg-white text-pd-ink-900",
    meta: "text-[11px] opacity-70",
    vacio: "m-auto text-center text-[13.5px] text-pd-ink-400",
    aviso: "mt-3 text-[13px] text-pd-ink-600",
    error: "mt-2 text-[13px] font-semibold text-red-600",
    form: "mt-3 flex items-end gap-2",
    campo: "min-h-[48px] flex-1 resize-none rounded-2xl border border-pd-line-strong bg-white px-3.5 py-3 text-[16px] text-pd-ink-900 outline-none focus:border-pd-ember",
    boton: "pd-display h-12 shrink-0 rounded-2xl bg-pd-ember px-5 text-[15px] font-bold disabled:opacity-50",
    abrir: "pd-display inline-flex h-11 items-center gap-2 rounded-full border border-pd-line-strong bg-white px-4 text-[14px] font-bold",
    contador: "text-[11px] text-pd-ink-400",
  },
  panel: {
    caja: "border-t border-neutral-100 px-4 py-3",
    titulo: "text-sm font-semibold text-neutral-900",
    lista: "mt-2 flex max-h-[260px] min-h-[72px] flex-col gap-1.5 overflow-y-auto rounded-lg bg-neutral-50 p-2",
    propio: "self-end rounded-xl rounded-br-sm bg-blue-600 text-white",
    ajeno: "self-start rounded-xl rounded-bl-sm border border-neutral-200 bg-white text-neutral-900",
    meta: "text-[10px] opacity-70",
    vacio: "m-auto text-center text-xs text-neutral-400",
    aviso: "mt-2 text-xs text-neutral-500",
    error: "mt-1.5 text-xs font-semibold text-red-600",
    form: "mt-2 flex items-end gap-2",
    campo: "min-h-[44px] flex-1 resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 outline-none focus:border-blue-500",
    boton: "h-11 shrink-0 rounded-lg bg-blue-600 px-4 text-sm font-semibold disabled:opacity-50",
    abrir: "inline-flex h-10 items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50",
    contador: "text-[11px] text-neutral-400",
  },
} as const;

function hora(iso: string) {
  const d = new Date(iso);
  const hoy = new Date();
  const h = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return d.toDateString() === hoy.toDateString() ? h : `${d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })} ${h}`;
}

export function ChatPedido({ pedidoId, cargar, enviar, estilo, desplegable = false, sinLeerInicial = 0, titulo = "Chat del pedido" }: Props) {
  const c = CLASES[estilo];
  const [abierto, setAbierto] = useState(!desplegable);
  const [estado, setEstado] = useState<EstadoChat | null>(null);
  const [sinLeer, setSinLeer] = useState(sinLeerInicial);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const lista = useRef<HTMLDivElement>(null);
  const cantidadPrevia = useRef(0);

  const refrescar = useCallback(async () => {
    try {
      const r = await cargar(pedidoId);
      if ("error" in r) { setError(r.error); return; }
      setEstado(r);
      setSinLeer(0);
    } catch { /* sin red: se reintenta en el próximo ciclo */ }
  }, [cargar, pedidoId]);

  useEffect(() => {
    if (!abierto) return;
    void refrescar();
    const tic = () => { if (document.visibilityState === "visible") void refrescar(); };
    const timer = setInterval(tic, INTERVALO_MS);
    document.addEventListener("visibilitychange", tic);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tic); };
  }, [abierto, refrescar]);

  // Baja al último mensaje solo cuando llega uno nuevo (sin mover la página entera).
  const cantidad = estado?.mensajes.length ?? 0;
  useEffect(() => {
    if (cantidad !== cantidadPrevia.current && lista.current) lista.current.scrollTop = lista.current.scrollHeight;
    cantidadPrevia.current = cantidad;
  }, [cantidad]);

  async function mandar(e: React.FormEvent) {
    e.preventDefault();
    const limpio = texto.trim();
    if (!limpio || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await enviar(pedidoId, limpio);
      if (r.error) setError(r.error);
      else { setTexto(""); await refrescar(); }
    } catch {
      setError("No se pudo enviar, revisá tu conexión e intentá de nuevo");
    } finally {
      setEnviando(false);
    }
  }

  const cuerpo = (
    <>
      <div ref={lista} className={c.lista} aria-live="polite">
        {!estado ? (
          <p className={c.vacio}>{error ?? "Cargando…"}</p>
        ) : estado.mensajes.length === 0 ? (
          <p className={c.vacio}>Todavía no hay mensajes.</p>
        ) : (
          estado.mensajes.map((m) => (
            <div key={m.id} className={`max-w-[85%] px-3 py-2 ${m.propio ? c.propio : c.ajeno}`}>
              <p className={c.meta}>{m.propio ? "Vos" : ETIQUETA[m.autor]} · {hora(m.creado)}</p>
              <p className="whitespace-pre-wrap break-words text-[14.5px] leading-snug">{m.texto}</p>
            </div>
          ))
        )}
      </div>

      {estado && !estado.puedeEscribir ? (
        <p className={c.aviso}>{estado.aviso}</p>
      ) : estado ? (
        <form onSubmit={mandar} className={c.form}>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value.slice(0, MAX_TEXTO))}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
            rows={1}
            maxLength={MAX_TEXTO}
            placeholder="Escribí un mensaje"
            aria-label="Mensaje"
            className={c.campo}
          />
          <button type="submit" disabled={enviando || !texto.trim()} style={{ color: "#fff" }} className={c.boton}>
            {enviando ? "…" : "Enviar"}
          </button>
        </form>
      ) : null}
      {estado && estado.puedeEscribir && texto.length > MAX_TEXTO - 100 && (
        <p className={`${c.contador} mt-1 text-right`}>{texto.length}/{MAX_TEXTO}</p>
      )}
      {estado && error && <p className={c.error}>{error}</p>}
    </>
  );

  if (!desplegable) {
    return (
      <section className={c.caja}>
        <h2 className={c.titulo}>{titulo}</h2>
        {cuerpo}
      </section>
    );
  }

  return (
    <div className={c.caja}>
      <button type="button" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto} className={c.abrir}>
        {abierto ? "Cerrar chat" : "Chat con el cliente"}
        {!abierto && sinLeer > 0 && (
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white" aria-label={`${sinLeer} sin leer`}>{sinLeer}</span>
        )}
      </button>
      {abierto && <div className="mt-1">{cuerpo}</div>}
    </div>
  );
}
