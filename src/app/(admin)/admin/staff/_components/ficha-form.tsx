"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CAMPOS_FICHA, ESTADOS_CIVILES, FORMAS_PAGO_PERSONAL, JORNADAS, REGISTROS, faltantesDeFicha, validarFichaPersonal,
  type FichaEntrada, type FichaPersonal,
} from "@/lib/personal/ficha";
import { guardarFichaPersonal } from "../ficha-actions";

const etiqueta = "text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5";
const campo = "h-10 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 disabled:bg-neutral-50 disabled:text-neutral-600";

type Estado = Record<keyof FichaPersonal, string>;
const aTexto = (f: FichaPersonal): Estado => Object.fromEntries(CAMPOS_FICHA.map((c) => [c, f[c] === null ? "" : String(f[c])])) as Estado;

function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">{titulo}</h2>
        {ayuda && <p className="text-xs text-neutral-500 mt-0.5">{ayuda}</p>}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>
    </section>
  );
}

export function FichaForm({ personaId, inicial, puedeCargar }: { personaId: string; inicial: FichaPersonal; puedeCargar: boolean }) {
  const router = useRouter();
  const [f, setF] = useState<Estado>(() => aTexto(inicial));
  const [error, setError] = useState("");
  const [guardado, setGuardado] = useState(false);
  const [pendiente, empezar] = useTransition();
  const quieto = !puedeCargar;

  const poner = (k: keyof FichaPersonal) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setF({ ...f, [k]: e.target.value });
    setGuardado(false);
  };
  const texto = (k: keyof FichaPersonal, nombre: string, o: { tipo?: string; ph?: string; ancho?: boolean } = {}) => {
    const { tipo = "text", ph, ancho } = o;
    return (
    <div key={k} className={ancho ? "sm:col-span-2" : ""}>
      <label className={etiqueta}>{nombre}</label>
      <input type={tipo} value={f[k]} onChange={poner(k)} disabled={quieto} placeholder={ph} inputMode={tipo === "number" ? "decimal" : undefined} className={campo} />
    </div>
    );
  };
  const lista = (k: keyof FichaPersonal, nombre: string, opciones: readonly { valor: string; etiqueta: string }[]) => (
    <div key={k}>
      <label className={etiqueta}>{nombre}</label>
      <select value={f[k]} onChange={poner(k)} disabled={quieto} className={campo}>
        <option value="">—</option>
        {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
      </select>
    </div>
  );

  // La misma validación que hace el servidor, para marcar el error sin ir y volver.
  const previa = validarFichaPersonal(f as unknown as FichaEntrada);
  const faltan = "valor" in previa ? faltantesDeFicha(previa.valor) : [];

  function guardar() {
    setError("");
    empezar(async () => {
      const r = await guardarFichaPersonal(personaId, f as unknown as FichaEntrada);
      if (r.error) { setError(r.error); return; }
      setGuardado(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {faltan.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Para poder liquidar y pagar falta completar: {faltan.join(", ")}. No es obligatorio: nada se frena por esto.
        </p>
      )}

      <Seccion titulo="Datos personales">
        {texto("legajo", "N° de legajo")}
        {texto("cuil", "CUIL", { ph: "20-12345678-3" })}
        {texto("fecha_nacimiento", "Fecha de nacimiento", { tipo: "date" })}
        {lista("estado_civil", "Estado civil", ESTADOS_CIVILES)}
        {texto("nacionalidad", "Nacionalidad")}
        {texto("email_personal", "Email personal", { tipo: "email" })}
        {texto("domicilio", "Domicilio", { ancho: true })}
        {texto("localidad", "Localidad")}
        {texto("emergencia_nombre", "Contacto de emergencia")}
        {texto("emergencia_vinculo", "Vínculo", { ph: "Madre, pareja…" })}
        {texto("emergencia_telefono", "Teléfono de emergencia")}
      </Seccion>

      <Seccion titulo="Datos laborales" ayuda="El alta registrada (convenio, categoría, obra social) se completa solo si la persona está en blanco.">
        {texto("puesto", "Puesto", { ph: "Vendedor, encargado…" })}
        {texto("fecha_ingreso", "Fecha de ingreso", { tipo: "date" })}
        {texto("fecha_egreso", "Fecha de egreso", { tipo: "date" })}
        {texto("motivo_egreso", "Motivo del egreso", { ancho: true })}
        {lista("registro", "Registro", REGISTROS)}
        {texto("fecha_alta_registro", "Fecha de alta registrada", { tipo: "date" })}
        {lista("jornada", "Jornada", JORNADAS)}
        {texto("horas_semanales", "Horas por semana", { tipo: "number", ph: "24" })}
        {texto("turno_habitual", "Turno habitual", { ph: "Mañana, tarde…" })}
        {texto("convenio", "Convenio")}
        {texto("categoria", "Categoría")}
        {texto("obra_social", "Obra social")}
      </Seccion>

      <Seccion titulo="Sueldo y forma de pago" ayuda="El sueldo se carga por el monto final que se le paga. El tope limita lo que se le puede descontar por mes (adelantos, mercadería).">
        {texto("sueldo_acordado", "Sueldo acordado (total por mes)", { tipo: "number" })}
        {texto("sueldo_en_recibo", "De eso, el que figura en el recibo", { tipo: "number" })}
        {texto("dia_pago", "Día de pago", { tipo: "number", ph: "5" })}
        {lista("forma_pago", "Forma de pago", FORMAS_PAGO_PERSONAL)}
        {texto("banco", "Banco")}
        {texto("cbu_alias", "CBU o alias", { ph: "22 dígitos o alias" })}
        {texto("titular_cuenta", "Titular de la cuenta")}
        {texto("tope_descuento_pct", "Tope de descuento mensual (%)", { tipo: "number", ph: "20" })}
      </Seccion>

      <Seccion titulo="Notas">
        <div className="sm:col-span-2 lg:col-span-3">
          <textarea value={f.notas} onChange={poner("notas")} disabled={quieto} maxLength={500} rows={3} className={`${campo} h-auto py-2`} />
        </div>
      </Seccion>

      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
      {"error" in previa && !error && puedeCargar && <p className="text-xs text-danger">{previa.error}</p>}
      {puedeCargar ? (
        <div className="flex items-center gap-3">
          <button type="button" onClick={guardar} disabled={pendiente || "error" in previa}
            className="rounded-lg bg-tierra-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-tierra-800 disabled:opacity-50">
            {pendiente ? "Guardando…" : "Guardar la ficha"}
          </button>
          {guardado && <span className="text-sm text-selva-700">Guardada ✓</span>}
        </div>
      ) : (
        <p className="text-xs text-neutral-500">Solo el administrativo de Tesorería puede modificar la ficha.</p>
      )}
    </div>
  );
}
