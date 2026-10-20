"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { estadoPedidoReciente } from "@/lib/pedidos/seguimiento-actions";
import { leerPedidoReciente, olvidarPedidoReciente, type PedidoReciente } from "@/lib/pedidos/pedido-reciente";

// Franja "Tu pedido #N · estado · Ver" para quien hizo un pedido desde este navegador y volvió
// (cerró la página, abrió el dominio de nuevo). Se apaga sola cuando el pedido termina.

export function PedidoEnCurso({ className = "" }: { className?: string }) {
  const [pedido, setPedido] = useState<(PedidoReciente & { titulo: string }) | null>(null);

  useEffect(() => {
    const guardado = leerPedidoReciente(window.localStorage);
    if (!guardado) return;
    let vigente = true;
    estadoPedidoReciente(guardado.sucursalId, guardado.pedidoId)
      .then((estado) => {
        if (!vigente) return;
        if (!estado || estado.final) { olvidarPedidoReciente(window.localStorage); return; }
        setPedido({ ...guardado, titulo: estado.titulo });
      })
      .catch(() => { /* sin conexión: simplemente no se muestra */ });
    return () => { vigente = false; };
  }, []);

  if (!pedido) return null;
  return (
    <Link
      href={`/pedir/${pedido.sucursalId}/pedido/${pedido.pedidoId}`}
      // Color en línea: la regla global `a { color: inherit }` le gana a las clases text-*.
      style={{ color: "var(--color-pd-ink)" }}
      className={`flex items-center justify-between gap-3 rounded-2xl border border-pd-ember bg-pd-tint px-4 py-3 ${className}`}
      data-testid="pedido-en-curso"
    >
      <span className="min-w-0">
        <span className="block text-[11.5px] font-bold uppercase tracking-wide text-pd-ember">Tu pedido #{pedido.numero}</span>
        <span className="pd-display block text-[16px] font-bold leading-tight">{pedido.titulo}</span>
      </span>
      <span className="pd-display shrink-0 rounded-full bg-pd-ember px-4 py-2 text-[13.5px] font-bold" style={{ color: "#fff" }}>Ver</span>
    </Link>
  );
}
