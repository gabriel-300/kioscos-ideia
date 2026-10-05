// Historial de Tesorería (migración 104): un registro de solo agregar de lo que se hace. Cada acción que mueve plata, cambia
// un número de referencia o da un permiso deja una fila: quién, cuándo, qué cambió (antes y después) y por qué.
// Es la forma de controlar a quien carga: nada se edita sin dejar rastro. Este archivo no importa nada del servidor para que
// también lo use la pantalla (describirHistorial).

import type { createAdminClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

type Admin = ReturnType<typeof createAdminClient>;

export const ACCIONES_HISTORIAL = [
  "egreso_creado", "egreso_pagado", "egreso_anulado",
  "entrega_descartada", "entrega_restaurada",
  "efectivo_inicial_cambiado", "permiso_cambiado",
] as const;
export type AccionHistorial = (typeof ACCIONES_HISTORIAL)[number];

export const ETIQUETA_ACCION: Record<AccionHistorial, string> = {
  egreso_creado:             "Egreso cargado",
  egreso_pagado:             "Compra marcada pagada",
  egreso_anulado:            "Egreso anulado",
  entrega_descartada:        "Ingreso del kiosco: no corresponde",
  entrega_restaurada:        "Ingreso del kiosco: vuelto a la lista",
  efectivo_inicial_cambiado: "Efectivo inicial cambiado",
  permiso_cambiado:          "Permiso cambiado",
};

export interface EntradaHistorial {
  usuario_id: string;
  accion:     AccionHistorial;
  entidad_id?: string | null;
  detalle?:   { [clave: string]: Json | undefined };
  motivo?:    string | null;
}

// Nunca lanza: devuelve { error } como el resto del módulo. Quien llama decide qué hacer si no se pudo anotar.
export async function registrarHistorial(admin: Admin, e: EntradaHistorial): Promise<{ error?: string }> {
  const { error } = await admin.from("tesoreria_historial").insert({
    usuario_id: e.usuario_id,
    accion:     e.accion,
    entidad_id: e.entidad_id ?? null,
    detalle:    e.detalle ?? {},
    motivo:     e.motivo?.trim() || null,
  });
  return error ? { error: error.message } : {};
}

// Fila ya leída, con el nombre de quien lo hizo.
export interface FilaHistorial {
  id:         string;
  creado_en:  string;
  usuario_id: string | null;
  usuario:    string | null;
  accion:     AccionHistorial;
  entidad_id: string | null;
  detalle:    Record<string, Json | undefined>;
  motivo:     string | null;
}

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

const texto  = (v: Json | undefined) => (typeof v === "string" ? v : null);
const numero = (v: Json | undefined) => (typeof v === "number" ? v : null);
const plata  = (v: Json | undefined) => (numero(v) !== null ? AR.format(numero(v)!) : "?");
const ORIGEN: Record<string, string> = {
  retiro_caja: "retiro de caja", efectivo_tesoreria: "efectivo de Tesorería", transferencia: "transferencia", mercadopago: "Mercado Pago",
};
const PERMISO: Record<string, string> = { es_administrativo: "administrativo de Tesorería", es_socio: "socio" };

// Una frase en castellano de lo que pasó, para leer el historial sin abrir cada fila.
export function describirHistorial(f: Pick<FilaHistorial, "accion" | "detalle">): string {
  const d = f.detalle ?? {};
  switch (f.accion) {
    case "egreso_creado": {
      const partes = [`Cargó un egreso de ${plata(d.monto)}`];
      if (texto(d.descripcion)) partes.push(`«${texto(d.descripcion)}»`);
      const marcas = [
        d.comprobante === "sin" ? "sin factura" : "con factura",
        d.pagado === false ? "queda por pagar" : texto(d.origen) ? `pagado con ${ORIGEN[texto(d.origen)!] ?? texto(d.origen)}` : null,
      ].filter(Boolean);
      return `${partes.join(" ")} (${marcas.join(", ")})`;
    }
    case "egreso_pagado":
      return `Marcó pagado «${texto(d.descripcion) ?? "un egreso"}» de ${plata(d.monto)}${texto(d.origen) ? ` con ${ORIGEN[texto(d.origen)!] ?? texto(d.origen)}` : ""}`;
    case "egreso_anulado":
      return `Anuló «${texto(d.descripcion) ?? "un egreso"}» de ${plata(d.monto)}`;
    case "entrega_descartada":
      return `Marcó «no corresponde» un ingreso del kiosco (${texto(d.proveedor) ?? "sin proveedor"})`;
    case "entrega_restaurada":
      return `Devolvió a la lista un ingreso del kiosco (${texto(d.proveedor) ?? "sin proveedor"})`;
    case "efectivo_inicial_cambiado":
      return numero(d.anterior) === null
        ? `Cargó el efectivo inicial: ${plata(d.nuevo)}`
        : `Cambió el efectivo inicial de ${plata(d.anterior)} a ${plata(d.nuevo)}`;
    case "permiso_cambiado": {
      const quien = texto(d.persona) ?? "una persona";
      const permiso = PERMISO[texto(d.permiso) ?? ""] ?? texto(d.permiso) ?? "un permiso";
      return d.nuevo === true ? `Le dio a ${quien} el permiso de ${permiso}` : `Le sacó a ${quien} el permiso de ${permiso}`;
    }
  }
}
