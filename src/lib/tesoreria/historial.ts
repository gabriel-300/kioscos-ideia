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
  "mp_cobros_importados", "mp_cobro_clasificado",
  "proveedor_saldo_inicial", "proveedor_pago", "proveedor_movimiento_anulado",
  "mp_saldo_inicial", "mp_retiro", "mp_movimiento_anulado",
  "peya_liquidacion_importada", "peya_liquidacion_confirmada", "peya_acreditacion_registrada", "peya_conciliacion_manual",
  "peya_pedido_revisado",
  "egreso_vencimiento",
  "entrega_costos",
  "proveedor_ficha",
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
  mp_cobros_importados:      "Cobros de Mercado Pago importados",
  mp_cobro_clasificado:      "Cobro de Mercado Pago clasificado",
  proveedor_saldo_inicial:   "Saldo inicial de proveedor cargado",
  proveedor_pago:            "Pago a proveedor registrado",
  proveedor_movimiento_anulado: "Movimiento de proveedor anulado",
  mp_saldo_inicial:          "Saldo inicial de Mercado Pago cargado",
  mp_retiro:                 "Retiro de Mercado Pago registrado",
  mp_movimiento_anulado:     "Movimiento de Mercado Pago anulado",
  peya_liquidacion_importada:   "Liquidación de PedidosYa importada (estimada)",
  peya_liquidacion_confirmada:  "Liquidación de PedidosYa confirmada",
  peya_acreditacion_registrada: "Cobro de PedidosYa registrado",
  peya_conciliacion_manual:     "Pedido de PedidosYa cruzado a mano",
  peya_pedido_revisado:         "Pedido de PedidosYa revisado",
  egreso_vencimiento:           "Vencimiento de un remito o factura",
  entrega_costos:               "Costos de una mercadería cargados",
  proveedor_ficha:              "Ficha de proveedor",
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
const CAMPO_FICHA: Record<string, string> = {
  nombre: "nombre", razon_social: "razón social", cuit: "CUIT", condicion_iva: "condición de IVA", da_factura: "si da factura", rubro: "rubro",
  forma_pago: "forma de pago", plazo_pago_dias: "plazo de pago", alias_cbu: "alias o CBU", contacto: "contacto", email: "email", notas: "notas",
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
    case "egreso_vencimiento": {
      const fecha = (v: Json | undefined) => (texto(v) ? texto(v)!.split("-").reverse().join("/") : null);
      const quien = `«${texto(d.descripcion) ?? "un remito"}»`;
      if (!fecha(d.nuevo)) return `Sacó el vencimiento de ${quien}`;
      return fecha(d.anterior) ? `Cambió el vencimiento de ${quien} de ${fecha(d.anterior)} a ${fecha(d.nuevo)}` : `Fijó el vencimiento de ${quien} al ${fecha(d.nuevo)}`;
    }
    case "proveedor_ficha": {
      const quien = `«${texto(d.proveedor) ?? "un proveedor"}»`;
      if (d.alta === true) return `Dio de alta al proveedor ${quien}`;
      const campos = d.cambios && typeof d.cambios === "object" && !Array.isArray(d.cambios) ? Object.keys(d.cambios) : [];
      return `Actualizó la ficha de ${quien}${campos.length > 0 ? ` (${campos.map((c) => CAMPO_FICHA[c] ?? c).join(", ")})` : ""}`;
    }
    case "entrega_costos":
      return `Cargó los costos de ${numero(d.productos) ?? 0} ${numero(d.productos) === 1 ? "producto" : "productos"} de una mercadería${texto(d.proveedor) ? ` de ${texto(d.proveedor)}` : ""} (total ${plata(d.total)})`;
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
    case "mp_cobros_importados":
      return `Importó cobros de Mercado Pago (${numero(d.nuevas) ?? 0} nuevos, ${numero(d.actualizadas) ?? 0} ya cargados) del ${texto(d.desde) ?? "?"} al ${texto(d.hasta) ?? "?"}`;
    case "mp_cobro_clasificado":
      return `Clasificó un movimiento de Mercado Pago de ${plata(d.monto)} como «${texto(d.clasificacion) ?? "?"}»`;
    case "proveedor_saldo_inicial":
      return `Cargó el saldo inicial de ${texto(d.proveedor) ?? "un proveedor"}${texto(d.sucursal) ? ` (${texto(d.sucursal)})` : ""}: ${plata(d.monto)}`;
    case "proveedor_pago":
      return `Registró un pago de ${plata(d.monto)} a ${texto(d.proveedor) ?? "un proveedor"}${texto(d.sucursal) ? ` (${texto(d.sucursal)})` : ""}${texto(d.origen) ? ` con ${ORIGEN[texto(d.origen)!] ?? texto(d.origen)}` : ""}`;
    case "proveedor_movimiento_anulado":
      return `Anuló ${d.tipo === "saldo_inicial" ? "el saldo inicial" : "un pago"} de ${plata(d.monto)} de ${texto(d.proveedor) ?? "un proveedor"}`;
    case "mp_saldo_inicial":
      return `Cargó el saldo inicial de Mercado Pago: ${plata(d.monto)} al comenzar el ${texto(d.fecha) ?? "?"}`;
    case "mp_retiro":
      return `Registró un retiro de ${plata(d.monto)} de Mercado Pago`;
    case "mp_movimiento_anulado":
      return `Anuló ${d.tipo === "saldo_inicial" ? "el saldo inicial" : "un retiro"} de Mercado Pago de ${plata(d.monto)}`;
    case "peya_liquidacion_importada":
    case "peya_liquidacion_confirmada": {
      const estado = f.accion === "peya_liquidacion_confirmada" ? "confirmó" : "importó (estimada)";
      return `Se ${estado} la liquidación de PedidosYa del ${texto(d.desde) ?? "?"} al ${texto(d.hasta) ?? "?"} (${numero(d.pedidos) ?? 0} pedidos${numero(d.total_liquidado) !== null ? `, total ${plata(d.total_liquidado)}` : ""})${d.reimportada === true ? ", reimportada" : ""}`;
    }
    case "peya_acreditacion_registrada":
      return `Registró el cobro de PedidosYa del ${texto(d.desde) ?? "?"} al ${texto(d.hasta) ?? "?"}: llegaron ${plata(d.acreditado)} de ${plata(d.esperado)} esperados${d.mercadopago === true ? " (vinculado a Mercado Pago)" : ""}`;
    case "peya_conciliacion_manual":
      return `Cruzó a mano el pedido ${texto(d.pedido) ?? "?"} de PedidosYa: ${texto(d.resultado) ?? "?"}`;
    case "peya_pedido_revisado":
      return d.reabierto === true
        ? `Volvió a abrir el pedido ${texto(d.pedido) ?? "?"} de PedidosYa para revisar`
        : `Dio por revisado el pedido ${texto(d.pedido) ?? "?"} de PedidosYa (${texto(d.conciliacion) === "sin_venta" ? "sin venta en el sistema" : "con otro importe"}): ${texto(d.nota) ?? ""}`;
    case "permiso_cambiado": {
      const quien = texto(d.persona) ?? "una persona";
      const permiso = PERMISO[texto(d.permiso) ?? ""] ?? texto(d.permiso) ?? "un permiso";
      return d.nuevo === true ? `Le dio a ${quien} el permiso de ${permiso}` : `Le sacó a ${quien} el permiso de ${permiso}`;
    }
  }
}
