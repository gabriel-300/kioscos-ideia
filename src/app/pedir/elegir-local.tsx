"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LocalParaPedir } from "@/lib/pedidos/locales";
import { formatearDistancia, ordenarPorCercania, type Punto } from "@/lib/geo";

// PRIVACIDAD: la ubicación del cliente vive solo en el estado de este componente.
// No se envía al servidor, no se guarda (ni en localStorage), no va en la URL, no se
// loguea ni se pone en cookies. La distancia se calcula acá, en su celular.
// Lo único que se recuerda es QUÉ LOCAL eligió (id y fecha), nunca dónde estaba.
//
// El punto de origen es un Punto cualquiera: hoy sale del GPS; más adelante puede
// salir de una dirección escrita sin cambiar el orden ni las tarjetas.

const CLAVE_ULTIMO_LOCAL = "pedir:ultimo-local";
const VIGENCIA_ULTIMO_LOCAL_MS = 90 * 24 * 60 * 60 * 1000;
const TIMEOUT_UBICACION_MS = 10_000;

// Navegadores embebidos (WhatsApp, Instagram, Facebook…) suelen bloquear la geolocalización.
const NAVEGADOR_EMBEBIDO = /FBAN|FBAV|Instagram|WhatsApp|Line\/|MicroMessenger|; wv\)/i;

const MENSAJES = {
  denegado: "No pudimos acceder a tu ubicación. Si querés ordenar por cercanía, habilitá el permiso de ubicación del navegador. Mientras tanto, elegí el local de la lista.",
  noDisponible: "No pudimos saber dónde estás en este momento. Elegí el local de la lista.",
  timeout: "Tardó demasiado en encontrar tu ubicación. Probá de nuevo o elegí el local de la lista.",
  embebido: "Este navegador no deja usar tu ubicación. Abrí esta página en Chrome o Safari para ordenar por cercanía, o elegí el local de la lista.",
} as const;

function leerUltimoLocal(): string | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE_ULTIMO_LOCAL);
    if (!crudo) return null;
    const { id, fecha } = JSON.parse(crudo) as { id?: unknown; fecha?: unknown };
    if (typeof id !== "string" || typeof fecha !== "number") return null;
    return Date.now() - fecha <= VIGENCIA_ULTIMO_LOCAL_MS ? id : null;
  } catch {
    return null;
  }
}

function recordarLocal(id: string) {
  try {
    window.localStorage.setItem(CLAVE_ULTIMO_LOCAL, JSON.stringify({ id, fecha: Date.now() }));
  } catch {
    // modo privado o almacenamiento bloqueado: simplemente no se recuerda
  }
}

type Estado = { tipo: "inicial" } | { tipo: "buscando" } | { tipo: "listo" } | { tipo: "error"; mensaje: string };

