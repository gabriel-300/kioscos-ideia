"use client";

import { useState, useTransition } from "react";
import { guardarConfigSucursal } from "../actions";
import type { TramoHorario } from "@/lib/pedidos/horario";

export type ConfigSucursal = {
  pedidos_online_habilitado: boolean;
  delivery_habilitado:       boolean;
  retiro_habilitado:         boolean;
  pedido_minimo_envio:       number;
  retiro_eta_min:            number;
  retiro_eta_max:            number;
  whatsapp_pedidos:          string;
  horario_pedidos:           TramoHorario[] | null;
};

// Orden de la semana como la piensa el local (lunes primero); dia = valor de
// Date.getDay() (0 = domingo), que es lo que guarda horario_pedidos.
const DIAS: { dia: number; nombre: string }[] = [
  { dia: 1, nombre: "Lunes" }, { dia: 2, nombre: "Martes" }, { dia: 3, nombre: "Miércoles" },
  { dia: 4, nombre: "Jueves" }, { dia: 5, nombre: "Viernes" }, { dia: 6, nombre: "Sábado" }, { dia: 0, nombre: "Domingo" },
];

// Un día abierto tiene uno o más horarios (turno partido: 08:00–12:00 y 16:00–20:00).
type Franja = { abre: string; cierra: string };
type FilaDia = { abierto: boolean; franjas: Franja[] };
const MAX_FRANJAS = 3;

function filasDesdeHorario(horario: TramoHorario[] | null): Record<number, FilaDia> {
  const filas: Record<number, FilaDia> = {};
  const sinHorarioCargado = !horario;
  for (const { dia } of DIAS) {
    const delDia = (horario ?? [])
      .filter((x) => x.dia === dia)
      .map((t) => ({ abre: t.abre.padStart(5, "0"), cierra: t.cierra.padStart(5, "0") }))
      .sort((a, b) => a.abre.localeCompare(b.abre));
    // Sin horario cargado, al tildar "tengo horario" arrancan todos los días
    // abiertos (más fácil de ajustar que tener que tildar siete).
    filas[dia] = delDia.length > 0
      ? { abierto: true, franjas: delDia }
      : { abierto: sinHorarioCargado, franjas: [{ abre: "08:00", cierra: sinHorarioCargado ? "22:00" : "00:00" }] };
  }
  return filas;
}

const inputCls = "h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20";

