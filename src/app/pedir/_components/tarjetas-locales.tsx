"use client";

import { useState } from "react";
import Link from "next/link";
import { formatearDistancia, ordenarPorCercania } from "@/lib/geo";
import { pedirUbicacion } from "@/lib/geolocalizar";

// Los locales donde se puede pedir, en la portada. Con más de uno, el cliente puede ordenarlos por cercanía.
//
// PRIVACIDAD: la ubicación vive solo en el estado de este componente. No se envía al servidor, no se guarda, no va en
// la URL (misma regla que la pantalla de elegir local). La distancia se calcula acá, en su celular.

export type TarjetaLocal = {
  id: string; slug: string; nombre: string; direccion: string | null; localidad: string | null;
  latitud: number | null; longitud: number | null;
  abierto: boolean; hoyTexto: string | null;
};

const CLASE_BOTON = "pd-display inline-flex h-14 items-center justify-center rounded-2xl bg-pd-ember px-8 text-[16px] font-bold active:bg-pd-ember-dark";

export function TarjetasLocales({ locales }: { locales: TarjetaLocal[] }) {
  const [punto, setPunto] = useState<{ lat: number; lng: number } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ordenar() {
    setError(null);
    setBuscando(true);
    const r = await pedirUbicacion("elegí el local de la lista");
    setBuscando(false);
    if ("error" in r) { setError(r.error); return; }
    setPunto(r.punto);
  }

  const lista = punto
    ? ordenarPorCercania(locales, punto)
    : locales.map((local) => ({ local, km: null as number | null }));
  const hayDistancia = !!punto && lista.some((x) => x.km !== null);

  return (
    <div>
      {locales.length > 1 && (
        <div className="mt-3">
          {punto ? (
            <button type="button" onClick={() => setPunto(null)} className="text-[13px] font-semibold text-pd-ink-600 underline">Quitar el orden por cercanía</button>
          ) : (
            <button
              type="button"
              onClick={ordenar}
              disabled={buscando}
              className="pd-display inline-flex h-11 items-center rounded-full border border-pd-line-strong bg-white px-5 text-[13.5px] font-bold text-pd-ink-900 disabled:opacity-60"
            >
              {buscando ? "Buscando tu ubicación…" : "📍 Ordenar por cercanía"}
            </button>
          )}
          {error && <p role="status" className="mt-2 rounded-xl bg-pd-warm px-3.5 py-2.5 text-[13px] leading-snug text-pd-ink-600">{error}</p>}
        </div>
      )}

      {lista.map(({ local, km }, i) => (
        <div key={local.id} className="mt-3 rounded-3xl border border-pd-line bg-white p-5 md:flex md:items-center md:justify-between md:gap-6 md:p-7">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="pd-display text-[20px] font-bold">{local.nombre.trim()}</p>
              {hayDistancia && i === 0 && km !== null && <span className="rounded-full bg-pd-ember px-2.5 py-0.5 text-[11.5px] font-bold text-white">Más cerca</span>}
            </div>
            {(local.direccion || local.localidad) && (
              <p className="mt-1 text-[14.5px] text-pd-ink-600">
                {[local.direccion?.trim(), local.localidad?.trim() || "Posadas"].filter(Boolean).join(", ")}
                {km !== null && <span className="font-semibold text-pd-ink-900"> · a {formatearDistancia(km)}</span>}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-[12.5px] font-semibold">
              <span className={`rounded-full px-3 py-1 ${local.abierto ? "bg-pd-success text-white" : "bg-pd-warm text-pd-ink-900"}`}>{local.abierto ? "Abierto ahora" : "Cerrado ahora"}</span>
              {local.hoyTexto && <span className="rounded-full bg-pd-warm px-3 py-1 text-pd-ink-900">{local.hoyTexto}</span>}
              <span className="rounded-full bg-pd-warm px-3 py-1 text-pd-ink-900">Retiro en el local</span>
              <span className="rounded-full bg-pd-warm px-3 py-1 text-pd-ink-900">Envío a domicilio</span>
            </div>
          </div>
          <Link href={`/${local.slug}`} style={{ color: "#fff" }} className={`${CLASE_BOTON} mt-5 w-full md:mt-0 md:w-auto md:shrink-0`}>Ver el menú</Link>
        </div>
      ))}
    </div>
  );
}
