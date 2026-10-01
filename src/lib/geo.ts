// Geografía mínima para "elegir el local más cercano". Funciones puras, sin red.
//
// PRIVACIDAD: la ubicación del cliente se usa SOLO en su navegador. No se envía al
// servidor, no se guarda, no va en la URL, no se loguea ni se pone en cookies. Estas
// funciones no saben de dónde sale el punto (GPS hoy, una dirección escrita mañana).

export type Punto = { lat: number; lng: number };

const RADIO_TIERRA_KM = 6371;
const aRad = (g: number) => (g * Math.PI) / 180;

export function esPuntoValido(lat: unknown, lng: unknown): boolean {
  return typeof lat === "number" && typeof lng === "number"
    && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// Distancia en línea recta sobre la esfera (alcanza para decidir cuál local queda
// más cerca; no es la distancia por calle).
export function haversineKm(a: Punto, b: Punto): number {
  const dLat = aRad(b.lat - a.lat);
  const dLng = aRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aRad(a.lat)) * Math.cos(aRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Metros por debajo de 1 km (redondeados a 10 m), un decimal después. Coma decimal.
export function formatearDistancia(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  const m = Math.round((km * 1000) / 10) * 10;
  if (m < 1000) return `${m} m`;
  return `${(Math.round(km * 10) / 10).toFixed(1).replace(".", ",")} km`;
}

type ConCoordenadas = { latitud: number | null; longitud: number | null };

// Ordena de más cerca a más lejos. Los que no tienen coordenadas (o las tienen
// inválidas) van al final, sin distancia, en su orden original. Estable en empates.
export function ordenarPorCercania<T extends ConCoordenadas>(
  locales: T[],
  punto: Punto,
): { local: T; km: number | null }[] {
  return locales
    .map((local, i) => ({
      local,
      i,
      km: esPuntoValido(local.latitud, local.longitud)
        ? haversineKm(punto, { lat: local.latitud as number, lng: local.longitud as number })
        : null,
    }))
    .sort((x, y) => {
      if (x.km === null && y.km === null) return x.i - y.i;
      if (x.km === null) return 1;
      if (y.km === null) return -1;
      return x.km - y.km || x.i - y.i;
    })
    .map(({ local, km }) => ({ local, km }));
}

const NUMERO = /^[+-]?\d+(\.\d+)?$/;

// Acepta el par tal como lo da Google Maps ("-27.366512, -55.896423"), con coma,
// punto y coma o espacio como separador. El decimal es siempre punto.
export function parsearCoordenadas(texto: string): { ok: true; lat: number; lng: number } | { ok: false; error: string } {
  const partes = String(texto ?? "").replace(/[−–]/g, "-").trim().split(/[,;\s]+/).filter(Boolean);
  if (partes.length !== 2 || !partes.every((p) => NUMERO.test(p))) {
    return { ok: false, error: "Pegá las coordenadas como las da Google Maps, por ejemplo: -27.366512, -55.896423" };
  }
  const [lat, lng] = partes.map(Number);
  if (lat < -90 || lat > 90) return { ok: false, error: "La latitud tiene que estar entre -90 y 90" };
  if (lng < -180 || lng > 180) return { ok: false, error: "La longitud tiene que estar entre -180 y 180" };
  return { ok: true, lat, lng };
}
