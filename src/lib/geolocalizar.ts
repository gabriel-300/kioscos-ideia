import type { Punto } from "@/lib/geo";

// Pedirle al navegador la ubicación actual (GPS), en un solo lugar: lo usan la pantalla "¿Dónde
// querés pedir?" (ordenar los locales por cercanía) y el pago de un envío (dejar el punto
// exacto de entrega). Solo corre en el navegador.
//
// `alternativa` completa el aviso cuando no se pudo ("elegí el local de la lista", "escribí tu
// dirección"), así el cliente siempre sabe qué hacer en vez de quedarse trabado.

const TIMEOUT_MS = 10_000;

// Navegadores embebidos (WhatsApp, Instagram, Facebook…) suelen bloquear la geolocalización.
const NAVEGADOR_EMBEBIDO = /FBAN|FBAV|Instagram|WhatsApp|Line\/|MicroMessenger|; wv\)/i;

export type ResultadoUbicacion = { punto: Punto } | { error: string };

function mensajes(alternativa: string) {
  return {
    denegado:      `No pudimos acceder a tu ubicación. Habilitá el permiso de ubicación del navegador o ${alternativa}.`,
    noDisponible:  `No pudimos saber dónde estás en este momento. Probá de nuevo o ${alternativa}.`,
    timeout:       `Tardó demasiado en encontrar tu ubicación. Probá de nuevo o ${alternativa}.`,
    embebido:      `Este navegador no deja usar tu ubicación. Abrí esta página en Chrome o Safari, o ${alternativa}.`,
  };
}

export function pedirUbicacion(alternativa: string): Promise<ResultadoUbicacion> {
  const m = mensajes(alternativa);
  const embebido = typeof navigator !== "undefined" && NAVEGADOR_EMBEBIDO.test(navigator.userAgent);
  return new Promise((resolver) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolver({ error: embebido ? m.embebido : m.noDisponible });
      return;
    }
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolver({ punto: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
        (err) => {
          // Si el permiso falla dentro de un navegador embebido, el motivo real es el navegador.
          resolver({
            error: err.code === err.PERMISSION_DENIED ? (embebido ? m.embebido : m.denegado)
              : err.code === err.TIMEOUT ? m.timeout
              : m.noDisponible,
          });
        },
        { timeout: TIMEOUT_MS, maximumAge: 60_000 }, // sin enableHighAccuracy: alcanza con aproximada y ahorra batería
      );
    } catch {
      // algunos navegadores embebidos lanzan en vez de avisar por el callback de error
      resolver({ error: embebido ? m.embebido : m.noDisponible });
    }
  });
}
