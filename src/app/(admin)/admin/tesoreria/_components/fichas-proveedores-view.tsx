"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CONDICIONES_IVA, DA_FACTURA, FORMAS_PAGO, RUBROS, etiquetaDe, faltantes,
  type FichaEntrada, type FichaProveedor,
} from "@/lib/tesoreria/proveedores-ficha";
import { actualizarProveedorFicha, crearProveedorFicha } from "../proveedores-ficha-actions";

const etiqueta = "text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5";
const campo = "h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700";

const cuitConGuiones = (c: string | null) => (c && c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c);

type Estado = {
  nombre: string; razon_social: string; cuit: string; condicion_iva: string; da_factura: string; rubro: string; forma_pago: string;
  plazo: string; alias_cbu: string; contacto: string; email: string; notas: string;
};

const vacio: Estado = {
  nombre: "", razon_social: "", cuit: "", condicion_iva: "", da_factura: "", rubro: "", forma_pago: "", plazo: "", alias_cbu: "", contacto: "", email: "", notas: "",
};

const deFicha = (f: FichaProveedor): Estado => ({
  nombre: f.nombre, razon_social: f.razon_social ?? "", cuit: cuitConGuiones(f.cuit) ?? "", condicion_iva: f.condicion_iva ?? "", da_factura: f.da_factura ?? "",
  rubro: f.rubro ?? "", forma_pago: f.forma_pago ?? "", plazo: f.plazo_pago_dias !== null ? String(f.plazo_pago_dias) : "", alias_cbu: f.alias_cbu ?? "",
  contacto: f.contacto ?? "", email: f.email ?? "", notas: f.notas ?? "",
});

function aEntrada(e: Estado): FichaEntrada {
  const plazo = e.plazo.trim() === "" ? null : Number(e.plazo);
  return {
    nombre: e.nombre, razon_social: e.razon_social, cuit: e.cuit, condicion_iva: e.condicion_iva, da_factura: e.da_factura, rubro: e.rubro,
    forma_pago: e.forma_pago, plazo_pago_dias: plazo !== null && Number.isNaN(plazo) ? -1 : plazo, alias_cbu: e.alias_cbu, contacto: e.contacto, email: e.email, notas: e.notas,
  };
}

