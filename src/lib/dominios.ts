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
