"use client";

import { useState, useTransition } from "react";
import { guardarBeneficioCliente } from "../actions";
import { describirBeneficio, type ConfigBeneficio } from "@/lib/pedidos/beneficio-cliente";

const inputCls = "h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20";

// Beneficios para clientes que ingresan con Google. Es un formulario aparte del
// de envíos y horarios: las columnas son de la migración 099 y así guardar la
// configuración de siempre no depende de ella.
export function BeneficioForm({ sucursalId, inicial }: { sucursalId: string; inicial: ConfigBeneficio }) {
  const [pending, startTransition] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pct, setPct] = useState(String(inicial.descuentoPct));
  const [soloPrimera, setSoloPrimera] = useState(inicial.descuentoSoloPrimera);
  const [envioGratis, setEnvioGratis] = useState(inicial.envioGratisPrimera);

  const pctNum = parseFloat(pct) || 0;
  const vista = describirBeneficio({ descuentoPct: pctNum, descuentoSoloPrimera: soloPrimera, envioGratisPrimera: envioGratis });

  function guardar() {
    setMensaje(null);
    startTransition(async () => {
      const res = await guardarBeneficioCliente(sucursalId, { descuentoPct: pctNum, descuentoSoloPrimera: soloPrimera, envioGratisPrimera: envioGratis });
      setMensaje(res.error ? { ok: false, texto: res.error } : { ok: true, texto: "Guardado" });
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Beneficios para clientes registrados</h2>
        <p className="text-xs text-neutral-400 mt-0.5">
          Los reciben quienes ingresan con Google al pedir; quien pide sin cuenta paga el precio normal. Todo en 0 / apagado = sin beneficios.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Descuento sobre los productos (%)</label>
          <input type="number" min="0" max="100" step="0.5" value={pct} onChange={(e) => setPct(e.target.value)} className={`${inputCls} w-full`} />
        </div>
        <label className="flex items-center gap-2.5 text-sm text-neutral-700 cursor-pointer h-10">
          <input type="checkbox" checked={soloPrimera} onChange={(e) => setSoloPrimera(e.target.checked)} className="size-4 rounded border-neutral-300" />
          El descuento vale solo en la primera compra
        </label>
      </div>

      <label className="flex items-center gap-2.5 text-sm text-neutral-700 cursor-pointer">
        <input type="checkbox" checked={envioGratis} onChange={(e) => setEnvioGratis(e.target.checked)} className="size-4 rounded border-neutral-300" />
        Envío gratis en la primera compra
      </label>
      <p className="text-[11px] text-neutral-400 -mt-2 ml-6">El descuento nunca se aplica al costo de envío.</p>

      <p className="text-xs text-neutral-500 rounded-lg bg-neutral-50 px-3 py-2">
        {vista ? <>El cliente verá: <strong>{vista}</strong></> : "Sin beneficios: no se muestra ninguna invitación a ingresar."}
      </p>
      {vista && (
        <p className="text-[11px] text-amber-700">
          Antes de activarlo, el ingreso con Google tiene que estar configurado en Supabase (Authentication → Providers → Google).
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="button" onClick={guardar} disabled={pending} className="h-10 px-5 rounded-lg bg-tierra-700 text-white text-sm font-semibold disabled:opacity-50">
          {pending ? "Guardando…" : "Guardar beneficios"}
        </button>
        {mensaje && <span className={`text-sm ${mensaje.ok ? "text-emerald-600" : "text-danger"}`}>{mensaje.texto}</span>}
      </div>
    </div>
  );
}