function Selector({ valor, onChange, opciones, vacioTexto }: {
  valor: string; onChange: (v: string) => void; opciones: readonly { valor: string; etiqueta: string }[]; vacioTexto: string;
}) {
  return (
    <select value={valor} onChange={(e) => onChange(e.target.value)} className={campo}>
      <option value="">{vacioTexto}</option>
      {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
    </select>
  );
}

// Alta y edición de la ficha. `rapido` muestra solo lo mínimo (para darlo de alta desde el formulario de una compra);
// `onGuardado` avisa qué proveedor se creó para que el formulario lo elija.
export function FichaForm({ inicial, rapido = false, onClose, onGuardado }: {
  inicial?: FichaProveedor; rapido?: boolean; onClose: () => void;
  onGuardado?: (p: { id: string; nombre: string; plazo_pago_dias: number | null; da_factura: string | null }) => void;
}) {
  const router = useRouter();
  const [e, setE] = useState<Estado>(inicial ? deFicha(inicial) : vacio);
  const [error, setError] = useState("");
  const [parecidos, setParecidos] = useState<{ id: string; nombre: string }[]>([]);
  const [pendiente, empezar] = useTransition();
  const set = (k: keyof Estado) => (v: string) => setE((x) => ({ ...x, [k]: v }));
  const input = (k: keyof Estado, extra: { placeholder?: string; inputMode?: "numeric" | "email" | "tel" | "text"; maxLength?: number } = {}) => (
    <input value={e[k]} onChange={(ev) => set(k)(ev.target.value)} className={campo} {...extra} />
  );

  function guardar(confirmar = false) {
    setError("");
    setParecidos([]);
    empezar(async () => {
      const entrada = aEntrada(e);
      const r = inicial ? await actualizarProveedorFicha(inicial.id, entrada, confirmar) : await crearProveedorFicha(entrada, confirmar);
      if (r.error) { setError(r.error); setParecidos(r.parecidos ?? []); return; }
      router.refresh();
      onGuardado?.({
        id: r.id ?? inicial?.id ?? "", nombre: e.nombre.trim().replace(/\s+/g, " "),
        plazo_pago_dias: aEntrada(e).plazo_pago_dias ?? null, da_factura: e.da_factura || null,
      });
      onClose();
    });
  }

  return (
    <div className="rounded-xl border border-tierra-700/30 bg-white p-4 space-y-4">
      <h3 className="text-sm font-semibold text-neutral-900">{inicial ? `Ficha de ${inicial.nombre}` : rapido ? "Nuevo proveedor (alta rápida)" : "Nuevo proveedor"}</h3>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><label className={etiqueta}>Nombre *</label>{input("nombre", { maxLength: 120, placeholder: "Como lo llaman en el kiosco. Ej.: Panadería Petri" })}</div>
        <div><label className={etiqueta}>CUIT</label>{input("cuit", { inputMode: "numeric", maxLength: 13, placeholder: "30-12345678-9" })}</div>
        <div><label className={etiqueta}>¿Da factura?</label><Selector valor={e.da_factura} onChange={set("da_factura")} opciones={DA_FACTURA} vacioTexto="Sin definir" /></div>
        {!rapido && (
          <>
            <div className="sm:col-span-2"><label className={etiqueta}>Razón social</label>{input("razon_social", { maxLength: 160, placeholder: "Nombre legal, como sale en la factura" })}</div>
            <div><label className={etiqueta}>Condición frente al IVA</label><Selector valor={e.condicion_iva} onChange={set("condicion_iva")} opciones={CONDICIONES_IVA} vacioTexto="Sin definir" /></div>
            <div><label className={etiqueta}>Rubro</label><Selector valor={e.rubro} onChange={set("rubro")} opciones={RUBROS} vacioTexto="Sin definir" /></div>
            <div><label className={etiqueta}>Cómo se le paga</label><Selector valor={e.forma_pago} onChange={set("forma_pago")} opciones={FORMAS_PAGO} vacioTexto="Sin definir" /></div>
          </>
        )}
        <div><label className={etiqueta}>Plazo de pago (días)</label>{input("plazo", { inputMode: "numeric", maxLength: 3, placeholder: "Ej.: 15 (0 = contado)" })}</div>
        {!rapido && (
          <>
            <div><label className={etiqueta}>Alias o CBU</label>{input("alias_cbu", { maxLength: 60, placeholder: "Para transferirle" })}</div>
            <div><label className={etiqueta}>Teléfono o contacto</label>{input("contacto", { maxLength: 120, inputMode: "tel" })}</div>
            <div><label className={etiqueta}>Email</label>{input("email", { maxLength: 120, inputMode: "email" })}</div>
            <div className="sm:col-span-2"><label className={etiqueta}>Notas</label>{input("notas", { maxLength: 500 })}</div>
          </>
        )}
      </div>
      <p className="text-xs text-neutral-400">Todo es opcional salvo el nombre: nada de esto bloquea cargar ni pagar una compra. La lista marca qué falta completar.</p>
      {error && parecidos.length === 0 && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      {error && parecidos.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900 space-y-2">
          <p>{error}</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => guardar(true)} disabled={pendiente} className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
              {pendiente ? "Guardando…" : "Es otro proveedor, guardar igual"}
            </button>
            <button type="button" onClick={() => { setError(""); setParecidos([]); }} disabled={pendiente} className="rounded-lg border border-amber-400 px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100">Cambiar el nombre</button>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={() => guardar()} disabled={pendiente || !e.nombre.trim()}
          className="rounded-lg bg-tierra-700 px-4 py-2 text-sm font-semibold text-white hover:bg-tierra-800 disabled:opacity-50">{pendiente ? "Guardando…" : inicial ? "Guardar la ficha" : "Crear proveedor"}</button>
        <button type="button" onClick={onClose} disabled={pendiente} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">Cancelar</button>
      </div>
    </div>
  );
}

// Lista de todos los proveedores con lo que falta completar de cada uno.
export function FichasProveedoresView({ fichas, puedeCargar }: { fichas: FichaProveedor[]; puedeCargar: boolean }) {
  const [editando, setEditando] = useState<string | "nuevo" | null>(null);
  const incompletas = fichas.filter((f) => f.is_active && faltantes(f).length > 0).length;

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Fichas de proveedores</h2>
          <p className="text-xs text-neutral-500">
            Los datos para la contabilidad de cada proveedor: CUIT, condición de IVA, si da factura, cómo y cuándo se le paga.
            {incompletas > 0 && <> Faltan datos en <b>{incompletas}</b> {incompletas === 1 ? "proveedor" : "proveedores"}.</>}
          </p>
        </div>
        {puedeCargar && editando === null && (
          <button type="button" onClick={() => setEditando("nuevo")} className="rounded-lg border border-tierra-700 px-3 py-1.5 text-sm font-semibold text-tierra-700 hover:bg-tierra-50">Nuevo proveedor</button>
        )}
      </div>

      {editando === "nuevo" && <FichaForm key="nuevo" onClose={() => setEditando(null)} />}

      <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
        {fichas.length === 0 && <p className="px-4 py-8 text-center text-sm text-neutral-400">Todavía no hay proveedores.</p>}
        {fichas.map((f) => {
          const falta = faltantes(f);
          return (
            <div key={f.id}>
              {editando === f.id ? (
                <div className="p-3"><FichaForm key={f.id} inicial={f} onClose={() => setEditando(null)} /></div>
              ) : (
                <div className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900">
                      {f.nombre}
                      {!f.is_active && <span className="ml-2 rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-neutral-500">Desactivado</span>}
                    </p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {[
                        f.cuit ? `CUIT ${cuitConGuiones(f.cuit)}` : null,
                        etiquetaDe(CONDICIONES_IVA, f.condicion_iva),
                        f.da_factura ? `${f.da_factura === "nunca" ? "No da factura" : f.da_factura === "siempre" ? "Siempre da factura" : "A veces da factura"}` : null,
                        etiquetaDe(RUBROS, f.rubro),
                        etiquetaDe(FORMAS_PAGO, f.forma_pago),
                        f.plazo_pago_dias !== null ? (f.plazo_pago_dias === 0 ? "Contado" : `Paga a ${f.plazo_pago_dias} días`) : null,
                      ].filter(Boolean).join(" · ") || "Sin datos contables cargados"}
                    </p>
                    {f.is_active && falta.length > 0 && <p className="text-xs text-amber-700 mt-0.5">Falta: {falta.join(", ")}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    {f.is_active && falta.length === 0 && <span className="rounded-full border border-selva-200 bg-selva-50 px-2 py-0.5 text-xs text-selva-700">Completa</span>}
                    {puedeCargar && editando === null && <button type="button" onClick={() => setEditando(f.id)} className="text-xs font-medium text-tierra-700 underline hover:text-tierra-800">Editar</button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
