"use client";

import { useState, useMemo, useTransition } from "react";
import { crearContacto, actualizarContacto } from "../actions";

export type Nicho = { id: string; nombre: string; descripcion: string | null; horario_pico: string | null; color_tag: string | null };
export type SucursalOpt = { id: string; nombre: string };
export type Contacto = {
  id: string; fecha_hora: string; sucursal_id: string; nicho_id: string | null;
  canal: "whatsapp" | "instagram" | "pedidosya" | "otro";
  nombre_contacto: string | null; consulta_mensaje: string | null;
  estado: "nuevo" | "en_atencion" | "convertido" | "perdido";
  convertido_pedido: boolean; monto: number | null; notas: string | null; created_at: string;
};

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const CANAL_LABEL: Record<Contacto["canal"], string> = { whatsapp: "WhatsApp", instagram: "Instagram", pedidosya: "PedidosYa", otro: "Otro" };

const ESTADOS: { id: Contacto["estado"]; label: string; color: string }[] = [
  { id: "nuevo",       label: "Nuevo" },
  { id: "en_atencion", label: "En atención" },
  { id: "convertido",  label: "Convertido" },
  { id: "perdido",     label: "Perdido" },
].map((e, i) => ({ ...e, color: ["#0369A1", "#C05621", "#0B6B4F", "#9B2222"][i] })) as { id: Contacto["estado"]; label: string; color: string }[];

