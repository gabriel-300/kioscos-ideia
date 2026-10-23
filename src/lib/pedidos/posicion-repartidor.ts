import { coordenadasValidas, redondearCoordenada } from "./ubicacion";

// Ubicación en vivo del repartidor: reglas puras (sin base ni red), las usan las Server Actions
// (validar lo que manda el navegador) y las pantallas (texto "hace 20 s", posición vieja).

// Cada cuánto manda su posición el navegador del repartidor, y cada cuánto la consulta el cliente.
export const INTERVALO_ENVIO_MS = 12_000;
export const INTERVALO_CONSULTA_MS = 12_000;

// Pasado este tiempo sin novedades la posición se considera vieja (señal perdida, pestaña cerrada).
export const POSICION_VIEJA_SEG = 180;

export type PosicionValida = { latitud: number; longitud: number; precision_m: number | null };

export function validarPosicion(lat: unknown, lng: unknown, precision: unknown): { error: string } | { valor: PosicionValida } {
  if (!coordenadasValidas(lat, lng)) return { error: "Ubicación inválida" };
  let precision_m: number | null = null;
  if (precision != null) {
    if (typeof precision !== "number" || !Number.isFinite(precision) || precision < 0) return { error: "Precisión inválida" };
    precision_m = Math.round(Math.min(precision, 100_000));
  }
  return { valor: { latitud: redondearCoordenada(lat as number), longitud: redondearCoordenada(lng as number), precision_m } };
}

// Segundos desde la última actualización (nunca negativo, aunque los relojes no coincidan del todo).
export function segundosDesde(actualizadoEn: string | Date, ahora: Date = new Date()): number {
  const t = new Date(actualizadoEn).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return Math.max(0, Math.round((ahora.getTime() - t) / 1000));
}

export type FrescuraPosicion = "vigente" | "vieja";

export function frescuraPosicion(segundos: number): FrescuraPosicion {
  return segundos > POSICION_VIEJA_SEG ? "vieja" : "vigente";
}

// "hace 20 s" / "hace 3 min"
export function textoHace(segundos: number): string {
  if (!Number.isFinite(segundos)) return "hace un rato";
  if (segundos < 60) return `hace ${Math.max(segundos, 1)} s`;
  const min = Math.floor(segundos / 60);
  return min < 60 ? `hace ${min} min` : `hace ${Math.floor(min / 60)} h`;
}

// Para el mapa del cliente: el punto de entrega se redondea a 3 decimales (~110 m). Sirve para ver hacia
// dónde viene el repartidor, sin dejar en la pantalla de seguimiento (que se identifica solo con el id
// del pedido) la ubicación exacta de la casa.
export function redondearDestino(n: number): number {
  return Math.round(n * 1000) / 1000;
}
