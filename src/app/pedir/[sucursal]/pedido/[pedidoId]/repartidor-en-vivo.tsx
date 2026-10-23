"use client";

import { useEffect, useState } from "react";
import { consultarPosicionDeMiPedido } from "@/lib/pedidos/posicion-actions";
import { INTERVALO_CONSULTA_MS, textoHace } from "@/lib/pedidos/posicion-repartidor";
import type { PosicionParaCliente } from "@/lib/pedidos/posicion-servidor";
import { MapaReparto } from "@/components/tenteo/mapa-reparto";

// "Tu pedido está en camino" con el mapa del repartidor. Consulta cada ~12 s (solo con la pestaña visible).
// Si el repartidor no compartió su ubicación, o la señal es vieja, avisa con amabilidad y no muestra mapa.
export function RepartidorEnVivo({ sucursalId, pedidoId }: { sucursalId: string; pedidoId: string }) {
  const [pos, setPos] = useState<PosicionParaCliente | null>(null);
  // Segundos de antigüedad al momento de la respuesta + cuándo llegó, para que el "hace X s" siga corriendo entre consultas.
  const [llegoEn, setLlegoEn] = useState(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    let vivo = true;
    const consultar = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await consultarPosicionDeMiPedido(sucursalId, pedidoId);
        if (vivo) { setPos(r); setLlegoEn(Date.now()); }
      } catch { /* sin conexión: se reintenta en la próxima vuelta */ }
    };
    void consultar();
    const t = setInterval(consultar, INTERVALO_CONSULTA_MS);
    const r = setInterval(() => setTick((n) => n + 1), 5_000);
    document.addEventListener("visibilitychange", consultar);
    return () => { vivo = false; clearInterval(t); clearInterval(r); document.removeEventListener("visibilitychange", consultar); };
  }, [sucursalId, pedidoId]);

  if (!pos || pos.estado === "no_aplica") return null;

  const hace = "haceSeg" in pos ? pos.haceSeg + Math.round((Date.now() - llegoEn) / 1000) : 0;

  return (
    <div className="mt-6 rounded-2xl border border-pd-line bg-pd-paper p-3">
      {pos.estado === "vigente" ? (
        <>
          <p className="text-[14.5px] font-bold text-pd-ink-900">
            Tu pedido está en camino <span className="font-normal text-pd-ink-600">· actualizado {textoHace(hace)}</span>
          </p>
          <div className="mt-2">
            <MapaReparto repartidor={pos.repartidor} destino={pos.destino} />
          </div>
          <p className="mt-1.5 text-[12px] text-pd-ink-400">🛵 repartidor · 🏠 tu entrega (aproximada)</p>
        </>
      ) : (
        <p className="text-[14px] text-pd-ink-600">
          {pos.estado === "vieja"
            ? "Tu pedido está en camino. Perdimos la señal del repartidor por un momento; apenas la recuperemos vas a verlo en el mapa."
            : "Tu pedido está en camino. El repartidor todavía no compartió su ubicación."}
        </p>
      )}
    </div>
  );
}
