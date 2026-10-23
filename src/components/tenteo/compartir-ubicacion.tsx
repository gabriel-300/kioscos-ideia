"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { dejarDeCompartirUbicacion, enviarPosicionRepartidor } from "@/lib/pedidos/posicion-actions";
import { INTERVALO_ENVIO_MS } from "@/lib/pedidos/posicion-repartidor";

// "Compartir mi ubicación" del repartidor (/tenteo/repartos). Mientras está prendido y haya entregas en
// reparto, manda la posición cada ~12 s para que el cliente vea dónde viene su pedido. Una web NO puede
// seguir en segundo plano: hay que dejar la pestaña abierta (se pide a la pantalla que no se apague con la
// Wake Lock API, si el navegador la tiene). Se apaga solo cuando no quedan entregas en reparto.

type Estado = "apagado" | "pidiendo" | "compartiendo" | "denegado" | "sin_gps";

export function CompartirUbicacion({ pedidoIds }: { pedidoIds: string[] }) {
  const [estado, setEstado] = useState<Estado>("apagado");
  const [ultimoEnvio, setUltimoEnvio] = useState<Date | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  const idsRef = useRef(pedidoIds);
  idsRef.current = pedidoIds;
  const ultimaPosRef = useRef<GeolocationPosition | null>(null);
  const watchRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const activoRef = useRef(false);

  const pedirPantallaEncendida = useCallback(async () => {
    try {
      const wl = (navigator as any).wakeLock;
      if (wl?.request && !lockRef.current) lockRef.current = await wl.request("screen");
      lockRef.current && ((lockRef.current as any).onrelease = () => { lockRef.current = null; });
    } catch { /* no disponible o negado: sigue funcionando, solo que la pantalla se puede apagar */ }
  }, []);

  const enviar = useCallback(async () => {
    const pos = ultimaPosRef.current;
    if (!pos || idsRef.current.length === 0) return;
    const r = await enviarPosicionRepartidor(idsRef.current, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
    if (r.error) setErrorEnvio(r.error);
    else { setErrorEnvio(null); setUltimoEnvio(new Date()); }
  }, []);

  const frenar = useCallback(() => {
    activoRef.current = false;
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    ultimaPosRef.current = null;
    void lockRef.current?.release().catch(() => {});
    lockRef.current = null;
  }, []);

  const apagar = useCallback(async () => {
    frenar();
    setEstado("apagado");
    setUltimoEnvio(null);
    setErrorEnvio(null);
    await dejarDeCompartirUbicacion().catch(() => {});
  }, [frenar]);

  const prender = useCallback(() => {
    if (!("geolocation" in navigator)) { setEstado("sin_gps"); return; }
    setEstado("pidiendo");
    activoRef.current = true;
    let primera = true;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        ultimaPosRef.current = pos;
        if (primera) { primera = false; setEstado("compartiendo"); void enviar(); } // la primera se manda enseguida
      },
      (err) => {
        // 1 = permiso denegado; el resto (señal, tiempo) son pasajeros: se sigue intentando.
        if (err.code === 1) { frenar(); setEstado("denegado"); }
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    timerRef.current = setInterval(() => { void enviar(); }, INTERVALO_ENVIO_MS);
    void pedirPantallaEncendida();
  }, [enviar, frenar, pedirPantallaEncendida]);

  // Si se entregaron todos los pedidos, deja de compartir solo (y borra la posición).
  useEffect(() => {
    if (pedidoIds.length === 0 && activoRef.current) void apagar();
  }, [pedidoIds.length, apagar]);

  // El sistema suelta la pantalla encendida al cambiar de pestaña: se vuelve a pedir al volver.
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === "visible" && activoRef.current) void pedirPantallaEncendida(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [pedirPantallaEncendida]);

  // Al salir de la pantalla se corta el GPS (la posición vieja queda marcada como vieja y el servidor la borra al entregar).
  useEffect(() => () => { if (activoRef.current) frenar(); }, [frenar]);

  if (pedidoIds.length === 0 && estado === "apagado") return null;

  const compartiendo = estado === "compartiendo" || estado === "pidiendo";

  return (
    <div className="mb-5 rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-neutral-900">Compartir mi ubicación con el cliente</p>
          <p className="mt-0.5 text-xs text-neutral-500">
            El cliente ve en un mapa por dónde viene su pedido. Solo se comparte <strong>mientras tengas entregas en camino</strong>: se corta
            sola al entregar y no se guarda ningún recorrido, solo tu último punto. Fuera de las entregas no se te sigue.
          </p>
        </div>
        <button
          type="button"
          onClick={compartiendo ? apagar : prender}
          style={{ color: "#fff" }}
          className={`h-10 shrink-0 rounded-lg px-4 text-sm font-semibold ${compartiendo ? "bg-neutral-600" : "bg-blue-600"}`}
        >
          {compartiendo ? "Dejar de compartir" : "Compartir"}
        </button>
      </div>

      {estado === "pidiendo" && <p className="mt-2 text-xs text-neutral-500">Buscando tu ubicación… aceptá el permiso del navegador si te lo pide.</p>}
      {estado === "compartiendo" && (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          Compartiendo tu ubicación{ultimoEnvio ? ` · enviada ${ultimoEnvio.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}.
          {" "}Dejá esta pestaña abierta y el celular con la pantalla encendida: si cambiás de aplicación o se bloquea, se deja de enviar.
        </p>
      )}
      {estado === "denegado" && (
        <p className="mt-2 text-xs font-medium text-red-600">
          El navegador no te dejó usar la ubicación. Habilitala en los permisos del sitio (el candado de la barra de direcciones) y probá de nuevo.
        </p>
      )}
      {estado === "sin_gps" && <p className="mt-2 text-xs font-medium text-red-600">Este dispositivo o navegador no tiene ubicación.</p>}
      {errorEnvio && estado === "compartiendo" && <p className="mt-1 text-xs text-amber-700">No se pudo enviar la última ubicación ({errorEnvio}). Se reintenta sola.</p>}
    </div>
  );
}
