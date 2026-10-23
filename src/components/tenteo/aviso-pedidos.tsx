"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { consultarPedidosPorAtender, detallePedidosParaAviso } from "@/app/(tenteo)/tenteo/pedidos/actions";
import { RUTA_TENTEO_PEDIDOS } from "@/lib/auth/acceso";
import { decidirTrasFalla, idsNoAvisados, marcarAvisados, podarAvisados, type Avisados, type PedidoAviso } from "@/lib/pedidos/aviso";
import { DialogoPedidosNuevos } from "./dialogo-pedidos-nuevos";

// Aviso de pedido nuevo, montado en las dos zonas del personal (kiosco y Tenteo): el
// cajero suele estar en la venta rápida, no mirando la lista de pedidos.
//
// Cada 30 s pregunta qué pedidos esperan al local (solo ids, una consulta). Si hay
// alguno que todavía no mostró, pide el detalle y abre un cuadro que interrumpe, con
// lo que pidió el cliente, y suena (se repite hasta que se aprieta "Entendido").
// También deja el número en el título de la pestaña y en el menú de Tenteo, y
// recarga la lista si está abierta. La primera respuesta no es una "línea de base":
// lo que ya estaba esperando también se muestra, porque nadie lo atendió.

const INTERVALO_MS = 30_000;
const REPETIR_SONIDO_MS = 20_000;
const CLAVE_AVISADOS = "tenteo:pedidos-avisados";
const CLAVE_RECARGA = "tenteo:aviso-recarga"; // cuándo se recargó sola por última vez (sessionStorage)
const REINTENTO_RAPIDO_MS = 5_000;

const Contexto = createContext(0);

// Cantidad de pedidos por atender (para el número del menú).
export function usePedidosPorAtender(): number {
  return useContext(Contexto);
}

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
    // Tres notas seguidas: se distingue de cualquier otro sonido del navegador.
    [660, 880, 660].forEach((frecuencia, i) => {
      const osc = ctx.createOscillator();
      const ganancia = ctx.createGain();
      const inicio = ctx.currentTime + i * 0.22;
      osc.frequency.value = frecuencia;
      ganancia.gain.setValueAtTime(0.25, inicio);
      ganancia.gain.exponentialRampToValueAtTime(0.001, inicio + 0.2);
      osc.connect(ganancia).connect(ctx.destination);
      osc.start(inicio);
      osc.stop(inicio + 0.2);
    });
  };
}

// localStorage puede no estar (modo privado, datos bloqueados): sin él el aviso igual
// funciona, solo que reaparece al recargar.
function leerAvisados(): Avisados {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE_AVISADOS) ?? "{}");
    return crudo && typeof crudo === "object" && !Array.isArray(crudo) ? crudo : {};
  } catch { return {}; }
}
function guardarAvisados(avisados: Avisados) {
  try { localStorage.setItem(CLAVE_AVISADOS, JSON.stringify(avisados)); } catch { /* sin almacenamiento */ }
}

