"use client";

import { useState } from "react";
import type { ConfigTienda, FormCheckout } from "../_lib/tipos";
import { fmt } from "../_lib/tema";
import { telefonoValido } from "@/lib/pedidos/validaciones";
import type { EstadoHorario } from "@/lib/pedidos/horario";
import { IconAtras } from "./iconos";
import { Panel } from "./panel";

const campoBase =
  "w-full rounded-[14px] border-[1.5px] bg-white px-4 text-[16px] text-pd-ink-900 placeholder:text-pd-ink-300 focus:outline-none";

function claseCampo(error?: string) {
  return `${campoBase} ${error ? "border-pd-ember" : "border-pd-line-strong focus:border-pd-ink-900"}`;
}

function MsgError({ texto }: { texto?: string }) {
  return texto ? <p className="mt-1 text-[12.5px] font-medium text-pd-ember">{texto}</p> : null;
}

function Opcion({ activa, onClick, titulo, detalle, derecha, deshabilitada }: {
  activa: boolean; onClick: () => void; titulo: string; detalle?: string; derecha?: React.ReactNode; deshabilitada?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitada}
      aria-pressed={activa}
      className={`flex w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition-colors disabled:opacity-45 ${
        activa ? "border-pd-ember bg-pd-tint" : "border-pd-line bg-white"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[15px] font-bold text-pd-ink-900">{titulo}</span>
        {detalle && <span className="mt-0.5 block text-[12.5px] text-pd-ink-400">{detalle}</span>}
      </span>
      {derecha}
    </button>
  );
}

export function CheckoutScreen({ config, form, setForm, subtotal, cantidadProductos, horario, enviando, errorServidor, onVolver, onAgregarMas, onConfirmar }: {
  config:            ConfigTienda;
  form:              FormCheckout;
  setForm:           (parcial: Partial<FormCheckout>) => void;
  subtotal:          number;
  cantidadProductos: number;
  horario:           EstadoHorario;
  enviando:          boolean;
  errorServidor:     string | null;
  onVolver:          () => void;
  onAgregarMas:      () => void;
  onConfirmar:       () => void;
}) {
  const [errores, setErrores] = useState<Record<string, string>>({});

  const enviosDisponibles = config.deliveryHabilitado && config.zonas.length > 0;
  const zona = form.modo === "envio" ? config.zonas.find((z) => z.id === form.zonaId) ?? null : null;
  const costoEnvio = zona?.costo ?? 0;
  const total = subtotal + costoEnvio;
  const faltaMinimo = form.modo === "envio" && config.minimoEnvio > 0 && subtotal < config.minimoEnvio
    ? config.minimoEnvio - subtotal : 0;

  const eta = form.modo === "envio"
    ? (zona ? `${zona.etaMin}–${zona.etaMax} min` : null)
    : `${config.retiroEtaMin}–${config.retiroEtaMax} min`;
  const textoEta = form.modo === "envio"
    ? (eta ? `Tiempo estimado de entrega: ${eta}` : "Elegí una zona para ver el tiempo estimado")
    : `Listo para retirar en ${eta}`;

  function validar(): boolean {
    const e: Record<string, string> = {};
    if (form.modo === "envio") {
      if (!form.zonaId) e["pd-f-zona"] = "Elegí la zona de entrega";
      if (!form.calle.trim()) e["pd-f-calle"] = "Escribí la calle y el número";
      if (!form.referencia.trim()) e["pd-f-referencia"] = "Agregá una referencia (entre calles, portón, color de casa)";
    }
    if (form.nombre.trim().length < 2) e["pd-f-nombre"] = "Escribí tu nombre";
    if (!telefonoValido(form.whatsapp)) e["pd-f-whatsapp"] = "Escribí tu WhatsApp con característica (10 dígitos)";
    if (form.pago === "efectivo" && form.pagoCon.trim()) {
      const n = parseInt(form.pagoCon.replace(/\D/g, ""), 10);
      if (!(n >= total)) e["pd-f-pagocon"] = `Tiene que ser al menos ${fmt(total)}`;
    }
    setErrores(e);
    const primero = Object.keys(e)[0];
    if (primero) {
      const el = document.getElementById(primero);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => el?.focus({ preventScroll: true }), 250);
      return false;
    }
    return true;
  }

  function confirmar() {
    if (faltaMinimo > 0 || enviando) return;
    if (validar()) onConfirmar();
  }

  const textoBoton = enviando
    ? "Enviando…"
    : !horario.abierto
      ? `Dejar pedido para ${horario.proximaApertura ?? "cuando abramos"}`
      : `Confirmar pedido · ${fmt(total)}`;

  return (
    <Panel>
      <div className="flex items-center gap-3 border-b border-pd-line bg-white px-4 pb-3 pt-5">
        <button type="button" onClick={onVolver} aria-label="Volver" className="flex size-11 items-center justify-center rounded-[14px] border border-pd-line bg-pd-tint text-pd-ink-900">
          <IconAtras className="size-5" />
        </button>
        <h2 className="text-[22px] text-pd-ink-900">¿Cómo te lo llevamos?</h2>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-8 pt-4">
        {/* 1. Modo de entrega */}
        <div className="grid grid-cols-2 gap-3">
          <Opcion
            activa={form.modo === "envio"}
            deshabilitada={!enviosDisponibles}
            onClick={() => setForm({ modo: "envio", zonaId: form.zonaId ?? config.zonas[0]?.id ?? null })}
            titulo="Envío"
            detalle={enviosDisponibles ? "a tu casa" : "no disponible"}
          />
          <Opcion
            activa={form.modo === "retiro"}
            deshabilitada={!config.retiroHabilitado}
            onClick={() => setForm({ modo: "retiro" })}
            titulo="Retiro"
            detalle={config.retiroHabilitado ? "en el local · gratis" : "no disponible"}
          />
        </div>

        {/* 2. Zona / retiro: costo y tiempo ANTES de pedir datos */}
        {form.modo === "envio" ? (
          <section aria-labelledby="pd-zona-t">
            <h3 id="pd-zona-t" className="mb-2.5 text-[13.5px] font-bold !tracking-normal">Zona de entrega</h3>
            <div id="pd-f-zona" tabIndex={-1} className="space-y-2.5 outline-none">
              {config.zonas.map((z) => (
                <Opcion
                  key={z.id}
                  activa={form.zonaId === z.id}
                  onClick={() => setForm({ zonaId: z.id })}
                  titulo={z.nombre}
                  detalle={`Llega en ${z.etaMin}–${z.etaMax} min`}
                  derecha={<span className="pd-display text-[17px] font-extrabold tabular-nums">{fmt(z.costo)}</span>}
                />
              ))}
            </div>
            <MsgError texto={errores["pd-f-zona"]} />
            <p className="mt-2 text-[12.5px] leading-snug text-pd-ink-400">
              {config.minimoEnvio > 0 && <>Pedido mínimo para envío: {fmt(config.minimoEnvio)}. </>}
              Si tu barrio no está en la lista, escribinos y lo vemos.
            </p>
          </section>
        ) : (
          <section className="rounded-2xl border border-pd-line bg-white p-4">
            <p className="text-[14.5px] font-bold">{config.nombre}</p>
            {(config.direccion || config.localidad) && (
              <p className="mt-0.5 text-[13px] text-pd-ink-600">{[config.direccion, config.localidad].filter(Boolean).join(", ")}</p>
            )}
            <p className="mt-2 text-[13px] text-pd-ink-600">Listo para retirar en {config.retiroEtaMin}–{config.retiroEtaMax} min. Te avisamos por WhatsApp cuando esté.</p>
          </section>
        )}

        {/* 3. Dirección (solo envío) */}
        {form.modo === "envio" && (
          <section aria-labelledby="pd-dir-t" className="space-y-2.5">
            <h3 id="pd-dir-t" className="text-[13.5px] font-bold !tracking-normal">Dirección</h3>
            <div>
              <input id="pd-f-calle" value={form.calle} onChange={(e) => setForm({ calle: e.target.value })} placeholder="Calle y número" autoComplete="street-address" className={`${claseCampo(errores["pd-f-calle"])} h-[50px]`} />
              <MsgError texto={errores["pd-f-calle"]} />
            </div>
            <div>
              <input id="pd-f-referencia" value={form.referencia} onChange={(e) => setForm({ referencia: e.target.value })} placeholder="Entre calles / referencia (portón, casa)" className={`${claseCampo(errores["pd-f-referencia"])} h-[50px]`} />
              <MsgError texto={errores["pd-f-referencia"]} />
            </div>
          </section>
        )}

        {/* 4. Datos */}
        <section aria-labelledby="pd-datos-t" className="space-y-2.5">
          <h3 id="pd-datos-t" className="text-[13.5px] font-bold !tracking-normal">Tus datos</h3>
          <div>
            <input id="pd-f-nombre" value={form.nombre} onChange={(e) => setForm({ nombre: e.target.value })} placeholder="Nombre" autoComplete="name" className={`${claseCampo(errores["pd-f-nombre"])} h-[50px]`} />
            <MsgError texto={errores["pd-f-nombre"]} />
          </div>
          <div>
            <input id="pd-f-whatsapp" value={form.whatsapp} onChange={(e) => setForm({ whatsapp: e.target.value })} placeholder="WhatsApp" type="tel" inputMode="tel" autoComplete="tel" className={`${claseCampo(errores["pd-f-whatsapp"])} h-[50px]`} />
            <MsgError texto={errores["pd-f-whatsapp"]} />
          </div>
          <textarea value={form.notas} onChange={(e) => setForm({ notas: e.target.value })} placeholder="Aclaraciones del pedido (opcional): sin sal, bien frío…" rows={2} className={`${claseCampo()} py-3`} />
        </section>

        {/* 5. Pago */}
        <section aria-labelledby="pd-pago-t" className="space-y-2.5">
          <h3 id="pd-pago-t" className="text-[13.5px] font-bold !tracking-normal">Pago</h3>
          <Opcion
            activa={form.pago === "efectivo"}
            onClick={() => setForm({ pago: "efectivo" })}
            titulo="Efectivo"
            detalle={form.modo === "envio" ? "Avisanos con cuánto pagás y llevamos el vuelto" : "Pagás cuando retirás el pedido"}
          />
          <Opcion
            activa={form.pago === "mercadopago_link"}
            onClick={() => setForm({ pago: "mercadopago_link" })}
            titulo="Mercado Pago"
            detalle="Te mandamos el link por WhatsApp"
          />
          {form.pago === "efectivo" && (
            <div>
              <input id="pd-f-pagocon" value={form.pagoCon} onChange={(e) => setForm({ pagoCon: e.target.value.replace(/[^\d]/g, "") })} placeholder="¿Con cuánto pagás? (para el vuelto)" inputMode="numeric" className={`${claseCampo(errores["pd-f-pagocon"])} h-[50px]`} />
              <MsgError texto={errores["pd-f-pagocon"]} />
            </div>
          )}
        </section>

        {/* 6. Resumen */}
        <section className="rounded-[20px] border border-pd-line bg-white p-4">
          <div className="flex justify-between text-[14px] text-pd-ink-600">
            <span>Productos ({cantidadProductos})</span><span className="pd-display font-bold tabular-nums text-pd-ink-900">{fmt(subtotal)}</span>
          </div>
          <div className="mt-1.5 flex justify-between text-[14px] text-pd-ink-600">
            <span>{form.modo === "envio" ? `Envío${zona ? ` · ${zona.nombre}` : ""}` : "Retiro en el local"}</span>
            <span className="pd-display font-bold tabular-nums text-pd-ink-900">{form.modo === "envio" ? (zona ? fmt(costoEnvio) : "—") : "Gratis"}</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-pd-line pt-3">
            <span className="text-[15px] font-bold">Total</span>
            <span className="pd-display text-[24px] font-extrabold tabular-nums text-pd-ember" aria-live="polite">{fmt(total)}</span>
          </div>
        </section>
      </div>

      {/* 7. Footer fijo */}
      <div className="border-t border-pd-line bg-white px-4 pb-6 pt-3.5">
        {errorServidor && <p className="mb-2 rounded-xl bg-pd-tint px-3 py-2 text-[13px] font-medium text-pd-ember">{errorServidor}</p>}
        {faltaMinimo > 0 ? (
          <div className="rounded-2xl border border-pd-tint-line bg-pd-tint px-4 py-3">
            <p className="text-[14px] font-bold text-pd-ember">Te faltan {fmt(faltaMinimo)} para el mínimo de envío</p>
            <button type="button" onClick={onAgregarMas} className="mt-1 text-[13px] font-semibold text-pd-ink-900 underline">Agregar algo más</button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={confirmar}
              disabled={enviando}
              className="pd-display h-14 w-full rounded-2xl bg-pd-ember text-[17px] font-bold text-white disabled:opacity-60 active:bg-pd-ember-dark"
              style={{ boxShadow: "0 16px 30px -14px rgba(217,63,30,.75)" }}
            >
              {textoBoton}
            </button>
            <p className="mt-2 text-center text-[12.5px] text-pd-ink-400">{textoEta}</p>
          </>
        )}
      </div>
    </Panel>
  );
}
