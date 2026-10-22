"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pausarOnline, reactivarOnline } from "../actions";
import { DURACIONES_PAUSA, MOTIVOS_PAUSA_ENVIOS, MOTIVOS_PAUSA_PEDIDOS, pausaVigente, type Pausa } from "@/lib/pedidos/disponibilidad-online";

// Los dos interruptores del personal: pausar el envío (se sigue pudiendo retirar) y pausar todos los pedidos
// online, con un motivo que ve el cliente en la tienda. (Migración 122.)

export type ControlSucursal = {
  id:         string;
  nombre:     string;
  conEnvio:   boolean;
  pausaEnvios:  Pausa | null;
  pausaPedidos: Pausa | null;
};

const HORA = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

function textoPausa(p: Pausa): string {
  return `${p.motivo ?? "En pausa"} · ${p.hasta ? `hasta las ${HORA.format(new Date(p.hasta))}` : "hasta que se reactive"}`;
}

function Fila({ sucursalId, tipo, titulo, ayuda, pausa, motivos }: {
  sucursalId: string; tipo: "envios" | "pedidos"; titulo: string; ayuda: string; pausa: Pausa | null; motivos: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState(motivos[0]);
  const [otro, setOtro] = useState("");
  const [minutos, setMinutos] = useState<string>("60");
  const [error, setError] = useState<string | null>(null);

  const activa = pausaVigente(pausa);

  function confirmar() {
    setError(null);
    const texto = motivo === "__otro" ? otro : motivo;
    startTransition(async () => {
      const res = await pausarOnline(sucursalId, tipo, texto, minutos === "null" ? null : parseInt(minutos, 10));
      if (res.error) { setError(res.error); return; }
      setAbierto(false);
      router.refresh();
    });
  }

  function reactivar() {
    setError(null);
    startTransition(async () => {
      const res = await reactivarOnline(sucursalId, tipo);
      if (res.error) { setError(res.error); return; }
      router.refresh();
    });
  }

  const select = "h-10 rounded-lg border border-neutral-300 bg-white px-2.5 text-sm";

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-900">{titulo}</p>
          {activa ? (
            <p className="mt-0.5 text-xs font-medium text-amber-800">⏸ Pausado: {textoPausa(pausa)}</p>
          ) : (
            <p className="mt-0.5 text-xs text-neutral-400">{ayuda}</p>
          )}
        </div>
        {activa ? (
          <button type="button" onClick={reactivar} disabled={pending} className="h-10 shrink-0 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? "…" : "Reactivar"}
          </button>
        ) : (
          <button type="button" onClick={() => setAbierto((a) => !a)} className="h-10 shrink-0 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-700">
            {abierto ? "Cancelar" : "Pausar"}
          </button>
        )}
      </div>

      {abierto && !activa && (
        <div className="mt-3 space-y-2.5 rounded-lg bg-neutral-50 p-3">
          <div className="flex flex-wrap gap-2">
            <select value={motivo} onChange={(e) => setMotivo(e.target.value)} className={select} aria-label="Motivo">
              {motivos.map((m) => <option key={m} value={m}>{m}</option>)}
              <option value="__otro">Otro motivo…</option>
            </select>
            <select value={minutos} onChange={(e) => setMinutos(e.target.value)} className={select} aria-label="Duración">
              {DURACIONES_PAUSA.map((d) => <option key={String(d.minutos)} value={String(d.minutos)}>{d.texto}</option>)}
            </select>
          </div>
          {motivo === "__otro" && (
            <input value={otro} onChange={(e) => setOtro(e.target.value)} maxLength={80} placeholder="Escribí el motivo (lo ve el cliente)" className={`${select} w-full`} />
          )}
          <button type="button" onClick={confirmar} disabled={pending} className="h-10 rounded-lg bg-amber-600 px-5 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? "Pausando…" : "Confirmar pausa"}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function ControlDisponibilidad({ sucursales }: { sucursales: ControlSucursal[] }) {
  if (sucursales.length === 0) return null;
  return (
    <div className="mb-6 space-y-3">
      {sucursales.map((s) => (
        <section key={s.id} className="rounded-xl border border-neutral-200 bg-white p-4" aria-label={`Atención online de ${s.nombre}`}>
          {sucursales.length > 1 && <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">{s.nombre.trim()}</h2>}
          <div className="divide-y divide-neutral-100">
            <Fila sucursalId={s.id} tipo="pedidos" titulo="Pedidos online" ayuda="Se están tomando con normalidad" pausa={s.pausaPedidos} motivos={MOTIVOS_PAUSA_PEDIDOS} />
            {s.conEnvio && <Fila sucursalId={s.id} tipo="envios" titulo="Envíos a domicilio" ayuda="Se están haciendo (el retiro sigue andando si pausás el envío)" pausa={s.pausaEnvios} motivos={MOTIVOS_PAUSA_ENVIOS} />}
          </div>
        </section>
      ))}
    </div>
  );
}
