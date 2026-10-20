// Punto GPS de entrega de un pedido con envío. Puro (sin base ni red): lo usan el servidor
// (validar lo que manda el navegador) y las pantallas del personal (abrir el mapa).

export const DIRECCION_POR_GPS = "Ubicación compartida por GPS";

export function coordenadasValidas(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number"
    && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    && !(lat === 0 && lng === 0); // 0,0 es lo que llega cuando el GPS falla sin avisar
}

// 6 decimales = ~10 cm: más no aporta y no hace falta guardar de más.
export function redondearCoordenada(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

// Enlace que abre Google Maps en ese punto (en el celular ofrece navegar hasta ahí).
export function urlMapa(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