export function ConfigSucursalForm({ sucursalId, inicial }: { sucursalId: string; inicial: ConfigSucursal }) {
  const [pending, startTransition] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);

  const [habilitado, setHabilitado] = useState(inicial.pedidos_online_habilitado);
  const [delivery, setDelivery] = useState(inicial.delivery_habilitado);
  const [retiro, setRetiro] = useState(inicial.retiro_habilitado);
  const [minimo, setMinimo] = useState(String(inicial.pedido_minimo_envio));
  const [etaMin, setEtaMin] = useState(String(inicial.retiro_eta_min));
  const [etaMax, setEtaMax] = useState(String(inicial.retiro_eta_max));
  const [whatsapp, setWhatsapp] = useState(inicial.whatsapp_pedidos);
  const [sinHorario, setSinHorario] = useState(!inicial.horario_pedidos);
  const [filas, setFilas] = useState(() => filasDesdeHorario(inicial.horario_pedidos));

  function cambiarFila(dia: number, parcial: Partial<FilaDia>) {
    setFilas((prev) => ({ ...prev, [dia]: { ...prev[dia], ...parcial } }));
  }

  function cambiarFranja(dia: number, i: number, parcial: Partial<Franja>) {
    setFilas((prev) => ({ ...prev, [dia]: { ...prev[dia], franjas: prev[dia].franjas.map((f, j) => (j === i ? { ...f, ...parcial } : f)) } }));
  }

  function agregarFranja(dia: number) {
    setFilas((prev) => {
      const franjas = prev[dia].franjas;
      if (franjas.length >= MAX_FRANJAS) return prev;
      // La nueva arranca dos horas después del cierre de la última, para que no se pise.
      const ultima = franjas[franjas.length - 1];
      const [h, m] = ultima.cierra.split(":").map((n) => parseInt(n, 10));
      const abre = h >= 20 ? ultima.cierra : `${String(h + 2).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      return { ...prev, [dia]: { ...prev[dia], franjas: [...franjas, { abre, cierra: "23:00" }] } };
    });
  }

  function quitarFranja(dia: number, i: number) {
    setFilas((prev) => ({ ...prev, [dia]: { ...prev[dia], franjas: prev[dia].franjas.filter((_, j) => j !== i) } }));
  }

  function copiarLunesATodos() {
    const lunes = filas[1];
    setFilas(Object.fromEntries(DIAS.map(({ dia }) => [dia, { abierto: lunes.abierto, franjas: lunes.franjas.map((f) => ({ ...f })) }])) as Record<number, FilaDia>);
  }

  function guardar() {
    setMensaje(null);
    if (!sinHorario && !DIAS.some(({ dia }) => filas[dia].abierto)) {
      setMensaje({ ok: false, texto: "Marcá al menos un día abierto, o elegí 'Sin horario (siempre abierto)'" });
      return;
    }
    const horario: TramoHorario[] = sinHorario
      ? []
      : DIAS.filter(({ dia }) => filas[dia].abierto).flatMap(({ dia }) => filas[dia].franjas.map((f) => ({ dia, abre: f.abre, cierra: f.cierra })));

    startTransition(async () => {
      const res = await guardarConfigSucursal(sucursalId, {
        pedidos_online_habilitado: habilitado,
        delivery_habilitado:       delivery,
        retiro_habilitado:         retiro,
        pedido_minimo_envio:       parseFloat(minimo) || 0,
        retiro_eta_min:            parseInt(etaMin, 10) || 0,
        retiro_eta_max:            parseInt(etaMax, 10) || 0,
        whatsapp_pedidos:          whatsapp,
        horario_pedidos:           horario,
      });
      setMensaje(res.error ? { ok: false, texto: res.error } : { ok: true, texto: "Guardado" });
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 space-y-6">
      <div className="space-y-3">
        <label className="flex items-center gap-2.5 text-sm font-medium text-neutral-800 cursor-pointer">
          <input type="checkbox" checked={habilitado} onChange={(e) => setHabilitado(e.target.checked)} className="size-4 rounded border-neutral-300" />
          Aceptar pedidos online en esta sucursal
        </label>
        <p className="text-xs text-neutral-400 -mt-1 ml-6">Si está apagado, el catálogo se ve pero no se puede pedir.</p>
        <label className="flex items-center gap-2.5 text-sm text-neutral-700 cursor-pointer">
          <input type="checkbox" checked={retiro} onChange={(e) => setRetiro(e.target.checked)} className="size-4 rounded border-neutral-300" />
          Retiro en el local
        </label>
        <label className="flex items-center gap-2.5 text-sm text-neutral-700 cursor-pointer">
          <input type="checkbox" checked={delivery} onChange={(e) => setDelivery(e.target.checked)} className="size-4 rounded border-neutral-300" />
          Envío a domicilio (necesita al menos una zona activa, abajo)
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Pedido mínimo para envío ($)</label>
          <input type="number" min="0" step="any" value={minimo} onChange={(e) => setMinimo(e.target.value)} className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">WhatsApp del local (con código de país)</label>
          <input type="tel" placeholder="5493764123456" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={`${inputCls} w-full`} />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Retiro: tiempo estimado (min)</label>
          <div className="flex items-center gap-2">
            <input type="number" min="0" value={etaMin} onChange={(e) => setEtaMin(e.target.value)} className={`${inputCls} w-24`} />
            <span className="text-sm text-neutral-400">a</span>
            <input type="number" min="0" value={etaMax} onChange={(e) => setEtaMax(e.target.value)} className={`${inputCls} w-24`} />
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Horario de atención</p>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
              <input type="checkbox" checked={sinHorario} onChange={(e) => setSinHorario(e.target.checked)} className="size-3.5 rounded border-neutral-300" />
              Sin horario (siempre abierto)
            </label>
            {!sinHorario && (
              <button type="button" onClick={copiarLunesATodos} className="text-xs text-tierra-700 hover:underline">Copiar el lunes a todos los días</button>
            )}
          </div>
        </div>
        {!sinHorario && (
          <div className="space-y-1.5">
            {DIAS.map(({ dia, nombre }) => {
              const fila = filas[dia];
              return (
                <div key={dia} className="flex items-start gap-3 flex-wrap">
                  <label className="flex h-10 items-center gap-2 w-28 text-sm text-neutral-700 cursor-pointer">
                    <input type="checkbox" checked={fila.abierto} onChange={(e) => cambiarFila(dia, { abierto: e.target.checked })} className="size-4 rounded border-neutral-300" />
                    {nombre}
                  </label>
                  <div className="space-y-1.5">
                    {fila.franjas.map((f, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <input type="time" disabled={!fila.abierto} value={f.abre} onChange={(e) => cambiarFranja(dia, i, { abre: e.target.value })} className={`${inputCls} w-32 disabled:opacity-40`} />
                        <span className="text-sm text-neutral-400">a</span>
                        <input type="time" disabled={!fila.abierto} value={f.cierra} onChange={(e) => cambiarFranja(dia, i, { cierra: e.target.value })} className={`${inputCls} w-32 disabled:opacity-40`} />
                        {fila.abierto && fila.franjas.length > 1 && (
                          <button type="button" onClick={() => quitarFranja(dia, i)} aria-label="Quitar este horario" className="size-8 rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-red-600">✕</button>
                        )}
                      </div>
                    ))}
                    {fila.abierto && fila.franjas.length < MAX_FRANJAS && (
                      <button type="button" onClick={() => agregarFranja(dia)} className="text-xs text-tierra-700 hover:underline">+ Agregar otro horario (turno partido)</button>
                    )}
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] text-neutral-400 pt-1">Si cierra después de medianoche, poné la hora de cierre de la madrugada (ej. 08:00 a 00:30). Eso solo se puede en el último horario del día.</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={guardar}
          disabled={pending}
          className="h-10 px-5 rounded-lg bg-tierra-700 text-white text-sm font-semibold disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar configuración"}
        </button>
        {mensaje && <span className={`text-sm ${mensaje.ok ? "text-emerald-600" : "text-danger"}`}>{mensaje.texto}</span>}
      </div>
    </div>
  );
}
