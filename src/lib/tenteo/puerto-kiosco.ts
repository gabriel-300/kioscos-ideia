import type { createAdminClient } from "@/lib/supabase/server";
import { kioscoDirecto } from "./puerto-kiosco-db";

// PUERTO: lo único que Tenteo (pedidos online) toma del sistema del kiosco.
// Todo lo demás de Tenteo trabaja con SUS tablas (pedidos, pedido_items,
// zonas_entrega, clientes, pedido_rate_limits y la configuración que vive en
// columnas de sucursales). Lo que viene del kiosco son cuatro cosas:
//   - el catálogo: productos, categorías, precios, promos y qué habilita cada sucursal
//     (y los nombres de lo que lleva un pedido, para mostrárselos al cliente)
//   - el stock
//   - registrar la venta (el RPC crear_movimiento_con_items)
//   - a qué sucursales puede mirar una persona del personal
// Hoy se implementa con consultas directas a la base (puerto-kiosco-db.ts). Si
// Tenteo pasa a ser otra aplicación, se reemplaza SOLO esa implementación por
// una vía API y el resto de Tenteo no se toca: nadie en Tenteo debería leer esas
// tablas ni llamar a ese RPC por fuera de este archivo (hay una prueba que lo exige).
//
// Es una frontera de lectura de datos y de registro de la venta: la LÓGICA de
// precios, redondeo y reparto de promos de Tenteo sigue en lib/pedidos/pricing.ts.
//
// No hay operación de caja ni de anulación: Tenteo no las ejecuta. Solo queda
// la regla ya vigente de que una venta online se anula desde el historial del
// kiosco (ver cancelarPedido); si algún día Tenteo necesita consultar el estado
// de una venta, se agrega acá.

type Fila = Record<string, any>;

// ── Catálogo ───────────────────────────────────────────────────────────
export type RestriccionesCatalogo = {
  categoriasHabilitadas: string[] | null; // null o vacío = sin restricción
  promosHabilitadas:     boolean;
};

export type DatosCatalogo = {
  categorias:      Fila[]; // {id, name}, ya ordenadas
  productos:       Fila[]; // {id, name, cover_image_url, category_id, unit_label, vendible_pos}
  preciosProducto: Fila[]; // {product_id, precio_dist}
  promos:          Fila[]; // {id, name, price, tipo, cover_image_url, category_id}
  preciosPromo:    Fila[]; // {promo_id, price}
  stock:           Fila[]; // {product_id, stock_actual} de la sucursal (vista stock_sucursal)
  componentes:     Fila[]; // {promo_id, product_id, cantidad} (promo_items)
};

// Para validar un carrito (ids que manda el cliente): lo que hace falta de cada uno.
export type DatosProductosPedido = {
  productos: { id: string; category_id: string | null; is_active: boolean; vendible_pos: boolean | null }[];
  precios:   { product_id: string; precio_dist: number }[];
};

export type DatosPromosPedido = {
  promos:            { id: string; price: number; is_active: boolean; category_id: string | null; promo_items: { product_id: string; cantidad: number }[] }[];
  preciosPromo:      { promo_id: string; price: number }[];
  costosComponentes: { product_id: string; costo: number }[]; // costo de la sucursal: solo para repartir el precio de la promo
};

// Nombres para mostrar (seguimiento del pedido): solo id y nombre, nunca costo ni margen.
export type NombresCatalogo = {
  productos: { id: string; name: string }[];
  promos:    { id: string; name: string }[];
};

// ── Stock ──────────────────────────────────────────────────────────────
export type FilaStock = { product_id: string; product_name: string; stock_actual: number };

// ── Venta ──────────────────────────────────────────────────────────────
export type EntradaVenta = {
  sucursalId:     string;
  fecha:          string;       // YYYY-MM-DD en hora argentina (fechaHoyAR)
  notas:          string;
  canal:          string;       // "pedido_online"
  contactoId:     string | null;
  pagoEfectivo:   number | null;
  pagoBilletera:  number | null;
  items:          { product_id: string | null; cantidad: number; precio_unitario: number | null; subtotal: number; promo_id: string | null }[];
};
export type ResultadoVenta = { error: string } | { movimientoId: string | null };

export interface PuertoKiosco {
  /** Qué categorías y promos habilita la sucursal. */
  restricciones(sucursalId: string): Promise<RestriccionesCatalogo>;
  /** Todo lo que hace falta para armar el catálogo pedible de una sucursal. */
  datosCatalogo(sucursalId: string): Promise<DatosCatalogo>;
  /** Productos y precios de la sucursal para los ids de un carrito. */
  datosProductos(sucursalId: string, productIds: string[]): Promise<{ error: string } | DatosProductosPedido>;
  /** Promos (con sus componentes), precios por sucursal y costos de los componentes. */
  datosPromos(sucursalId: string, promoIds: string[]): Promise<{ error: string } | DatosPromosPedido>;
  /** Nombres de esos productos y promos (no consulta si la lista está vacía). */
  nombres(productIds: string[], promoIds: string[]): Promise<NombresCatalogo>;
  /** Stock actual de esos productos; null si no se pudo leer (el chequeo es de mejor esfuerzo). */
  stock(sucursalId: string, productIds: string[]): Promise<FilaStock[] | null>;
  /** Registra la venta (movimiento + ítems). Devuelve el id del movimiento. */
  registrarVenta(entrada: EntradaVenta): Promise<ResultadoVenta>;
  /** Sucursales que puede ver una persona del personal. null = todas (admin); [] = ninguna. */
  sucursalesDelUsuario(userId: string, rol: string): Promise<string[] | null>;
}

// Única puerta de entrada: quien necesita algo del kiosco lo pide por acá. Hoy
// recibe el cliente de la base y arma la implementación directa; con una
// implementación vía API este parámetro dejaría de usarse.
export function puertoKiosco(admin: ReturnType<typeof createAdminClient>): PuertoKiosco {
  return kioscoDirecto(admin);
}
