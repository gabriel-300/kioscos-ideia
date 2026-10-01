"use client";

import { useState, useTransition } from "react";
import { guardarCoordenadasSucursal } from "../actions";
import { parsearCoordenadas } from "@/lib/geo";

const inputCls = "h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20";

type Coord = { lat: number; lng: number } | null;

// Ubicación del local para que el cliente vea cuál le queda más cerca. Formulario
// aparte (columnas de la migración 100): guardar la configuración de siempre no
// depende de ella.
export function CoordenadasForm({ sucursalId, inicial }: { sucursalId: string; inicial: Coord }) {
  const [pending, startTransition] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [texto, setTexto] = useState(inicial ? `${inicial.lat}, ${inicial.lng}` : "");
  const [guardada, setGuardada] = useState<Coord>(inicial);

  const parseo = texto.trim() ? parsearCoordenadas(texto) : null;
  const vista = parseo?.ok ? parseo : null;

  function guardar() {
    setMensaje(null);
    startTransition(async () => {
      const res = await guardarCoordenadasSucursal(sucursalId, texto);
      if (res.error) { setMensaje({ ok: false, texto: res.error }); return; }
      setGuardada(res.lat != null && res.lng != null ? { lat: res.lat, lng: res.lng } : null);
      setMensaje({ ok: true, texto: res.lat != null ? "Guardado" : "Coordenadas borradas" });
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Ubicación del local</h2>
        <p className="text-xs text-neutral-400 mt-0.5">
          Con la ubicación cargada, el cliente puede ordenar los locales del más cerca al más lejos. Sin ella, el local aparece al final de la lista, sin distancia.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Coordenadas (latitud, longitud)</label>
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder="-27.366512, -55.896423"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className={`${inputCls} w-full`}
        />
        <p className="text-[11px] text-neutral-400 mt-1.5">
          En Google Maps, clic derecho sobre el local → el primer renglón son las coordenadas: tocalo para copiarlas y pegalas acá.
        </p>
        {parseo && !parseo.ok && <p className="text-xs text-danger mt-1.5">{parseo.error}</p>}
      </div>

      {(vista || guardada) && (
        <p className="text-xs text-neutral-500 rounded-lg bg-neutral-50 px-3 py-2">
          {vista ? "Con este valor: " : "Guardada: "}
          <a
            href={`https://www.google.com/maps?q=${(vista ?? guardada)!.lat},${(vista ?? guardada)!.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-tierra-700 underline"
          >
            ver en el mapa
          </a>{" "}
          y comprobá que cae en el lugar correcto.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="button" onClick={guardar} disabled={pending || (!!parseo && !parseo.ok)} className="h-10 px-5 rounded-lg bg-tierra-700 text-white text-sm font-semibold disabled:opacity-50">
          {pending ? "Guardando…" : texto.trim() ? "Guardar ubicación" : "Borrar ubicación"}
        </button>
        {mensaje && <span className={`text-sm ${mensaje.ok ? "text-emerald-600" : "text-danger"}`}>{mensaje.texto}</span>}
      </div>
    </div>
  );
}
