"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { crearTermo, darDeBajaTermo, reactivarTermo, prestarTermo, devolverTermo, pagarMultaTermo, actualizarConfigMulta } from "../actions";

export type SucursalOpt = { id: string; nombre: string; termo_horas_limite?: number; termo_tarifa_multa_hora?: number };
export type Termo = { id: string; sucursal_id: string; numero: string; estado: "disponible" | "prestado" | "baja"; tipo: "frio" | "caliente" };
export type Prestamo = {
  id: string; termo_id: string; sucursal_id: string; dni: string; telefono: string; nombre: string | null;
  fecha_prestamo: string; fecha_devolucion: string | null;
  monto_multa: number; multa_pagada_en: string | null;
};

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const ESTADO_LABEL: Record<string, string> = { disponible: "Disponible", prestado: "Prestado", baja: "De baja" };
const ESTADO_COLOR: Record<string, string> = {
  disponible: "bg-selva-50 text-selva-700 border-selva-200",
  prestado:   "bg-amber-50 text-amber-700 border-amber-200",
  baja:       "bg-neutral-100 text-neutral-500 border-neutral-200",
};

const TIPO_LABEL: Record<string, string> = { frio: "🧊 Frío", caliente: "☕ Caliente" };
const TIPO_COLOR: Record<string, string> = {
  frio:     "bg-sky-50 text-sky-700 border-sky-200",
  caliente: "bg-orange-50 text-orange-700 border-orange-200",
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

// Estimado en vivo de cuánto llevaría de multa AHORA si se devolviera este
// instante -- el monto real y definitivo lo calcula el servidor recién al
// confirmar la devolución (devolver_termo), esto es solo para que el
// vendedor no se sorprenda.
function horasAtrasoEstimadas(fechaPrestamo: string, horasLimite: number): number {
  const horasTranscurridas = (Date.now() - new Date(fechaPrestamo).getTime()) / 3600000;
  return Math.max(0, Math.ceil(horasTranscurridas - horasLimite));
}

type Pagos = { efectivo: string; billetera: string; tarjeta: string; transferencia: string };
const pagosVacios = (): Pagos => ({ efectivo: "", billetera: "", tarjeta: "", transferencia: "" });

export function TermosPanel({ role, sucursales, sucursalFija, termos, prestamosAbiertos, deudasPendientes, historial }: {
  role:              string;
  sucursales:        SucursalOpt[];
  sucursalFija:      string | null;
  termos:            Termo[];
  prestamosAbiertos: Prestamo[];
  deudasPendientes:  Prestamo[];
  historial:         Prestamo[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sucursalFiltro, setSucursalFiltro] = useState(sucursalFija ?? (sucursales[0]?.id ?? ""));
  const puedeGestionar = role === "admin" || role === "encargado";

  const [nuevoOpen,   setNuevoOpen]   = useState(false);
  const [nuevoNumero, setNuevoNumero] = useState("");
  const [nuevoTipo,   setNuevoTipo]   = useState<"frio" | "caliente">("caliente");

  const [tipoFiltro, setTipoFiltro] = useState<"todos" | "frio" | "caliente">("todos");

  const [prestarTermoId, setPrestarTermoId] = useState<string | null>(null);
  const [dni,            setDni]            = useState("");
  const [telefono,       setTelefono]       = useState("");
  const [nombreCliente,  setNombreCliente]  = useState("");

  const [historialOpen, setHistorialOpen] = useState(false);
  const [configOpen,    setConfigOpen]    = useState(false);

  // Cobro de multa: mismo panel tanto si se dispara justo al devolver como
  // si se cobra después desde "Deudas pendientes" -- por eso guarda el
  // préstamo entero, no depende de que siga en prestamosAbiertos.
  const [cobrando, setCobrando] = useState<Prestamo | null>(null);
  const [pagos,    setPagos]    = useState<Pagos>(pagosVacios());

  const prestamoDeTermo = new Map(prestamosAbiertos.map((p) => [p.termo_id, p]));
  const sucursalActiva = sucursales.find((s) => s.id === (sucursalFija ?? sucursalFiltro));
  const sucursalActivaId = sucursalActiva?.id ?? "";
  const horasLimite = sucursalActiva?.termo_horas_limite ?? 6;
  const tarifaHora   = sucursalActiva?.termo_tarifa_multa_hora ?? 0;

  const [horasLimiteInput, setHorasLimiteInput] = useState(String(horasLimite));
  const [tarifaHoraInput,  setTarifaHoraInput]  = useState(String(tarifaHora));

  const termosSucursal      = termos.filter((t) => t.sucursal_id === sucursalActivaId);
  const termosVisibles      = tipoFiltro === "todos" ? termosSucursal : termosSucursal.filter((t) => t.tipo === tipoFiltro);
  const deudasVisibles      = deudasPendientes.filter((d) => d.sucursal_id === sucursalActivaId);
  const historialVisible    = historial.filter((h) => h.sucursal_id === sucursalActivaId);

  const disponibles = termosVisibles.filter((t) => t.estado === "disponible").length;
  const prestados    = termosVisibles.filter((t) => t.estado === "prestado").length;
  const cantFrios     = termosSucursal.filter((t) => t.tipo === "frio").length;
  const cantCalientes = termosSucursal.filter((t) => t.tipo === "caliente").length;

  function abrirConfig() {
    setHorasLimiteInput(String(horasLimite));
    setTarifaHoraInput(String(tarifaHora));
    setConfigOpen(true);
  }

  function handleGuardarConfig() {
    setError(null);
    const horas   = parseFloat(horasLimiteInput);
    const tarifa  = parseFloat(tarifaHoraInput);
    if (isNaN(horas) || horas < 0)  { setError("Ingresá un número de horas válido"); return; }
    if (isNaN(tarifa) || tarifa < 0) { setError("Ingresá una tarifa válida"); return; }
    startTransition(async () => {
      const res = await actualizarConfigMulta({ sucursal_id: sucursalActivaId, termo_horas_limite: horas, termo_tarifa_multa_hora: tarifa });
      if (res.error) { setError(res.error); return; }
      setConfigOpen(false);
      router.refresh();
    });
  }

  function handleCrearTermo() {
    setError(null);
    const numero = nuevoNumero.trim();
    if (!numero) { setError("Ingresá un número de termo"); return; }
    startTransition(async () => {
      const res = await crearTermo({ sucursal_id: sucursalActivaId, numero, tipo: nuevoTipo });
      if (res.error) { setError(res.error); return; }
      setNuevoNumero(""); setNuevoTipo("caliente"); setNuevoOpen(false);
      router.refresh();
    });
  }

  function handlePrestar(termoId: string, sucursalId: string) {
    setError(null);
    const dniLimpio = dni.trim();
    if (!dniLimpio) { setError("Ingresá el DNI"); return; }
    const telefonoLimpio = telefono.trim();
    if (!telefonoLimpio) { setError("Ingresá el teléfono"); return; }
    startTransition(async () => {
      const res = await prestarTermo({ sucursal_id: sucursalId, termo_id: termoId, dni: dniLimpio, telefono: telefonoLimpio, nombre: nombreCliente.trim() || null });
      if (res.error) { setError(res.error); return; }
      setPrestarTermoId(null); setDni(""); setTelefono(""); setNombreCliente("");
      router.refresh();
    });
  }

  function handleDevolver(prestamo: Prestamo) {
    setError(null);
    startTransition(async () => {
      const res = await devolverTermo({ prestamo_id: prestamo.id, sucursal_id: prestamo.sucursal_id });
      if (res.error) { setError(res.error); return; }
      if (res.monto_multa && res.monto_multa > 0) {
        setCobrando({ ...prestamo, monto_multa: res.monto_multa });
        setPagos(pagosVacios());
      }
      router.refresh();
    });
  }

  function handleCobrarMulta() {
    if (!cobrando) return;
    setError(null);
    const efectivo      = parseFloat(pagos.efectivo)      || 0;
    const billetera     = parseFloat(pagos.billetera)     || 0;
    const tarjeta       = parseFloat(pagos.tarjeta)       || 0;
    const transferencia = parseFloat(pagos.transferencia) || 0;
    const total = efectivo + billetera + tarjeta + transferencia;
    if (Math.round(total * 100) !== Math.round(cobrando.monto_multa * 100)) {
      setError(`Lo ingresado (${AR.format(total)}) tiene que sumar exactamente ${AR.format(cobrando.monto_multa)}`);
      return;
    }
    startTransition(async () => {
      const res = await pagarMultaTermo({
        prestamo_id: cobrando.id, sucursal_id: cobrando.sucursal_id,
        pago_efectivo: efectivo, pago_billetera: billetera, pago_tarjeta: tarjeta, pago_transferencia: transferencia,
      });
      if (res.error) { setError(res.error); return; }
      setCobrando(null); setPagos(pagosVacios());
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
            {deudasVisibles.length > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1.5 rounded-full bg-danger/5 text-danger border border-danger/20">
                {deudasVisibles.length} con multa sin pagar
              </span>
            )}
          </div>
          <div className="flex gap-1.5">
            {([
              ["todos", `Todos (${termosSucursal.length})`],
              ["frio", `🧊 Frío (${cantFrios})`],
              ["caliente", `☕ Caliente (${cantCalientes})`],
            ] as const).map(([valor, label]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setTipoFiltro(valor)}
                className={`text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors ${
                  tipoFiltro === valor
                    ? "bg-tierra-700 text-white border-tierra-700"
                    : "bg-white text-neutral-500 border-neutral-200 hover:bg-neutral-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {puedeGestionar && (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={abrirConfig}>Tarifa de multa</Button>
            <Button variant="ghost" size="sm" onClick={() => setNuevoOpen((v) => !v)}>+ Nuevo termo</Button>
          </div>
        )}
      </div>

      {configOpen && (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Tarifa de multa por atraso — {sucursalActiva?.nombre}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-neutral-500 block mb-1.5">Horas de gracia</label>
              <input
                type="number" min="0" step="0.5"
                value={horasLimiteInput}
                onChange={(e) => setHorasLimiteInput(e.target.value)}
                className="h-10 w-28 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-neutral-500 block mb-1.5">$ por hora de atraso</label>
              <input
                type="number" min="0" step="1"
                value={tarifaHoraInput}
                onChange={(e) => setTarifaHoraInput(e.target.value)}
                className="h-10 w-32 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
              />
            </div>
            <Button variant="primary" size="sm" loading={pending} onClick={handleGuardarConfig}>Guardar</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfigOpen(false)}>Cancelar</Button>
          </div>
          <p className="text-[11px] text-neutral-400">
            Un alquiler devuelto dentro de las {horasLimite} hs no genera multa. Después, se cobra {AR.format(tarifaHora)} por cada hora (o fracción) de atraso, sin tope.
          </p>
        </div>
      )}

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
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-neutral-500 block mb-1.5">Tipo</label>
            <select
              value={nuevoTipo}
              onChange={(e) => setNuevoTipo(e.target.value as "frio" | "caliente")}
              className="h-10 w-36 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700"
            >
              <option value="caliente">☕ Caliente</option>
              <option value="frio">🧊 Frío</option>
            </select>
          </div>
          <Button variant="primary" size="sm" loading={pending} onClick={handleCrearTermo}>Agregar</Button>
          <Button variant="ghost" size="sm" onClick={() => { setNuevoOpen(false); setNuevoNumero(""); setNuevoTipo("caliente"); setError(null); }}>Cancelar</Button>
        </div>
      )}

      {error && <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}

      {/* Cobro de multa -- se abre solo al devolver un termo con atraso, o a
          mano desde "Deudas pendientes" más abajo */}
      {cobrando && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 space-y-3">
          <p className="text-sm font-semibold text-danger">
            Multa a cobrar — DNI {cobrando.dni}{cobrando.nombre ? ` (${cobrando.nombre})` : ""} · Tel: {cobrando.telefono}: {AR.format(cobrando.monto_multa)}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {([
              ["efectivo", "Efectivo"], ["billetera", "Billetera"], ["tarjeta", "Tarjeta"], ["transferencia", "Transferencia"],
            ] as const).map(([key, label]) => (
              <div key={key}>
                <label className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 block mb-1">{label}</label>
                <input
                  type="number" min="0" step="1"
                  value={pagos[key]}
                  onChange={(e) => setPagos((p) => ({ ...p, [key]: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2.5 text-sm focus:outline-none focus:border-tierra-700"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" loading={pending} onClick={handleCobrarMulta}>Confirmar cobro</Button>
            <Button variant="ghost" size="sm" onClick={() => { setCobrando(null); setError(null); }}>Dejar pendiente</Button>
          </div>
          <p className="text-[11px] text-neutral-400">
            Si dejás pendiente, la deuda queda asociada al DNI y no se le va a poder alquilar otro termo hasta que la pague (podés cobrarla después desde "Deudas pendientes").
          </p>
        </div>
      )}

      {/* Deudas pendientes -- multas ya calculadas (termo ya devuelto) que
          todavía no se cobraron */}
      {deudasVisibles.length > 0 && !cobrando && (
        <div className="rounded-xl border border-danger/20 bg-white overflow-hidden">
          <p className="text-xs font-semibold uppercase tracking-widest text-danger px-4 pt-3">Deudas pendientes</p>
          <div className="divide-y divide-neutral-50">
            {deudasVisibles.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <span className="text-sm font-semibold text-neutral-900">DNI {d.dni}</span>
                  {d.nombre && <span className="text-sm text-neutral-500"> — {d.nombre}</span>}
                  <span className="text-xs text-neutral-400 ml-2">Tel: {d.telefono}</span>
                  <span className="text-xs text-danger font-semibold ml-2">{AR.format(d.monto_multa)}</span>
                </div>
                <Button variant="primary" size="sm" onClick={() => { setCobrando(d); setPagos(pagosVacios()); setError(null); }}>Cobrar</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lista de termos */}
      <div className="space-y-2">
        {termosVisibles.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-400">
            Todavía no hay termos cargados en esta sucursal.
          </div>
        ) : (
          termosVisibles.map((t) => {
            const prestamo = prestamoDeTermo.get(t.id);
            const horasAtraso = prestamo ? horasAtrasoEstimadas(prestamo.fecha_prestamo, horasLimite) : 0;
            return (
              <div key={t.id} className="rounded-xl border border-neutral-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-bold font-display text-neutral-900">Termo N° {t.numero}</span>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${TIPO_COLOR[t.tipo]}`}>
                      {TIPO_LABEL[t.tipo]}
                    </span>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${ESTADO_COLOR[t.estado]}`}>
                      {ESTADO_LABEL[t.estado]}
                    </span>
                    {horasAtraso > 0 && tarifaHora > 0 && (
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full border bg-danger/5 text-danger border-danger/20">
                        ⚠ {horasAtraso}h de atraso — ≈{AR.format(horasAtraso * tarifaHora)}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {t.estado === "disponible" && (
                      <Button variant="primary" size="sm" onClick={() => { setPrestarTermoId(t.id); setDni(""); setTelefono(""); setNombreCliente(""); setError(null); }}>
                        Prestar
                      </Button>
                    )}
                    {t.estado === "prestado" && prestamo && (
                      <Button variant="primary" size="sm" loading={pending} onClick={() => handleDevolver(prestamo)}>
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
                    <span className="text-neutral-600">Tel: <span className="font-semibold text-neutral-900">{prestamo.telefono}</span></span>
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
                      <label className="text-xs font-medium uppercase tracking-wide text-neutral-500 block mb-1.5">Teléfono *</label>
                      <input
                        type="text"
                        inputMode="tel"
                        value={telefono}
                        onChange={(e) => setTelefono(e.target.value)}
                        placeholder="Ej: 3764123456"
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
                    <Button variant="ghost" size="sm" onClick={() => { setPrestarTermoId(null); setTelefono(""); setError(null); }}>Cancelar</Button>
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
              <table className="w-full text-sm" style={{ minWidth: "560px" }}>
                <thead>
                  <tr className="bg-neutral-50 border-b border-neutral-200">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Termo</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">DNI</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Prestado</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Devuelto</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Multa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50">
                  {historialVisible.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-neutral-400">Sin devoluciones registradas todavía.</td></tr>
                  ) : (
                    historialVisible.map((h) => {
                      const termoNumero = termos.find((t) => t.id === h.termo_id)?.numero ?? "—";
                      return (
                        <tr key={h.id}>
                          <td className="px-3 py-2.5 font-medium text-neutral-800">N° {termoNumero}</td>
                          <td className="px-3 py-2.5 text-neutral-600">{h.dni}{h.nombre ? ` — ${h.nombre}` : ""}</td>
                          <td className="px-3 py-2.5 text-neutral-500 text-xs">{new Date(h.fecha_prestamo).toLocaleString("es-AR")}</td>
                          <td className="px-3 py-2.5 text-neutral-500 text-xs">{h.fecha_devolucion ? new Date(h.fecha_devolucion).toLocaleString("es-AR") : "—"}</td>
                          <td className="px-3 py-2.5 text-right">
                            {h.monto_multa > 0 ? (
                              <span className={h.multa_pagada_en ? "text-selva-700 font-semibold" : "text-danger font-semibold"}>
                                {AR.format(h.monto_multa)} {h.multa_pagada_en ? "✓" : "(pendiente)"}
                              </span>
                            ) : <span className="text-neutral-300">—</span>}
                          </td>
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
