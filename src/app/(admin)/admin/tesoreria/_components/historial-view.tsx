import { ETIQUETA_ACCION, describirHistorial, type FilaHistorial } from "@/lib/tesoreria/historial";

// Todo lo que se hizo en Tesorería en el mes: quién, cuándo, qué y por qué. Es de solo lectura y no se puede editar ni borrar
// (lo impide un trigger en la base, migración 104). Sirve para que cada cambio de plata tenga un responsable a la vista.

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const COLOR: Record<string, string> = {
  egreso_creado:             "border-selva-200 bg-selva-50 text-selva-700",
  egreso_pagado:             "border-selva-200 bg-selva-50 text-selva-700",
  egreso_anulado:            "border-danger/30 bg-danger/5 text-danger",
  entrega_descartada:        "border-amber-200 bg-amber-50 text-amber-700",
  entrega_restaurada:        "border-neutral-200 bg-neutral-50 text-neutral-600",
  efectivo_inicial_cambiado: "border-amber-200 bg-amber-50 text-amber-700",
  permiso_cambiado:          "border-blue-200 bg-blue-50 text-blue-700",
};

export function HistorialView({ filas }: { filas: FilaHistorial[] }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400">
        Cada cosa que se carga, se paga, se anula o se cambia en Tesorería queda acá, con quién la hizo. No se puede editar ni borrar.
      </p>
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden divide-y divide-neutral-100">
        {filas.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-neutral-400">No hay movimientos en este mes.</p>
        ) : filas.map((f) => (
          <div key={f.id} className="px-4 py-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${COLOR[f.accion] ?? "border-neutral-200 bg-neutral-50 text-neutral-600"}`}>
                {ETIQUETA_ACCION[f.accion] ?? f.accion}
              </span>
              <span className="text-xs text-neutral-400">{fechaHora(f.creado_en)} · {f.usuario ?? "Usuario desconocido"}</span>
            </div>
            <p className="text-sm text-neutral-800 mt-1">{describirHistorial(f)}</p>
            {f.motivo && <p className="text-xs text-neutral-500 mt-0.5">Motivo: «{f.motivo}»</p>}
          </div>
        ))}
      </div>
      {filas.length >= 500 && <p className="text-xs text-amber-700">Se muestran los últimos 500 movimientos del mes.</p>}
    </div>
  );
}
