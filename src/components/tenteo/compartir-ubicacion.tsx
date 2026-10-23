"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dejarDeCompartirUbicacion, enviarPosicionRepartidor } from "@/lib/pedidos/posicion-actions";
import { INTERVALO_ENVIO_MS } from "@/lib/pedidos/posicion-repartidor";

// "Compartir mi ubicación" del repartidor (/tenteo/repartos). Mientras está prendido y haya entregas en
// reparto, manda la posición cada ~12 s para que el cliente vea dónde viene su pedido. Una web NO puede
// seguir en segundo plano: hay que dejar la pestaña abierta (se pide a la pantalla que no se apague con la
// Wake Lock API, si el navegador la tiene). Se apaga solo cuando no quedan entregas en reparto.
//
// Dentro de la app Android "Angiru Reparto" (app-repartidor/, un WebView de Capacitor que carga esta misma web)
// sí se puede seguir con la pantalla apagada: se usa el plugin nativo BackgroundGeolocation (servicio en primer
// plano con notificación fija) en lugar de navigator.geolocation. El plugin se toma del puente global
// window.Capacitor (lo inyecta la app); no se importa ningún paquete de Capacitor en la web. Cada punto se manda
// con la misma Server Action y el mismo intervalo (el plugin entrega ~1 punto por segundo; acá se limita).

type Estado = "apagado" | "pidiendo" | "compartiendo" | "denegado" | "sin_gps";

type Punto = { lat: number; lng: number; precision: number | null };

type PluginUbicacion = {
  addWatcher: (
    opciones: Record<string, unknown>,
    callback: (ubicacion?: { latitude: number; longitude: number; accuracy?: number | null }, error?: { code?: string; message?: string }) => void,
  ) => Promise<string>;
  removeWatcher: (opciones: { id: string }) => Promise<void>;
  openSettings: () => Promise<void>;
};

// El plugin nativo de segundo plano, solo si esto corre dentro de la app Android; si no, null (navegador común).
function pluginNativo(): PluginUbicacion | null {
  try {
    const cap = (window as any).Capacitor;
    if (!cap?.isNativePlatform?.() || !cap.isPluginAvailable?.("BackgroundGeolocation")) return null;
    return (cap.Plugins?.BackgroundGeolocation ?? cap.registerPlugin?.("BackgroundGeolocation")) ?? null;
  } catch { return null; }
}

