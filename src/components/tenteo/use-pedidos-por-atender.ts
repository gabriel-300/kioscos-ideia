"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { consultarPedidosPorAtender } from "@/app/(tenteo)/tenteo/pedidos/actions";
import { RUTA_TENTEO_PEDIDOS } from "@/lib/auth/acceso";

// Aviso de pedido nuevo de la zona de Tenteo. Consulta al servidor al cargar y cada 30 s y,
// si sube la cantidad, suena, y si el usuario está en /tenteo/pedidos
// recarga la lista. La primera respuesta es la línea de base: no suena por lo
// que ya estaba esperando.

const INTERVALO_MS = 30_000;
const RUTA_PEDIDOS = RUTA_TENTEO_PEDIDOS;

// Los navegadores solo dejan sonar audio después de un gesto del usuario, así
// que el contexto se crea en el primer clic o toque (en la venta rápida se toca
// todo el tiempo).
function useBip() {
  const contexto = useRef<AudioContext | null>(null);

  useEffect(() => {
    const desbloquear = () => {
      if (contexto.current) return;
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) contexto.current = new Ctx();
    };
    window.addEventListener("pointerdown", desbloquear, { once: true });
    return () => window.removeEventListener("pointerdown", desbloquear);
  }, []);

  return () => {
    const ctx = contexto.current;
    if (!ctx) return;
    void ctx.resume();
    // Dos notas seguidas: se distingue de cualquier otro sonido del navegador.
    [660, 880].forEach((frecuencia, i) => {
      const osc = ctx.createOscillator();
      const ganancia = ctx.createGain();
      const inicio = ctx.currentTime + i * 0.22;
      osc.frequency.value = frecuencia;
      ganancia.gain.setValueAtTime(0.2, inicio);
      ganancia.gain.exponentialRampToValueAtTime(0.001, inicio + 0.2);
      osc.connect(ganancia).connect(ctx.destination);
      osc.start(inicio);
      osc.stop(inicio + 0.2);
    });
  };
}

export function usePedidosPorAtender(activo: boolean): number {
  const [cantidad, setCantidad] = useState(0);
  const anterior = useRef<number | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const bip = useBip();
  const enPedidos = pathname.startsWith(RUTA_PEDIDOS);

  // Refs para que el intervalo vea siempre lo último sin reiniciarse.
  const alCambiar = useRef({ bip, router, enPedidos });
  useEffect(() => { alCambiar.current = { bip, router, enPedidos }; });

  useEffect(() => {
    if (!activo) return;
    let cancelado = false;

    async function consultar() {
      try {
        const n = await consultarPedidosPorAtender();
        if (cancelado || n === anterior.current) return;
        const { bip, router, enPedidos } = alCambiar.current;
        if (anterior.current !== null && n > anterior.current) bip();
        if (anterior.current !== null && enPedidos) router.refresh();
        anterior.current = n;
        setCantidad(n);
      } catch { /* sin red o sesión vencida: se reintenta en el próximo ciclo */ }
    }

    void consultar();
    const timer = setInterval(consultar, INTERVALO_MS);
    return () => { cancelado = true; clearInterval(timer); };
  }, [activo]);

  // "(2) Pedidos online": se ve aunque la pestaña esté en segundo plano.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = cantidad > 0 ? `(${cantidad}) ${base}` : base;
    return () => { document.title = base; };
  }, [cantidad, pathname]);

  return activo ? cantidad : 0;
}
