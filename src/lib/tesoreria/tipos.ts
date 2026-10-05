// Tipos y listas fijas de Tesorería (migración 101). Los valores tienen que coincidir con los CHECK de la tabla
// `egresos`; si se agrega una categoría u origen hay que tocar las dos cosas (la base y esta lista).
//
// Se tipa a mano en vez de regenerar src/types/database.ts: ese archivo está desactualizado (no tiene las columnas
// de las últimas migraciones) y regenerarlo mete un cambio enorme sin relación. Acá los tipos son chicos y las
// consultas de dinero castean su resultado a estos tipos en vez de usar `any`.

export const CATEGORIAS = [
  { valor: "mercaderia",   etiqueta: "Mercadería" },
  { valor: "sueldos",      etiqueta: "Sueldos" },
  { valor: "alquiler",     etiqueta: "Alquiler" },
  { valor: "servicios",    etiqueta: "Servicios" },
  { valor: "retiro_socio", etiqueta: "Retiro de socio" },
  { valor: "otro",         etiqueta: "Otro" },
] as const;

export const ORIGENES = [
  { valor: "retiro_caja",        etiqueta: "Retiro de caja de un kiosco" },
  { valor: "efectivo_tesoreria", etiqueta: "Efectivo de Tesorería" },
  { valor: "transferencia",      etiqueta: "Transferencia" },
  { valor: "mercadopago",        etiqueta: "Mercado Pago" },
] as const;

export const COMPROBANTES = [
  { valor: "con", etiqueta: "Con factura" },
  { valor: "sin", etiqueta: "Sin factura" },
] as const;

export type Categoria   = (typeof CATEGORIAS)[number]["valor"];
export type Origen      = (typeof ORIGENES)[number]["valor"];
export type Comprobante = (typeof COMPROBANTES)[number]["valor"];

export const etiquetaCategoria = (v: string) => CATEGORIAS.find((c) => c.valor === v)?.etiqueta ?? v;
export const etiquetaOrigen    = (v: string) => ORIGENES.find((o) => o.valor === v)?.etiqueta ?? v;

// Fila de `egresos` tal como la devuelve la base.
export interface Egreso {
  id:                 string;
  fecha:              string;          // YYYY-MM-DD
  monto:              number;
  sucursal_id:        string | null;   // null = gasto general
  categoria:          Categoria;
  proveedor_id:       string | null;
  descripcion:        string;
  comprobante:        Comprobante;
  comprobante_numero: string | null;
  comprobante_path:   string | null;
  pagado:             boolean;         // false = se compró pero todavía se debe (migración 102)
  origen:             Origen | null;   // null solo si no está pagado
  fecha_pago:         string | null;   // null solo si no está pagado
  gasto_fijo_id:      string | null;
  nota:               string | null;
  anulado_en:         string | null;
  created_by:         string | null;
  created_at:         string;
}

// Lo que manda el formulario. Nada de esto se confía: la acción lo valida de nuevo (validaciones.ts).
export interface EgresoEntrada {
  fecha:              string;
  monto:              number;
  sucursal_id:        string | null;
  categoria:          string;
  proveedor_id:       string | null;
  descripcion:        string;
  comprobante:        string;
  comprobante_numero: string | null;
  comprobante_path:   string | null;
  pagado:             boolean;
  origen:             string | null;   // se ignora si no está pagado
  gasto_fijo_id:      string | null;
  nota:               string | null;
  // Lo que ya estaba cargado en el kiosco y este egreso viene a registrar.
  retiros_caja_ids:   string[];
  entregas_ids:       string[];
}

// Fila de `tesoreria_config` (una sola).
export interface TesoreriaConfig {
  fecha_inicio:     string;
  efectivo_inicial: number;
}