export function ElegirLocal({ locales }: { locales: LocalParaPedir[] }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "inicial" });
  const [punto, setPunto] = useState<Punto | null>(null);
  const [ultimoId, setUltimoId] = useState<string | null>(null);

  // Se lee después de montar: en el servidor no hay localStorage.
  useEffect(() => { setUltimoId(leerUltimoLocal()); }, []);

  const hayCoordenadas = locales.some((l) => l.latitud !== null && l.longitud !== null);
  const filas = useMemo(
    () => (punto ? ordenarPorCercania(locales, punto) : locales.map((local) => ({ local, km: null as number | null }))),
    [locales, punto],
  );
  const recordado = ultimoId ? locales.find((l) => l.id === ultimoId) ?? null : null;

  function usarMiUbicacion() {
    const embebido = NAVEGADOR_EMBEBIDO.test(navigator.userAgent);
    if (!navigator.geolocation) {
      setEstado({ tipo: "error", mensaje: embebido ? MENSAJES.embebido : MENSAJES.noDisponible });
      return;
    }
    setEstado({ tipo: "buscando" });
    try {
      navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPunto({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setEstado({ tipo: "listo" });
      },
      (err) => {
        // Si el permiso falla dentro de un navegador embebido, el motivo real es el navegador.
        const mensaje = err.code === err.PERMISSION_DENIED ? (embebido ? MENSAJES.embebido : MENSAJES.denegado)
          : err.code === err.TIMEOUT ? MENSAJES.timeout
          : MENSAJES.noDisponible;
        setEstado({ tipo: "error", mensaje });
      },
      { timeout: TIMEOUT_UBICACION_MS, maximumAge: 60_000 }, // sin enableHighAccuracy: alcanza con aproximada y ahorra batería
      );
    } catch {
      // algunos navegadores embebidos lanzan en vez de avisar por el callback de error
      setEstado({ tipo: "error", mensaje: embebido ? MENSAJES.embebido : MENSAJES.noDisponible });
    }
  }

  return (
    <>
      {recordado && (
        <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-pd-tint-line bg-pd-tint p-3.5" data-testid="atajo-ultimo-local">
          <div className="min-w-0">
            <p className="text-[11.5px] font-bold uppercase tracking-wide text-pd-ember">Tu local</p>
            <p className="pd-display truncate text-[17px] font-bold leading-tight">{recordado.nombre}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button type="button" onClick={() => setUltimoId(null)} className="text-[13px] font-semibold text-pd-ink-600 underline">
              cambiar
            </button>
            <Link href={`/pedir/${recordado.id}`} onClick={() => recordarLocal(recordado.id)} className="pd-display rounded-full bg-pd-ember px-4 py-2 text-[13.5px] font-bold text-white active:bg-pd-ember-dark">
              Pedir ahí
            </Link>
          </div>
        </div>
      )}

      {hayCoordenadas && locales.length > 0 && (
        <div className="mt-5">
          <div className="flex items-center gap-3 rounded-2xl border border-pd-line bg-white p-3">
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-pd-tint text-pd-ember">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
            </span>
            <p className="min-w-0 flex-1 text-[14px] leading-tight">
              <span className="block font-bold">{punto ? "Ordenado por cercanía" : "¿Cuál te queda cerca?"}</span>
              <span className="block text-pd-ink-600">{punto ? "Según tu ubicación actual" : "Mostrá primero el más cercano"}</span>
            </p>
            <button
              type="button"
              onClick={usarMiUbicacion}
              disabled={estado.tipo === "buscando"}
              className="pd-display shrink-0 rounded-full bg-pd-ember px-4 py-2.5 text-[13.5px] font-bold text-white active:bg-pd-ember-dark disabled:opacity-60"
            >
              {estado.tipo === "buscando" ? "Buscando…" : punto ? "Actualizar" : "Usar mi ubicación"}
            </button>
          </div>
          <p className="mt-2 px-1 text-[12px] leading-snug text-pd-ink-400">
            Tu ubicación no sale de tu celular: no la enviamos ni la guardamos.
          </p>
          {estado.tipo === "error" && (
            <p role="status" className="mt-3 rounded-xl bg-pd-warm px-4 py-3 text-[13.5px] leading-snug text-pd-ink-600">{estado.mensaje}</p>
          )}
        </div>
      )}

      {locales.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-pd-line bg-white p-5 text-[14.5px] text-pd-ink-600">
          Por ahora no hay locales recibiendo pedidos online. Volvé a probar más tarde.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {filas.map(({ local: l, km }, i) => {
            const masCerca = !!punto && i === 0 && km !== null;
            return (
              <li key={l.id}>
                <Link
                  href={`/pedir/${l.id}`}
                  onClick={() => recordarLocal(l.id)}
                  className={`flex items-center gap-4 rounded-2xl border bg-white p-4 transition-colors active:bg-pd-tint ${masCerca ? "border-pd-ember" : "border-pd-line"} ${l.abierto ? "" : "opacity-75"}`}
                >
                  <span aria-hidden className="pd-display grid size-16 shrink-0 place-items-center rounded-2xl bg-pd-tint text-[28px] font-extrabold text-pd-ember">
                    {l.nombre.trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    {masCerca && <p className="mb-0.5 text-[11.5px] font-bold uppercase tracking-wide text-pd-ember">Más cerca de vos</p>}
                    <p className="pd-display truncate text-[19px] font-bold leading-tight">{l.nombre}</p>
                    {(l.direccion || l.localidad) && (
                      <p className="mt-0.5 truncate text-[13px] text-pd-ink-600">{[l.direccion, l.localidad].filter(Boolean).join(", ")}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-pd-ink-600">
                      <span className={`rounded-full px-2 py-0.5 font-bold ${l.abierto ? "bg-pd-success/10 text-pd-success" : "bg-pd-warm text-pd-ink-600"}`}>
                        {l.abierto ? "Abierto" : l.proximaApertura ? `Cerrado · Abre ${l.proximaApertura}` : "Cerrado"}
                      </span>
                      {km !== null && <span className="font-semibold text-pd-ink-900">a {formatearDistancia(km)}</span>}
                      <span>{[l.conRetiro && "Retiro", l.conEnvio && "Envío"].filter(Boolean).join(" · ")}</span>
                    </div>
                  </div>
                  <span aria-hidden className="shrink-0 text-pd-ink-300">
                    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
