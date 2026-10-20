"use client";

import { useEffect, useRef } from "react";
import { etiquetaEntrega, etiquetaPago, pesos, type PedidoAviso } from "@/lib/pedidos/aviso";

// Cuadro que interrumpe a propósito: el cajero está cobrando en la venta rápida y un
// puntito en el menú no alcanza. No se cierra tocando afuera ni con Escape; hay que
// apretar "Entendido". Muestra qué pidió el cliente y cómo paga.

function Tarjeta({ p }: { p: PedidoAviso }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-bold text-neutral-900">
            {p.numero ? `Pedido #${p.numero}` : "Pedido"} · {p.cliente ?? "Sin nombre"}
          </p>
          <p className="text-xs text-neutral-500">
            {[p.telefono, p.sucursal].filter(Boolean).join(" · ")}
          </p>
        </div>
        <p className="shrink-0 text-lg font-bold tabular-nums text-tierra-700">{pesos(p.total)}</p>
      </div>

      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Pidió</p>
      {p.lineas.length === 0 ? (
        <p className="mt-1 text-sm text-neutral-400">No se pudo cargar el detalle: abrí el pedido en la lista.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {p.lineas.map((l, i) => (
            <li key={i} className="text-[15px] font-medium text-neutral-900">
              {l.titulo}
              {l.componentes.length > 0 && (
                <span className="block text-xs font-normal text-neutral-500">{l.componentes.join(" · ")}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {p.notas && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
          Aclaración del cliente: “{p.notas}”
        </p>
      )}

      <dl className="mt-3 space-y-1 border-t border-neutral-100 pt-3 text-sm text-neutral-700">
        <div>
          <dt className="sr-only">Entrega</dt>
          <dd className="font-medium">{etiquetaEntrega(p)}</dd>
          {p.delivery && p.direccion && (
            <dd className="text-xs text-neutral-500">
              {p.direccion}{p.referencia ? ` (${p.referencia})` : ""}
            </dd>
          )}
          {p.delivery && p.mapa && (
            <dd>
              <a href={p.mapa} target="_blank" rel="noopener noreferrer" style={{ color: "#1d4ed8" }} className="text-xs font-semibold underline">📍 Abrir en el mapa</a>
            </dd>
          )}
        </div>
        <div>
          <dt className="sr-only">Pago</dt>
          <dd>{etiquetaPago(p)}</dd>
        </div>
        {p.descuento > 0 && <div className="text-xs text-emerald-700">Incluye descuento de cliente registrado: −{pesos(p.descuento)}</div>}
      </dl>
    </section>
  );
}

export function DialogoPedidosNuevos({ pedidos, enPedidos, onEntendido, onVer }: {
  pedidos:    PedidoAviso[];
  enPedidos:  boolean; // ya está en la lista de pedidos: no hace falta el botón "Ver pedidos"
  onEntendido: () => void;
  onVer:      () => void;
}) {
  const entendido = useRef<HTMLButtonElement>(null);

  // El foco en "Entendido" para que Enter lo cierre, y el fondo sin scroll mientras está abierto.
  useEffect(() => {
    entendido.current?.focus();
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = antes; };
  }, []);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="aviso-pedidos-titulo"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-3"
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-neutral-50 shadow-2xl">
        <div className="bg-amber-500 px-5 py-3 text-white">
          <h2 id="aviso-pedidos-titulo" className="text-lg font-bold">
            {pedidos.length === 1 ? "¡Entró un pedido online!" : `¡Entraron ${pedidos.length} pedidos online!`}
          </h2>
          <p className="text-xs text-amber-50">Revisá qué pidió el cliente y empezá a prepararlo.</p>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          {pedidos.map((p) => <Tarjeta key={p.id} p={p} />)}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-200 bg-white p-3">
          {!enPedidos && (
            <button type="button" onClick={onVer} className="h-11 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-800">
              Ver pedidos
            </button>
          )}
          <button ref={entendido} type="button" onClick={onEntendido} className="h-11 rounded-lg bg-tierra-700 px-6 text-sm font-bold text-white">
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
