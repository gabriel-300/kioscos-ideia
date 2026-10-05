// Reglas del retiro de efectivo de la caja de un kiosco. Puras (sin base) para poder probarlas: las usan la pantalla del
// kiosco y la acción del servidor, que valida de nuevo todo lo que manda el navegador.
//
// Un retiro es plata que sale del cajón. Tiene dos usos (decisión del usuario, 2026-10-05):
//   * compra puntual de emergencia (lo normal): el empleado dice cuánto, para qué y manda la foto del ticket;
//   * pago esporádico a un proveedor en efectivo, AUTORIZADO POR UN ADMINISTRADOR: lleva proveedor y quién lo autorizó.
// La contabilidad (categoría, factura, etc.) la registra después el administrativo en Tesorería: no se le pide al empleado.

import { redondearMoneda } from "@/lib/pedidos/pricing";

// Desde este monto la foto del ticket o comprobante es obligatoria: es el único respaldo de una compra de emergencia.
// Un solo lugar para cambiarlo.
export const RETIRO_FOTO_DESDE = 20_000;
export const RETIRO_MONTO_MAX = 100_000_000;
export const RETIRO_MOTIVO_MAX = 300;

export const retiroRequiereFoto = (monto: number) => Number.isFinite(monto) && monto >= RETIRO_FOTO_DESDE;

export interface RetiroEntrada {
  monto:                  number;
  motivo:                 string;
  comprobante_image_url?: string | null;
  proveedor_id?:          string | null;
  autorizado_por?:        string | null;
}

export interface RetiroValidado {
  monto:                 number;
  motivo:                string;
  comprobante_image_url: string | null;
  proveedor_id:          string | null;
  autorizado_por:        string | null;
}

export function validarRetiro(e: RetiroEntrada): { error: string } | { valor: RetiroValidado } {
  if (typeof e.monto !== "number" || !Number.isFinite(e.monto)) return { error: "El monto es obligatorio" };
  const monto = redondearMoneda(e.monto);
  if (monto <= 0)                return { error: "El monto tiene que ser mayor a cero" };
  if (monto > RETIRO_MONTO_MAX)  return { error: "El monto es demasiado grande" };

  const motivo = (e.motivo ?? "").trim();
  if (!motivo)                          return { error: "El motivo es obligatorio" };
  if (motivo.length > RETIRO_MOTIVO_MAX) return { error: `El motivo es demasiado largo (máximo ${RETIRO_MOTIVO_MAX} caracteres)` };

  const foto = (e.comprobante_image_url ?? "").trim() || null;
  if (retiroRequiereFoto(monto) && !foto) {
    return { error: `Para retiros de $${RETIRO_FOTO_DESDE.toLocaleString("es-AR")} o más hace falta la foto del ticket o comprobante` };
  }

  const proveedor = e.proveedor_id || null;
  const autoriza  = e.autorizado_por || null;
  if (proveedor && !autoriza) return { error: "Un pago a proveedor tiene que estar autorizado por un administrador: elegí quién lo autorizó" };
  // Sin proveedor no hay nada que autorizar: es una compra de emergencia común.
  return { valor: { monto, motivo, comprobante_image_url: foto, proveedor_id: proveedor, autorizado_por: proveedor ? autoriza : null } };
}
