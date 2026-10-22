"use client";

import { useState, useTransition } from "react";
import { guardarHorarioEnvios } from "../actions";
import type { TramoHorario } from "@/lib/pedidos/horario";
import { EditorHorario } from "./editor-horario";

// Cuándo se hace el envío a domicilio, aparte del horario del local: el local puede atender de 7 a 21 y salir
// con repartidor solo en ciertas franjas. Sin horario propio, el envío sigue el horario del local. (Migración 122.)
export function HorarioEnviosForm({ sucursalId, inicial }: { sucursalId: string; inicial: TramoHorario[] | null }) {
  const [pending, startTransition] = useTransition();
  const [mensaje, setMensaje] = useState<{ ok: boolean; texto: string } | null>(null);
  const [horario, setHorario] = useState<TramoHorario[] | null>(inicial);

  function guardar() {
    setMensaje(null);
    if (horario && horario.length === 0) {
      setMensaje({ ok: false, texto: "Marcá al menos un día con envío, o elegí 'Igual al horario del local'" });
      return;
    }
    startTransition(async () => {
      const res = await guardarHorarioEnvios(sucursalId, horario);
      setMensaje(res.error ? { ok: false, texto: res.error } : { ok: true, texto: "Guardado" });
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">Horario de envíos</h2>
        <p className="text-xs text-neutral-400 mt-0.5">
          Cuándo sale el envío a domicilio. Fuera de estas horas el cliente ve el envío apagado y puede retirar en el local. Si no cargás uno propio, el envío
          sigue el horario del local. Para cortar el envío un rato (por ejemplo, sin repartidor) no hace falta tocar esto: se pausa desde Pedidos online.
        </p>
      </div>

      <EditorHorario titulo="Horario del envío" textoSin="Igual al horario del local" inicial={inicial} onChange={setHorario} />

      <div className="flex items-center gap-3">
        <button type="button" onClick={guardar} disabled={pending} className="h-10 px-5 rounded-lg bg-tierra-700 text-white text-sm font-semibold disabled:opacity-50">
          {pending ? "Guardando…" : "Guardar horario de envíos"}
        </button>
        {mensaje && <span className={`text-sm ${mensaje.ok ? "text-emerald-600" : "text-danger"}`}>{mensaje.texto}</span>}
      </div>
    </div>
  );
}
