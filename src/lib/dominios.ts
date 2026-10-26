// Dominio de cara a los CLIENTES (Angiru Food). El personal sigue entrando por la
// dirección de siempre (workers.dev) o por el mismo dominio en /login, /admin y
// /tenteo: acá solo se decide qué ve un cliente al abrir la raíz.
//
// Una sola dirección oficial: la versión sin www redirige a la de www. Las
// sesiones (cookies) son por dirección: si quedaran las dos, un cliente que ingresó
// con Google en una aparecería sin sesión en la otra.

export const DOMINIO_CLIENTES = "www.angirufood.com.ar";
export const DOMINIO_CLIENTES_SIN_WWW = "angirufood.com.ar";

// "Angirufood.com.ar:443" -> "angirufood.com.ar"
export function hostSinPuerto(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

export function esDominioClientes(host: string): boolean {
  return host === DOMINIO_CLIENTES;
}

export function esDominioClientesSinWww(host: string): boolean {
  return host === DOMINIO_CLIENTES_SIN_WWW;
}

// Zonas del personal: en el dominio de clientes no existen (404), así el login y los paneles no se
// ofrecen a quien llega por la tienda. El personal entra por la dirección de workers.dev.
// /auth queda abierto: lo usan el ingreso con Google de los clientes y los enlaces de los mails.
const PREFIJOS_SOLO_PERSONAL = ["/login", "/admin", "/tenteo", "/registro", "/registro-mayorista", "/forgot-password", "/pendiente", "/elegir-sistema"];

export function esRutaSoloPersonal(pathname: string): boolean {
  return PREFIJOS_SOLO_PERSONAL.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Direcciones cortas por local (angirufood.com.ar/unam): una sola palabra después de la barra que no sea una
// zona de la aplicación. En el dominio de clientes se reescriben a /pedir/<dirección corta>.
export const SEGMENTOS_RESERVADOS = new Set([
  "admin", "tenteo", "login", "registro", "registro-mayorista", "forgot-password", "pendiente",
  "elegir-sistema", "auth", "api", "pedir", "privacidad", "terminos",
]);

export function slugDeRutaCorta(pathname: string): string | null {
  const m = /^\/([a-z0-9][a-z0-9-]*)\/?$/.exec(pathname);
  if (!m) return null;
  const s = m[1];
  return SEGMENTOS_RESERVADOS.has(s) || s.startsWith("google") ? null : s;
}
