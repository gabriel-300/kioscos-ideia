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

import { calcularBeneficio } from "@/lib/pedidos/beneficio-cliente";
import { BeneficioCliente } from "./beneficio-cliente";
import { pedirUbicacion } from "@/lib/geolocalizar";
import { ingresarConGoogle } from "@/lib/pedidos/acceso-cliente";
import { sugerirLocalMasCercano, verificarAlcance } from "@/lib/pedidos/alcance-envio";
import { formatearDistancia } from "@/lib/geo";

export function CheckoutScreen({ config, form, setForm, ubicacion, setUbicacion, envioNoDisponible, subtotal, cantidadProductos, horario, enviando, errorServidor, ajusteStock = null, onVolver, onAgregarMas, onConfirmar }: {
  config:            ConfigTienda;
  form:              FormCheckout;
  setForm:           (parcial: Partial<FormCheckout>) => void;
  ubicacion:         { lat: number; lng: number } | null;
  setUbicacion:      (u: { lat: number; lng: number } | null) => void;
  envioNoDisponible: string | null; // el envío está cortado ahora (fuera de su horario o suspendido): el mensaje para el cliente
  subtotal:          number;
  cantidadProductos: number;
  horario:           EstadoHorario;
  enviando:          boolean;
  errorServidor:     string | null;
  ajusteStock?:      { texto: string; alAjustar: () => void } | null; // un producto no alcanzó: mensaje claro y botón para ajustar
  onVolver:          () => void;
  onAgregarMas:      () => void;
  onConfirmar:       () => void;
}) {
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [buscandoUbicacion, setBuscandoUbicacion] = useState(false);
  const [errorUbicacion, setErrorUbicacion] = useState<string | null>(null);

  async function compartirUbicacion() {
    setErrorUbicacion(null);
    setBuscandoUbicacion(true);
    const r = await pedirUbicacion("retirá en el local");
    setBuscandoUbicacion(false);
    if ("error" in r) { setErrorUbicacion(r.error); return; }
    setUbicacion(r.punto);
    setErrores((prev) => { const { ["pd-f-ubicacion"]: _u, ...resto } = prev; return resto; });
  }

  const enviosDisponibles = config.deliveryHabilitado && config.zonas.length > 0 && !envioNoDisponible;
  const zona = form.modo === "envio" ? config.zonas.find((z) => z.id === form.zonaId) ?? null : null;
  // Doble chequeo de ubicación: que la zona llegue hasta donde se pide, y que no haya otro local claramente más cerca.
  const alcance = zona && ubicacion ? verificarAlcance(ubicacion, config.ubicacionLocal ?? null, zona.radioKm, zona.nombre) : ({ ok: true } as const);
  const sugerencia = form.modo === "envio" && ubicacion ? sugerirLocalMasCercano(ubicacion, config.sucursalId, config.localesCercania ?? []) : null;
  // Misma cuenta que hace el servidor al cobrar (beneficio-cliente.ts): esto es solo la vista previa.
  const beneficio = calcularBeneficio({
    subtotal,
    esCliente:       !!config.cliente,
    esPrimeraCompra: config.cliente?.primeraCompra ?? false,
    esDelivery:      form.modo === "envio",
    config:          config.beneficio,
  });
  const costoEnvio = beneficio.envioBonificado ? 0 : (zona?.costo ?? 0);
  const total = subtotal - beneficio.descuentoProductos + costoEnvio;
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
      // El envío se hace a la ubicación del GPS: no se escribe dirección.
      if (!ubicacion) e["pd-f-ubicacion"] = "Compartí tu ubicación para que el repartidor te encuentre";
      else if (!alcance.ok) e["pd-f-ubicacion"] = alcance.mensaje;
      if (form.referencia.trim().length < 3) e["pd-f-referencia"] = "Escribí el aula, piso o dirección para que el repartidor te encuentre";
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
        <BeneficioCliente config={config} />

        {/* 1. Modo de entrega */}
        <div className="grid grid-cols-2 gap-3">
          <Opcion
            activa={form.modo === "envio"}
            deshabilitada={!enviosDisponibles}
            onClick={() => setForm({ modo: "envio", zonaId: form.zonaId ?? config.zonas[0]?.id ?? null })}
            titulo="Envío"
            detalle={enviosDisponibles ? "a mi ubicación" : envioNoDisponible ? "no disponible ahora" : "no disponible"}
          />
          <Opcion
            activa={form.modo === "retiro"}
            deshabilitada={!config.retiroHabilitado}
            onClick={() => setForm({ modo: "retiro" })}
            titulo="Retiro"
            detalle={config.retiroHabilitado ? "en el local · gratis" : "no disponible"}
          />
        </div>

        {envioNoDisponible && (
          <p role="status" className="-mt-3 rounded-xl border border-pd-line bg-white px-4 py-3 text-[13.5px] leading-snug text-pd-ink-600">{envioNoDisponible}</p>
        )}

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
            <h3 id="pd-dir-t" className="text-[13.5px] font-bold !tracking-normal">Tu ubicación</h3>
            <div id="pd-f-ubicacion">
              {ubicacion ? (
                <div className="flex items-center justify-between gap-3 rounded-[14px] border border-pd-success/40 bg-pd-success/10 px-3.5 py-3">
                  <p className="text-[14px] font-semibold text-pd-success">📍 Ubicación guardada</p>
                  <button type="button" onClick={() => setUbicacion(null)} className="text-[13px] font-semibold text-pd-ink-600 underline">Quitar</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={compartirUbicacion}
                  disabled={buscandoUbicacion}
                  className="pd-display flex h-[50px] w-full items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-pd-ember bg-pd-tint text-[14.5px] font-bold text-pd-ember disabled:opacity-60"
                >
                  {buscandoUbicacion ? "Buscando tu ubicación…" : "📍 Usar mi ubicación actual"}
                </button>
              )}
              {errorUbicacion && <p role="status" className="mt-2 rounded-xl bg-pd-warm px-3.5 py-2.5 text-[13px] leading-snug text-pd-ink-600">{errorUbicacion}</p>}
              <p className="mt-1.5 px-1 text-[12px] leading-snug text-pd-ink-400">
                {ubicacion
                  ? "Se la mostramos solo al local y al repartidor, para que te encuentre. Si hace falta aclarar algo (portón, color de casa), escribilo en las aclaraciones del pedido."
                  : "Es obligatoria para el envío: así el repartidor llega exacto. Solo se usa para esta entrega."}
              </p>
              <MsgError texto={errores["pd-f-ubicacion"]} />
              {ubicacion && !alcance.ok && !errores["pd-f-ubicacion"] && (
                <p role="alert" className="mt-2 rounded-xl border border-pd-line-strong bg-pd-warm px-3.5 py-2.5 text-[13px] font-semibold leading-snug text-pd-ink-900">{alcance.mensaje}</p>
              )}
              {sugerencia && (
                <div role="status" className="mt-2 rounded-xl border border-pd-line-strong bg-white px-3.5 py-3">
                  <p className="text-[13.5px] font-semibold leading-snug text-pd-ink-900">
                    Estás más cerca de {sugerencia.local.nombre} ({formatearDistancia(sugerencia.km)}) que de este local ({formatearDistancia(sugerencia.kmActual)}).
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-pd-ink-600">Cada local tiene su propio menú y stock: si cambiás, se arma un pedido nuevo allá.</p>
                  <a href={`/${sugerencia.local.slug}`} className="pd-display mt-2 inline-flex h-10 items-center rounded-full bg-pd-ember px-5 text-[13.5px] font-bold" style={{ color: "#fff" }}>
                    Pedir en {sugerencia.local.nombre.replace(/^angiru food\s+/i, "")}
                  </a>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="pd-f-referencia" className="mb-1 block text-[13px] font-semibold text-pd-ink-900">Aula, piso o dirección <span className="text-pd-ember">*</span></label>
              <input
                id="pd-f-referencia"
                value={form.referencia}
                onChange={(e) => setForm({ referencia: e.target.value })}
                maxLength={150}
                autoComplete="off"
                placeholder="Ej.: Aula 12, 2.º piso · o calle y número"
                className={`${claseCampo(errores["pd-f-referencia"])} h-[50px]`}
              />
              <MsgError texto={errores["pd-f-referencia"]} />
              <p className="mt-1 px-1 text-[12px] leading-snug text-pd-ink-400">Lo pedimos en cada pedido, así el repartidor te encuentra aunque estés en otro lugar.</p>
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
          {config.efectivoSucursal && (
            config.puedeEfectivo ? (
              <Opcion
                activa={form.pago === "efectivo"}
                onClick={() => setForm({ pago: "efectivo" })}
                titulo="Efectivo"
                detalle={form.modo === "envio" ? "Avisanos con cuánto pagás y llevamos el vuelto" : "Pagás cuando retirás el pedido"}
              />
            ) : (
              <Opcion
                activa={false}
                onClick={() => { void ingresarConGoogle(); }}
                titulo="Efectivo"
                detalle="Para pagar en efectivo ingresá con Google (tocá acá)"
              />
            )
          )}
          <Opcion
            activa={form.pago === "mercadopago_link"}
            onClick={() => setForm({ pago: "mercadopago_link" })}
            titulo="Mercado Pago"
            detalle="Pagás online con tarjeta o dinero en cuenta, al terminar el pedido"
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
          {beneficio.descuentoProductos > 0 && (
            <div className="mt-1.5 flex justify-between text-[14px] text-pd-success">
              <span>Descuento cliente registrado</span><span className="pd-display font-bold tabular-nums">−{fmt(beneficio.descuentoProductos)}</span>
            </div>
          )}
          <div className="mt-1.5 flex justify-between text-[14px] text-pd-ink-600">
            <span>{form.modo === "envio" ? `Envío${zona ? ` · ${zona.nombre}` : ""}` : "Retiro en el local"}</span>
            <span className="pd-display font-bold tabular-nums text-pd-ink-900">{form.modo === "envio" ? (zona ? (beneficio.envioBonificado ? "Gratis" : fmt(costoEnvio)) : "—") : "Gratis"}</span>
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-pd-line pt-3">
            <span className="text-[15px] font-bold">Total</span>
            <span className="pd-display text-[24px] font-extrabold tabular-nums text-pd-ember" aria-live="polite">{fmt(total)}</span>
          </div>
        </section>
      </div>

      {/* 7. Footer fijo */}
      <div className="border-t border-pd-line bg-white px-4 pb-6 pt-3.5">
        {ajusteStock ? (
          <div role="alert" className="mb-2 rounded-xl border border-pd-line-strong bg-pd-warm px-3.5 py-3">
            <p className="text-[13.5px] font-semibold leading-snug text-pd-ink-900">{ajusteStock.texto}</p>
            <button type="button" onClick={ajusteStock.alAjustar} className="pd-display mt-2.5 inline-flex h-10 items-center rounded-full bg-pd-ember px-5 text-[13.5px] font-bold" style={{ color: "#fff" }}>
              Ajustar mi pedido
            </button>
          </div>
        ) : errorServidor && <p className="mb-2 rounded-xl bg-pd-tint px-3 py-2 text-[13px] font-medium text-pd-ember">{errorServidor}</p>}
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
