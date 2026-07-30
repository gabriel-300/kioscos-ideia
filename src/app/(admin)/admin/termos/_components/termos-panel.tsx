"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { crearTermo, darDeBajaTermo, reactivarTermo, prestarTermo, devolverTermo } from "../actions";

export type SucursalOpt = { id: string; nombre: string };
export type Termo = { id: string; sucursal_id: string; numero: string; estado: "disponible" | "prestado" | "baja" };
export type Prestamo = {
  id: string; termo_id: string; sucursal_id: string; dni: string; nombre: string | null;
  fecha_prestamo: string; fecha_devolucion: string | null;
};

const ESTADO_LABEL: Record<string, string> = { disponible: "Disponible", prestado: "Prestado", baja: "De baja" };
const ESTADO_COLOR: Record<string, string> = {
  disponible: "bg-selva-50 text-selva-700 border-selva-200",
  prestado:   "bg-amber-50 text-amber-700 border-amber-200",
  baja:       "bg-neutral-100 text-neutral-500 border-neutral-200",
};

// Las fechas (préstamo/devolución) siempre las pone el servidor con now() --
// acá solo se muestran, nunca se editan a mano.
function haceTiempo(iso: string): string {
  const ms  = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1)  return "recién";
  if (min < 60) return `hace ${min} min`;
  const hs = Math.floor(min / 60);
  if (hs < 24)  return `hace ${hs} h`;
  const dias = Math.floor(hs / 24);
  return `hace ${dias} d`;
}