export function AvisoPedidos({ activo, children }: { activo: boolean; children: React.ReactNode }) {
  const [cantidad, setCantidad] = useState(0);
  const [nuevos, setNuevos] = useState<PedidoAviso[]>([]);
  const [sinConexion, setSinConexion] = useState(false);
  const fallas = useRef(0);
  const ultimaCantidad = useRef<number | null>(null);
  const yaPedidos = useRef<Set<string>>(new Set());
  const pathname = usePathname();
  const router = useRouter();
  const bip = useBip();
  const enPedidos = pathname.startsWith(RUTA_TENTEO_PEDIDOS);

  // Refs para que el intervalo vea siempre lo último sin reiniciarse.
  const alCambiar = useRef({ bip, router, enPedidos });
  useEffect(() => { alCambiar.current = { bip, router, enPedidos }; });

  useEffect(() => {
    if (!activo) return;
    let cancelado = false;

    let reintento: ReturnType<typeof setTimeout> | undefined;

    async function consultar() {
      try {
        const { cantidad: n, ids } = await consultarPedidosPorAtender();
        if (cancelado) return;
        fallas.current = 0;
        setSinConexion(false);
        const { bip, router, enPedidos } = alCambiar.current;

        // La lista abierta se actualiza sola cuando cambia la cantidad.
        if (ultimaCantidad.current !== null && n !== ultimaCantidad.current && enPedidos) router.refresh();
        ultimaCantidad.current = n;
        setCantidad(n);

        const avisados = podarAvisados(leerAvisados(), Date.now());
        const pendientes = idsNoAvisados(ids, avisados);
        if (pendientes.length === 0) {
          yaPedidos.current = new Set();
          setNuevos([]); // también cierra el cuadro si lo atendieron en otra pestaña
          return;
        }
        if (!pendientes.some((id) => !yaPedidos.current.has(id))) return; // nada nuevo desde el último detalle

        const detalle = await detallePedidosParaAviso(pendientes);
        if (cancelado) return;
        yaPedidos.current = new Set(pendientes);
        setNuevos(detalle);
        if (detalle.length > 0) bip();
      } catch {
        // Sin red, sesión vencida o una pestaña vieja tras un despliegue. Nunca queda en silencio: se reintenta
        // enseguida, a la segunda falla se avisa en pantalla y, si sigue, la página se recarga sola (con tope).
        if (cancelado) return;
        fallas.current += 1;
        let ultimaRecarga: number | null = null;
        try { const g = sessionStorage.getItem(CLAVE_RECARGA); ultimaRecarga = g ? Number(g) : null; } catch { /* sin almacenamiento */ }
        const { mostrarAviso, recargar } = decidirTrasFalla(fallas.current, Number.isFinite(ultimaRecarga) ? ultimaRecarga : null, Date.now());
        if (mostrarAviso) setSinConexion(true);
        if (recargar) {
          try { sessionStorage.setItem(CLAVE_RECARGA, String(Date.now())); } catch { /* sin almacenamiento */ }
          window.location.reload();
          return;
        }
        clearTimeout(reintento);
        reintento = setTimeout(() => void consultar(), REINTENTO_RAPIDO_MS);
      }
    }

    // Al volver a la pestaña (o recuperar internet) se revisa ya, sin esperar al próximo ciclo.
    const alVolver = () => { if (document.visibilityState === "visible") void consultar(); };
    void consultar();
    const timer = setInterval(consultar, INTERVALO_MS);
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("online", alVolver);
    return () => {
      cancelado = true;
      clearInterval(timer);
      clearTimeout(reintento);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("online", alVolver);
    };
  }, [activo]);

  // Mientras el cuadro esté abierto, el sonido se repite (hasta que alguien lo atienda).
  const hayAviso = nuevos.length > 0;
  useEffect(() => {
    if (!hayAviso) return;
    const timer = setInterval(() => alCambiar.current.bip(), REPETIR_SONIDO_MS);
    return () => clearInterval(timer);
  }, [hayAviso]);

  // "(2) Pedidos online": se ve aunque la pestaña esté en segundo plano.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = activo && cantidad > 0 ? `(${cantidad}) ${base}` : base;
    return () => { document.title = base; };
  }, [activo, cantidad, pathname]);

  function entendido() {
    guardarAvisados(marcarAvisados(leerAvisados(), nuevos.map((p) => p.id), Date.now()));
    setNuevos([]);
  }

  function ver() {
    entendido();
    if (enPedidos) router.refresh();
    else router.push(RUTA_TENTEO_PEDIDOS);
  }

  return (
    <Contexto.Provider value={activo ? cantidad : 0}>
      {children}
      {activo && sinConexion && (
        <div role="alert" className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg">
          <span>No podemos revisar si llegaron pedidos nuevos.</span>
          <button type="button" onClick={() => window.location.reload()} className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white">Recargar</button>
        </div>
      )}
      {activo && hayAviso && (
        <DialogoPedidosNuevos pedidos={nuevos} enPedidos={enPedidos} onEntendido={entendido} onVer={ver} />
      )}
    </Contexto.Provider>
  );
}
