"use client";

import { useState, useTransition } from "react";
import { guardarConfigSucursal } from "../actions";
import type { TramoHorario } from "@/lib/pedidos/horario";
import { EditorHorario } from "./editor-horario";

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
  // null = sin horario (siempre abierto); si no, los tramos que arma el editor
  const [horario, setHorario] = useState<TramoHorario[] | null>(inicial.horario_pedidos);

  function guardar() {
    setMensaje(null);
    if (horario && horario.length === 0) {
      setMensaje({ ok: false, texto: "Marcá al menos un día abierto, o elegí 'Sin horario (siempre abierto)'" });
      return;
    }

    startTransition(async () => {
      const res = await guardarConfigSucursal(sucursalId, {
        pedidos_online_habilitado: habilitado,
        delivery_habilitado:       delivery,
        retiro_habilitado:         retiro,
        pedido_minimo_envio:       parseFloat(minimo) || 0,
        retiro_eta_min:            parseInt(etaMin, 10) || 0,
        retiro_eta_max:            parseInt(etaMax, 10) || 0,
        whatsapp_pedidos:          whatsapp,
        horario_pedidos:           horario ?? [],
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

      <EditorHorario titulo="Horario de atención" textoSin="Sin horario (siempre abierto)" inicial={inicial.horario_pedidos} onChange={setHorario} />

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