export function TermosPanel({ role, sucursales, sucursalFija, termos, prestamosAbiertos, historial }: {
  role:              string;
  sucursales:        SucursalOpt[];
  sucursalFija:      string | null;
  termos:            Termo[];
  prestamosAbiertos: Prestamo[];
  historial:         Prestamo[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sucursalFiltro, setSucursalFiltro] = useState(sucursalFija ?? (sucursales[0]?.id ?? ""));
  const puedeGestionar = role === "admin" || role === "encargado";

  const [nuevoOpen,   setNuevoOpen]   = useState(false);
  const [nuevoNumero, setNuevoNumero] = useState("");

  const [prestarTermoId, setPrestarTermoId] = useState<string | null>(null);
  const [dni,            setDni]            = useState("");
  const [nombreCliente,  setNombreCliente]  = useState("");

  const [historialOpen, setHistorialOpen] = useState(false);

  const prestamoDeTermo = new Map(prestamosAbiertos.map((p) => [p.termo_id, p]));
  const sucNombre = (id: string) => sucursales.find((s) => s.id === id)?.nombre ?? "—";
  const sucursalActiva = sucursalFija ?? sucursalFiltro;
  const termosVisibles = termos.filter((t) => t.sucursal_id === sucursalActiva);

  const disponibles = termosVisibles.filter((t) => t.estado === "disponible").length;
  const prestados    = termosVisibles.filter((t) => t.estado === "prestado").length;

  function handleCrearTermo() {
    setError(null);
    const numero = nuevoNumero.trim();
    if (!numero) { setError("Ingresá un número de termo"); return; }
    startTransition(async () => {
      const res = await crearTermo({ sucursal_id: sucursalActiva, numero });
      if (res.error) { setError(res.error); return; }
      setNuevoNumero(""); setNuevoOpen(false);
      router.refresh();
    });
  }

  function handlePrestar(termoId: string, sucursalId: string) {
    setError(null);
    const dniLimpio = dni.trim();
    if (!dniLimpio) { setError("Ingresá el DNI"); return; }
    startTransition(async () => {
      const res = await prestarTermo({ sucursal_id: sucursalId, termo_id: termoId, dni: dniLimpio, nombre: nombreCliente.trim() || null });
      if (res.error) { setError(res.error); return; }
      setPrestarTermoId(null); setDni(""); setNombreCliente("");
      router.refresh();
    });
  }

  function handleDevolver(prestamoId: string, sucursalId: string) {
    setError(null);
    startTransition(async () => {
      const res = await devolverTermo({ prestamo_id: prestamoId, sucursal_id: sucursalId });
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  function handleDarDeBaja(termoId: string, sucursalId: string) {
    if (!confirm("¿Dar de baja este termo? (se puede reactivar después)")) return;
    setError(null);
    startTransition(async () => {
      const res = await darDeBajaTermo(termoId, sucursalId);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  function handleReactivar(termoId: string, sucursalId: string) {
    setError(null);
    startTransition(async () => {
      const res = await reactivarTermo(termoId, sucursalId);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* Filtro de sucursal (solo admin con más de una) + resumen */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {!sucursalFija && sucursales.length > 1 && (
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-neutral-500 block mb-1.5">Sucursal</label>
              <select
                value={sucursalFiltro}
                onChange={(e) => setSucursalFiltro(e.target.value)}
                className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
              >
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-2">
            <span className="text-xs font-semibold px-2.5 py-1.5 rounded-full bg-selva-50 text-selva-700 border border-selva-200">
              {disponibles} disponible{disponibles === 1 ? "" : "s"}
            </span>
            <span className="text-xs font-semibold px-2.5 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              {prestados} prestado{prestados === 1 ? "" : "s"}
            </span>
          </div>
        </div>
        {puedeGestionar && (
          <Button variant="ghost" size="sm" onClick={() => setNuevoOpen((v) => !v)}>
            + Nuevo termo
          </Button>
        )}
      </div>

      {nuevoOpen && (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-neutral-500 block mb-1.5">N° de termo</label>
            <input
              type="text"
              value={nuevoNumero}
              onChange={(e) => setNuevoNumero(e.target.value)}
              placeholder="Ej: 1"
              className="h-10 w-40 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
            />
          </div>
          <Button variant="primary" size="sm" loading={pending} onClick={handleCrearTermo}>Agregar</Button>
          <Button variant="ghost" size="sm" onClick={() => { setNuevoOpen(false); setNuevoNumero(""); setError(null); }}>Cancelar</Button>
        </div>
      )}

      {error && <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}

      {/* Lista de termos */}
      <div className="space-y-2">
        {termosVisibles.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-400">
            Todavía no hay termos cargados en esta sucursal.
          </div>
        ) : (
          termosVisibles.map((t) => {
            const prestamo = prestamoDeTermo.get(t.id);
            return (
              <div key={t.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold font-display text-neutral-900">Termo N° {t.numero}</span>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${ESTADO_COLOR[t.estado]}`}>
                      {ESTADO_LABEL[t.estado]}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {t.estado === "disponible" && (
                      <Button variant="primary" size="sm" onClick={() => { setPrestarTermoId(t.id); setDni(""); setNombreCliente(""); setError(null); }}>
                        Prestar
                      </Button>
                    )}
                    {t.estado === "prestado" && prestamo && (
                      <Button variant="primary" size="sm" loading={pending} onClick={() => handleDevolver(prestamo.id, t.sucursal_id)}>
                        Marcar devuelto
                      </Button>
                    )}
                    {puedeGestionar && t.estado === "disponible" && (
                      <Button variant="ghost" size="sm" onClick={() => handleDarDeBaja(t.id, t.sucursal_id)}>Dar de baja</Button>
                    )}
                    {puedeGestionar && t.estado === "baja" && (
                      <Button variant="ghost" size="sm" loading={pending} onClick={() => handleReactivar(t.id, t.sucursal_id)}>Reactivar</Button>
                    )}
                  </div>
                </div>

                {t.estado === "prestado" && prestamo && (
                  <div className="mt-3 pt-3 border-t border-neutral-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="text-neutral-600">DNI: <span className="font-semibold text-neutral-900">{prestamo.dni}</span></span>
                    {prestamo.nombre && <span className="text-neutral-600">{prestamo.nombre}</span>}
                    <span className="text-neutral-400 text-xs">{haceTiempo(prestamo.fecha_prestamo)}</span>
                  </div>
                )}

                {prestarTermoId === t.id && (
                  <div className="mt-3 pt-3 border-t border-neutral-100 flex flex-wrap items-end gap-3">
                    <div>
                      <label className="text-xs font-medium uppercase tracking-wide text-neutral-500 block mb-1.5">DNI *</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={dni}
                        onChange={(e) => setDni(e.target.value)}
                        placeholder="Ej: 40123456"
                        autoFocus
                        className="h-10 w-40 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium uppercase tracking-wide text-neutral-500 block mb-1.5">Nombre (opcional)</label>
                      <input
                        type="text"
                        value={nombreCliente}
                        onChange={(e) => setNombreCliente(e.target.value)}
                        placeholder="Ej: Juan Pérez"
                        className="h-10 w-48 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
                      />
                    </div>
                    <Button variant="primary" size="sm" loading={pending} onClick={() => handlePrestar(t.id, t.sucursal_id)}>Confirmar</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setPrestarTermoId(null); setError(null); }}>Cancelar</Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Historial de devoluciones */}
      <div>
        <button onClick={() => setHistorialOpen((v) => !v)} className="text-xs font-semibold text-tierra-700 hover:underline">
          {historialOpen ? "Ocultar historial" : "Ver historial de devoluciones"}
        </button>
        {historialOpen && (
          <div className="mt-2 rounded-xl border border-neutral-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: "480px" }}>
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Termo</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">DNI</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Prestado</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Devuelto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50">
                  {historial.filter((h) => h.sucursal_id === sucursalActiva).length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-neutral-400">Sin devoluciones registradas todavía.</td></tr>
                  ) : (
                    historial.filter((h) => h.sucursal_id === sucursalActiva).map((h) => {
                      const termoNumero = termos.find((t) => t.id === h.termo_id)?.numero ?? "—";
                      return (
                        <tr key={h.id}>
                          <td className="px-3 py-2.5 font-medium text-neutral-800">N° {termoNumero}</td>
                          <td className="px-3 py-2.5 text-neutral-600">{h.dni}{h.nombre ? ` — ${h.nombre}` : ""}</td>
                          <td className="px-3 py-2.5 text-neutral-500 text-xs">{new Date(h.fecha_prestamo).toLocaleString("es-AR")}</td>
                          <td className="px-3 py-2.5 text-neutral-500 text-xs">{h.fecha_devolucion ? new Date(h.fecha_devolucion).toLocaleString("es-AR") : "—"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