export function NichosBoard({ role, nichos, contactos, sucursales, sucursalFija }: {
  role:         string;
  nichos:       Nicho[];
  contactos:    Contacto[];
  sucursales:   SucursalOpt[];
  sucursalFija: string | null;
}) {
  const [nichoFilter, setNichoFilter] = useState("all");
  const [sucFilter,   setSucFilter]   = useState("all");
  const [showNuevo,   setShowNuevo]   = useState(false);
  const [pending, startTransition]    = useTransition();
  const [error,       setError]       = useState<string | null>(null);

  const sucursalNombre = (id: string) => sucursales.find((s) => s.id === id)?.nombre ?? "—";
  const nichoOf = (id: string | null) => nichos.find((n) => n.id === id) ?? null;

  const filtered = useMemo(() => contactos.filter((c) => {
    if (nichoFilter !== "all" && c.nicho_id !== nichoFilter) return false;
    if (sucFilter !== "all" && c.sucursal_id !== sucFilter) return false;
    return true;
  }), [contactos, nichoFilter, sucFilter]);

  const total          = filtered.length;
  const convertidos    = filtered.filter((c) => c.convertido_pedido).length;
  const montoTotal     = filtered.reduce((s, c) => s + (c.convertido_pedido ? (c.monto ?? 0) : 0), 0);
  const tasaConversion = total > 0 ? Math.round((convertidos / total) * 100) : 0;

  function moverEstado(c: Contacto, estado: Contacto["estado"]) {
    setError(null);
    startTransition(async () => {
      try {
        await actualizarContacto(c.id, c.sucursal_id, {
          estado,
          convertido_pedido: estado === "convertido" ? true : c.convertido_pedido,
        });
      } catch (e) { setError((e as Error).message); }
    });
  }

  function guardarMonto(c: Contacto, monto: number) {
    setError(null);
    startTransition(async () => {
      try {
        await actualizarContacto(c.id, c.sucursal_id, { monto, convertido_pedido: true });
      } catch (e) { setError((e as Error).message); }
    });
  }

  return (
    <div className="space-y-4">
      {/* Métricas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Contactos" value={String(total)} />
        <StatCard label="Convertidos" value={String(convertidos)} />
        <StatCard label="Tasa de conversión" value={`${tasaConversion}%`} />
        <StatCard label="Monto convertido" value={AR.format(montoTotal)} />
      </div>

      {/* Filtros + nuevo contacto */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={nichoFilter} onChange={(e) => setNichoFilter(e.target.value)}
          className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
        >
          <option value="all">Todos los nichos</option>
          {nichos.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
        </select>
        {role === "admin" && sucursales.length > 1 && (
          <select
            value={sucFilter} onChange={(e) => setSucFilter(e.target.value)}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
          >
            <option value="all">Todas las sucursales</option>
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        )}
        <button
          onClick={() => setShowNuevo(true)}
          className="ml-auto h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          + Nuevo contacto
        </button>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {/* Columnas tipo kanban */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {ESTADOS.map((col) => {
          const items = filtered.filter((c) => c.estado === col.id);
          return (
            <div key={col.id} className="rounded-xl border border-neutral-200 bg-neutral-50 flex flex-col min-h-[160px]">
              <div className="px-3 py-2.5 border-b border-neutral-200 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: col.color }}>{col.label}</span>
                <span className="text-xs font-bold tabular-nums text-neutral-400">{items.length}</span>
              </div>
              <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                {items.length === 0 ? (
                  <p className="text-xs text-neutral-300 text-center py-4">Sin contactos</p>
                ) : items.map((c) => {
                  const nicho = nichoOf(c.nicho_id);
                  return (
                    <div key={c.id} className="rounded-lg border border-neutral-200 bg-white p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-neutral-800 truncate">{c.nombre_contacto || "Sin nombre"}</span>
                        <span className="text-[10px] font-medium text-neutral-400 shrink-0">{CANAL_LABEL[c.canal]}</span>
                      </div>
                      {nicho && (
                        <span
                          className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ background: (nicho.color_tag ?? "#94A3B8") + "22", color: nicho.color_tag ?? "#64748B" }}
                        >
                          {nicho.nombre}
                        </span>
                      )}
                      {role === "admin" && sucursales.length > 1 && (
                        <p className="text-[10px] text-neutral-400">{sucursalNombre(c.sucursal_id)}</p>
                      )}
                      {c.consulta_mensaje && <p className="text-xs text-neutral-500 line-clamp-2">{c.consulta_mensaje}</p>}
                      <p className="text-[10px] text-neutral-300">
                        {new Date(c.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                      </p>

                      {col.id === "convertido" && (
                        <input
                          type="number" min={0} placeholder="Monto $"
                          defaultValue={c.monto ?? ""}
                          onBlur={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v !== c.monto) guardarMonto(c, v);
                          }}
                          className="w-full h-7 px-2 rounded border border-neutral-300 text-xs focus:outline-none focus:border-tierra-700"
                        />
                      )}

                      <div className="flex flex-wrap gap-1 pt-1">
                        {ESTADOS.filter((e) => e.id !== col.id).map((e) => (
                          <button
                            key={e.id}
                            disabled={pending}
                            onClick={() => moverEstado(c, e.id)}
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-neutral-200 text-neutral-500 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
                          >
                            → {e.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {showNuevo && (
        <NuevoContactoModal
          nichos={nichos}
          sucursales={sucursales}
          sucursalFija={sucursalFija}
          onClose={() => setShowNuevo(false)}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">{label}</p>
      <p className="text-xl font-bold font-display text-neutral-900 mt-1 tabular-nums">{value}</p>
    </div>
  );
}

function NuevoContactoModal({ nichos, sucursales, sucursalFija, onClose }: {
  nichos: Nicho[]; sucursales: SucursalOpt[]; sucursalFija: string | null; onClose: () => void;
}) {
  const [sucursalId, setSucursalId] = useState(sucursalFija ?? sucursales[0]?.id ?? "");
  const [nichoId,    setNichoId]    = useState("");
  const [canal,      setCanal]      = useState<Contacto["canal"]>("whatsapp");
  const [nombre,     setNombre]     = useState("");
  const [consulta,   setConsulta]   = useState("");
  const [error,      setError]      = useState<string | null>(null);
  const [pending, startTransition]  = useTransition();

  function handleSubmit() {
    if (!sucursalId) { setError("Elegí una sucursal"); return; }
    setError(null);
    startTransition(async () => {
      try {
        await crearContacto({
          sucursal_id:      sucursalId,
          nicho_id:         nichoId || null,
          canal,
          nombre_contacto:  nombre || null,
          consulta_mensaje: consulta || null,
        });
        onClose();
      } catch (e) { setError((e as Error).message); }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className="relative z-10 bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold font-display text-neutral-900">Nuevo contacto</h3>

        {sucursales.length > 1 && (
          <select
            value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}
            className="w-full h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
          >
            {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        )}
        <select
          value={canal} onChange={(e) => setCanal(e.target.value as Contacto["canal"])}
          className="w-full h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
          <option value="pedidosya">PedidosYa</option>
          <option value="otro">Otro</option>
        </select>
        <select
          value={nichoId} onChange={(e) => setNichoId(e.target.value)}
          className="w-full h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
        >
          <option value="">Sin nicho definido</option>
          {nichos.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
        </select>
        <input
          type="text" placeholder="Nombre (opcional)" value={nombre} onChange={(e) => setNombre(e.target.value)}
          className="w-full h-9 rounded-lg border border-neutral-300 px-3 text-sm focus:outline-none focus:border-tierra-700"
        />
        <textarea
          placeholder="Consulta / mensaje (opcional)" value={consulta} onChange={(e) => setConsulta(e.target.value)} rows={2}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm resize-none focus:outline-none focus:border-tierra-700"
        />

        {error && <p className="text-xs text-danger">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-neutral-300 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSubmit} disabled={pending}
            className="flex-1 h-10 rounded-lg bg-tierra-700 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {pending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
