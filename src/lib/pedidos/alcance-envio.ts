import { formatearDistancia, haversineKm, esPuntoValido, ordenarPorCercania, type Punto } from "@/lib/geo";

// Dos chequeos de ubicación al pedir, para que el cliente no se equivoque de local ni pida un envío adonde no se llega.
// Puros (sin red). La ubicación del cliente en el envío ya viaja al servidor (es el punto de entrega); la comparación de
// "qué local me queda más cerca" se hace en su navegador, como el resto de la elección de local.

export type VerificacionAlcance = { ok: true } | { ok: false; km: number; mensaje: string };

// ¿El punto de entrega está dentro de lo que cubre la zona? Sin radio cargado, o sin coordenadas del local, no hay
// nada que medir y se deja pasar (el límite es opcional).
export function verificarAlcance(punto: Punto, local: Punto | null, radioKm: number | null, nombreZona: string): VerificacionAlcance {
  if (!local || radioKm === null || !(radioKm > 0) || !esPuntoValido(punto.lat, punto.lng) || !esPuntoValido(local.lat, local.lng)) return { ok: true };
  const km = haversineKm(punto, local);
  if (km <= radioKm) return { ok: true };
  return {
    ok: false,
    km,
    mensaje: `Esa ubicación está a ${formatearDistancia(km)} del local y la zona "${nombreZona}" llega hasta ${formatearDistancia(radioKm)}. Elegí otra zona o pedí para retirar.`,
  };
}

export type LocalCerca = { id: string; slug: string; nombre: string; latitud: number | null; longitud: number | null };
export type SugerenciaLocal = { local: LocalCerca; km: number; kmActual: number };

// Si hay otro local claramente más cerca que el elegido (por lo menos `margenKm` menos), lo sugiere. Es un aviso: el
// cliente puede seguir con el que eligió (retira más tarde, pide para otro, el GPS no es exacto…).
export function sugerirLocalMasCercano(punto: Punto, actualId: string, locales: LocalCerca[], margenKm = 1.5): SugerenciaLocal | null {
  if (!esPuntoValido(punto.lat, punto.lng)) return null;
  const orden = ordenarPorCercania(locales, punto);
  const actual = orden.find((o) => o.local.id === actualId);
  const masCerca = orden[0];
  if (!actual || actual.km === null || !masCerca || masCerca.km === null || masCerca.local.id === actualId) return null;
  if (actual.km - masCerca.km < margenKm) return null;
  return { local: masCerca.local, km: masCerca.km, kmActual: actual.km };
}
