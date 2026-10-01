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
        <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-pd-line bg-pd-tint p-4" data-testid="atajo-ultimo-local">
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-wide text-pd-ink-400">Tu local</p>
            <p className="pd-display truncate text-[17px] font-bold leading-tight">{recordado.nombre}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button type="button" onClick={() => setUltimoId(null)} className="text-[13px] font-semibold text-pd-ink-600 underline">
              cambiar
            </button>
            <Link href={`/pedir/${recordado.id}`} onClick={() => recordarLocal(recordado.id)} className="rounded-full bg-pd-ink-900 px-4 py-2 text-[13.5px] font-bold text-white">
              Pedir ahí
            </Link>
          </div>
        </div>
      )}

      {hayCoordenadas && locales.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={usarMiUbicacion}
            disabled={estado.tipo === "buscando"}
            className="w-full rounded-full border border-pd-line bg-white px-5 py-3 text-[14.5px] font-bold disabled:opacity-60"
          >
            {estado.tipo === "buscando" ? "Buscando tu ubicación…" : punto ? "Actualizar mi ubicación" : "Usar mi ubicación"}
          </button>
          <p className="mt-2 text-[12px] leading-snug text-pd-ink-400">
            Solo para mostrarte el local más cercano. Tu ubicación no sale de tu celular: no la enviamos ni la guardamos.
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
        <ul className="mt-6 space-y-3">
          {filas.map(({ local: l, km }, i) => (
            <li key={l.id}>
              <Link
                href={`/pedir/${l.id}`}
                onClick={() => recordarLocal(l.id)}
                className="block rounded-2xl border border-pd-line bg-white p-5 transition-colors active:bg-pd-tint"
              >
                {punto && i === 0 && km !== null && (
                  <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-pd-success">Más cerca de vos</p>
                )}
                <div className="flex items-start justify-between gap-3">
                  <p className="pd-display text-[19px] font-bold leading-tight">{l.nombre}</p>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold ${l.abierto ? "bg-pd-success/10 text-pd-success" : "bg-pd-warm text-pd-ink-600"}`}>
                    {l.abierto ? "Abierto" : "Cerrado"}
                  </span>
                </div>
                {(l.direccion || l.localidad) && (
                  <p className="mt-1 text-[13.5px] text-pd-ink-600">{[l.direccion, l.localidad].filter(Boolean).join(", ")}</p>
                )}
                {km !== null && <p className="mt-1 text-[13.5px] font-semibold">a {formatearDistancia(km)}</p>}
                <p className="mt-3 text-[13px] text-pd-ink-400">
                  {[l.conRetiro && "Retiro en el local", l.conEnvio && "Envío a domicilio"].filter(Boolean).join(" · ")}
                  {!l.abierto && l.proximaApertura ? ` · Abre ${l.proximaApertura}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
