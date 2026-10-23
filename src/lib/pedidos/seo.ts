import type { TramoHorario } from "./horario";

// Posicionamiento en Google (SEO) de la tienda: direcciones cortas por local, datos estructurados y textos para
// compartir el enlace. Puro (sin base ni red): lo usan las páginas públicas, el sitemap y los tests.

export const SITIO = "https://www.angirufood.com.ar";
export const INSTAGRAM = "https://www.instagram.com/angirufood";
export const IMAGEN_COMPARTIR = "/marca/og-angiru-food.jpg"; // 1200x630
export const LOGO_SITIO = "/marca/angiru-food-logo.png";

// Dirección corta del local: "Angiru Food UNAM" -> "unam" (angirufood.com.ar/unam). Sale del nombre, así no hay
// que cargar nada aparte; si un día dos locales dieran el mismo, hay que cambiar uno de los nombres.
export function slugDeSucursal(nombre: string): string {
  const s = nombre
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^\s*angiru\s+food\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "angiru-food";
}

export const rutaLocal = (nombre: string) => `/${slugDeSucursal(nombre)}`;

// "Angiru Food UNAM " -> "Angiru Food UNAM" (los nombres vienen con espacios de más de la base).
export const nombreLimpio = (nombre: string) => nombre.trim().replace(/\s+/g, " ");

const DIAS_SCHEMA = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function horarioSchema(horario: TramoHorario[] | null) {
  if (!horario || horario.length === 0) return undefined;
  return horario
    .filter((t) => t.dia >= 0 && t.dia <= 6)
    .map((t) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: DIAS_SCHEMA[t.dia], opens: t.abre, closes: t.cierra }));
}

// "3764255000" -> "+543764255000"; ya con 54 -> "+54...". Cualquier cosa rara = sin teléfono.
export function telefonoInternacional(crudo: string | null | undefined): string | undefined {
  const d = (crudo ?? "").replace(/\D/g, "");
  if (/^54\d{10,11}$/.test(d)) return `+${d}`;
  if (/^\d{10}$/.test(d)) return `+54${d}`;
  return undefined;
}

export type DatosLocalSeo = {
  nombre:    string;
  direccion: string | null;
  localidad: string | null;
  telefono:  string | null;
  horario:   TramoHorario[] | null;
  latitud:   number | null;
  longitud:  number | null;
};

export const DESCRIPCION_MARCA =
  "Bocaditos, chipas, pizzas y empanadas elaborados con materia prima del Litoral, cocidos en horno Rational y ultracongelados. Desde Posadas, Misiones.";

export function descripcionLocal(l: Pick<DatosLocalSeo, "nombre" | "direccion">): string {
  return `Pedí online en ${nombreLimpio(l.nombre)}${l.direccion ? ` (${l.direccion.trim()})` : ""}: bocaditos, chipas, pizzas y empanadas elaborados con materia prima del Litoral. Retiro en el local o envío a domicilio en Posadas, Misiones.`;
}

// Datos estructurados (schema.org) del local: Google los usa para mostrar dirección, teléfono y horarios.
export function jsonLdLocal(l: DatosLocalSeo): Record<string, unknown> {
  const url = `${SITIO}${rutaLocal(l.nombre)}`;
  const telefono = telefonoInternacional(l.telefono);
  const horario = horarioSchema(l.horario);
  return {
    "@context": "https://schema.org",
    "@type": "Bakery",
    "@id": `${url}#local`,
    name: nombreLimpio(l.nombre),
    url,
    image: `${SITIO}${IMAGEN_COMPARTIR}`,
    logo: `${SITIO}${LOGO_SITIO}`,
    description: descripcionLocal(l),
    servesCuisine: "Panadería, confitería y delicatessen",
    ...(telefono ? { telephone: telefono } : {}),
    address: {
      "@type": "PostalAddress",
      ...(l.direccion ? { streetAddress: l.direccion.trim() } : {}),
      addressLocality: l.localidad?.trim() || "Posadas",
      addressRegion: "Misiones",
      addressCountry: "AR",
    },
    ...(l.latitud !== null && l.longitud !== null ? { geo: { "@type": "GeoCoordinates", latitude: l.latitud, longitude: l.longitud } } : {}),
    ...(horario ? { openingHoursSpecification: horario } : {}),
    hasMenu: url,
    potentialAction: { "@type": "OrderAction", target: url },
    sameAs: [INSTAGRAM],
  };
}

// Datos estructurados de la marca (portada).
export function jsonLdMarca(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Angiru Food",
    url: SITIO,
    logo: `${SITIO}${LOGO_SITIO}`,
    description: DESCRIPCION_MARCA,
    sameAs: [INSTAGRAM],
  };
}