export function CompartirUbicacion({ pedidoIds }: { pedidoIds: string[] }) {
  const [estado, setEstado] = useState<Estado>("apagado");
  const [ultimoEnvio, setUltimoEnvio] = useState<Date | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  // Dentro de la app Android: en el servidor y en la hidratación vale false (el HTML no cambia), después se resuelve.
  const enApp = useSyncExternalStore(() => () => {}, () => pluginNativo() != null, () => false);

  const idsRef = useRef(pedidoIds);
  idsRef.current = pedidoIds;
  const ultimaPosRef = useRef<Punto | null>(null);
  const nativoRef = useRef<{ plugin: PluginUbicacion; id: string | null } | null>(null);
  const ultimoEnvioMsRef = useRef(0);
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
    ultimoEnvioMsRef.current = Date.now();
    const r = await enviarPosicionRepartidor(idsRef.current, pos.lat, pos.lng, pos.precision);
    if (r.error) setErrorEnvio(r.error);
    else { setErrorEnvio(null); setUltimoEnvio(new Date()); }
  }, []);

  const frenar = useCallback(() => {
    activoRef.current = false;
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    const nativo = nativoRef.current;
    nativoRef.current = null;
    if (nativo?.id) void nativo.plugin.removeWatcher({ id: nativo.id }).catch(() => {}); // apaga el servicio nativo y su notificación
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

  // App Android: el servicio en primer plano entrega puntos aunque la pantalla esté apagada. Se manda uno cada
  // INTERVALO_ENVIO_MS al llegar el punto (sin depender de timers del WebView, que se pueden frenar en segundo plano).
  const prenderNativo = useCallback((plugin: PluginUbicacion) => {
    setEstado("pidiendo");
    activoRef.current = true;
    ultimoEnvioMsRef.current = 0;
    const handle: { plugin: PluginUbicacion; id: string | null } = { plugin, id: null };
    nativoRef.current = handle;
    let primera = true;
    plugin.addWatcher(
      {
        backgroundTitle: "Angiru Reparto",
        backgroundMessage: "Compartiendo tu ubicación con el cliente",
        requestPermissions: true,
        stale: false,
        distanceFilter: 0, // sin filtro: parado también manda (el cliente ve que sigue vivo); el límite lo pone INTERVALO_ENVIO_MS
      },
      (ubicacion, error) => {
        if (!activoRef.current || nativoRef.current !== handle) return;
        if (error) {
          if (error.code === "NOT_AUTHORIZED") { frenar(); setEstado("denegado"); }
          return;
        }
        if (!ubicacion) return;
        ultimaPosRef.current = { lat: ubicacion.latitude, lng: ubicacion.longitude, precision: ubicacion.accuracy ?? null };
        if (primera) { primera = false; setEstado("compartiendo"); void enviar(); return; }
        if (Date.now() - ultimoEnvioMsRef.current >= INTERVALO_ENVIO_MS - 500) void enviar();
      },
    ).then((id) => {
      // Si mientras tanto se apagó, se suelta el watcher que recién arrancó.
      if (nativoRef.current === handle) handle.id = id;
      else void plugin.removeWatcher({ id }).catch(() => {});
    }).catch(() => {
      if (nativoRef.current === handle) { frenar(); setEstado("denegado"); }
    });
  }, [enviar, frenar]);

  const prender = useCallback(() => {
    const nativo = pluginNativo();
    if (nativo) { prenderNativo(nativo); return; }
    if (!("geolocation" in navigator)) { setEstado("sin_gps"); return; }
    setEstado("pidiendo");
    activoRef.current = true;
    let primera = true;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        ultimaPosRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy };
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
  }, [enviar, frenar, pedirPantallaEncendida, prenderNativo]);

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

      {enApp && !compartiendo && (
        <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">
          <p className="font-medium text-neutral-800">Para que siga enviando con la pantalla apagada</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            <li>Al tocar <strong>Compartir</strong>, aceptá el permiso de ubicación.</li>
            <li>En <strong>Ajustes de la app → Permisos → Ubicación</strong> elegí <strong>&ldquo;Permitir todo el tiempo&rdquo;</strong> y activá <strong>Ubicación precisa</strong>.</li>
            <li>En <strong>Batería</strong> poné la app en <strong>&ldquo;Sin restricciones&rdquo;</strong> (si no, algunos celulares la cierran con la pantalla apagada).</li>
          </ol>
          <button type="button" onClick={() => { void pluginNativo()?.openSettings().catch(() => {}); }}
            className="mt-2 h-8 rounded-lg border border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700">
            Abrir ajustes de la app
          </button>
          <p className="mt-2">Mientras compartís vas a ver una notificación fija que dice &ldquo;Compartiendo tu ubicación con el cliente&rdquo;. Solo se envía tu ubicación mientras tengas entregas en camino.</p>
        </div>
      )}
      {estado === "pidiendo" && <p className="mt-2 text-xs text-neutral-500">Buscando tu ubicación… {enApp ? "aceptá el permiso de ubicación si te lo pide." : "aceptá el permiso del navegador si te lo pide."}</p>}
      {estado === "compartiendo" && enApp && (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          Compartiendo tu ubicación{ultimoEnvio ? ` · enviada ${ultimoEnvio.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}.
          {" "}Podés bloquear el celular o usar otras aplicaciones: sigue enviando hasta que dejes de compartir o entregues el último pedido.
        </p>
      )}
      {estado === "compartiendo" && !enApp && (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          Compartiendo tu ubicación{ultimoEnvio ? ` · enviada ${ultimoEnvio.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}.
          {" "}Dejá esta pestaña abierta y el celular con la pantalla encendida: si cambiás de aplicación o se bloquea, se deja de enviar.
        </p>
      )}
      {estado === "denegado" && (
        <p className="mt-2 text-xs font-medium text-red-600">
          {enApp
            ? "La app no tiene permiso de ubicación. Tocá “Abrir ajustes de la app”, habilitá la ubicación (idealmente “Permitir todo el tiempo”) y probá de nuevo."
            : "El navegador no te dejó usar la ubicación. Habilitala en los permisos del sitio (el candado de la barra de direcciones) y probá de nuevo."}
        </p>
      )}
      {estado === "sin_gps" && <p className="mt-2 text-xs font-medium text-red-600">Este dispositivo o navegador no tiene ubicación.</p>}
      {errorEnvio && estado === "compartiendo" && <p className="mt-1 text-xs text-amber-700">No se pudo enviar la última ubicación ({errorEnvio}). Se reintenta sola.</p>}
    </div>
  );
}
