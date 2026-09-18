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

type FilaDia = { abierto: boolean; abre: string; cierra: string };

function filasDesdeHorario(horario: TramoHorario[] | null): Record<number, FilaDia> {
  const filas: Record<number, FilaDia> = {};
  for (const { dia } of DIAS) {
    const t = horario?.find((x) => x.dia === dia);
    filas[dia] = t
      ? { abierto: true, abre: t.abre.padStart(5, "0"), cierra: t.cierra.padStart(5, "0") }
      : { abierto: false, abre: "08:00", cierra: "00:00" };
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

  function copiarLunesATodos() {
    const lunes = filas[1];
    setFilas(Object.fromEntries(DIAS.map(({ dia }) => [dia, { ...lunes }])) as Record<number, FilaDia>);
  }

  function guardar() {
    setMensaje(null);
    const horario: TramoHorario[] = sinHorario
      ? []
      : DIAS.filter(({ dia }) => filas[dia].abierto).map(({ dia }) => ({ dia, abre: filas[dia].abre, cierra: filas[dia].cierra }));

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
            {DIAS.map(({ dia, nombre }) => (
              <div key={dia} className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 w-28 text-sm text-neutral-700 cursor-pointer">
                  <input type="checkbox" checked={filas[dia].abierto} onChange={(e) => cambiarFila(dia, { abierto: e.target.checked })} className="size-4 rounded border-neutral-300" />
                  {nombre}
                </label>
                <input type="time" disabled={!filas[dia].abierto} value={filas[dia].abre} onChange={(e) => cambiarFila(dia, { abre: e.target.value })} className={`${inputCls} w-32 disabled:opacity-40`} />
                <span className="text-sm text-neutral-400">a</span>
                <input type="time" disabled={!filas[dia].abierto} value={filas[dia].cierra} onChange={(e) => cambiarFila(dia, { cierra: e.target.value })} className={`${inputCls} w-32 disabled:opacity-40`} />
              </div>
            ))}
            <p className="text-[11px] text-neutral-400 pt-1">Si cierra después de medianoche, poné la hora de cierre de la madrugada (ej. 08:00 a 00:30).</p>
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
