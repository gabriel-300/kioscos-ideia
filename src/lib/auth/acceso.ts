// Fuente ÚNICA de "quién entra adónde". Módulo puro (sin Supabase, sin "use
// server"): lo usan el middleware, los layouts, /auth/redirect, el callback
// de clientes y las guardas de servidor (require-role.ts). Antes cada uno
// tenía su propia lista de roles y el repartidor quedó trabado dos veces por
// una lista que no lo incluía. Si hace falta un rol o un sistema nuevo, se
// agrega ACÁ y nada más (hay un test que falla si reaparece una lista suelta).
//
// El dato vive en app_metadata (solo lo escribe el servidor), NUNCA en
// user_metadata (el propio usuario puede editarlo):
//   app_metadata.role     rol dentro del sistema (admin, encargado, ...)
//   app_metadata.sistemas array con "kiosco" y/o "tenteo"

export const ROLES_PERSONAL = ["admin", "encargado", "vendedor", "concesionario", "repartidor"] as const;
export type Rol = (typeof ROLES_PERSONAL)[number];

// Roles con alcance por sucursal (sucursal-access.ts) y los que pasan requireStaff:
// todos menos el repartidor, que tiene su propia guarda.
export const ROLES_CON_SUCURSAL = ["admin", "encargado", "concesionario", "vendedor"] as const;

export const SISTEMAS = ["kiosco", "tenteo"] as const;
export type Sistema = (typeof SISTEMAS)[number];

// Lo mínimo que se lee de un usuario de Supabase Auth (acepta un User entero).
export type UsuarioAcceso = { app_metadata?: Record<string, any> | null } | null | undefined;

// Destinos. Mientras las pantallas de Tenteo vivan bajo /admin, estas dos
// constantes apuntan ahí; cuando se muden, se cambian acá.
export const RUTA_KIOSCO = "/admin/dashboard";
export const RUTA_TENTEO_PEDIDOS = "/admin/pedidos-online";
export const RUTA_TENTEO_REPARTOS = "/admin/repartos";

// Rutas de Tenteo que todavía viven bajo /admin: se controlan solo por rol,
// como siempre (el personal que atiende pedidos hoy no pierde acceso). Se
// eliminan cuando las pantallas se muden a /tenteo.
const RUTAS_EN_TRANSICION = [RUTA_TENTEO_PEDIDOS, RUTA_TENTEO_REPARTOS];

export function enRuta(pathname: string, prefijo: string): boolean {
  return pathname === prefijo || pathname.startsWith(prefijo + "/");
}

export function rolDe(user: UsuarioAcceso): Rol | null {
  const role = user?.app_metadata?.role;
  return typeof role === "string" && (ROLES_PERSONAL as readonly string[]).includes(role) ? (role as Rol) : null;
}

// Un cliente que entra con Google (o una cuenta de signup público) no tiene rol:
// no es personal y no entra a ningún sistema.
export function esPersonal(user: UsuarioAcceso): boolean {
  return rolDe(user) !== null;
}

// Sistemas a los que pertenece el usuario:
//  - sin rol: ninguno.
//  - admin: ambos, tenga o no el dato (es el único rol que ve todo).
//  - repartidor: solo Tenteo (su única pantalla es la de entregas).
//  - resto: lo que diga app_metadata.sistemas; sin dato, vacío o inválido,
//    se lo trata como del kiosco para que nadie pierda acceso.
export function sistemasDe(user: UsuarioAcceso): Sistema[] {
  const rol = rolDe(user);
  if (!rol) return [];
  if (rol === "admin") return [...SISTEMAS];
  if (rol === "repartidor") return ["tenteo"];
  const crudo = user?.app_metadata?.sistemas;
  if (Array.isArray(crudo)) {
    const validos = SISTEMAS.filter((s) => crudo.includes(s));
    if (validos.length > 0) return validos;
  }
  return ["kiosco"];
}

export function puedeEntrar(user: UsuarioAcceso, sistema: Sistema): boolean {
  return sistemasDe(user).includes(sistema);
}

// A qué sistema pertenece una ruta. null = no se controla por sistema.
export function sistemaDeRuta(pathname: string): Sistema | null {
  if (enRuta(pathname, "/tenteo")) return "tenteo";
  if (RUTAS_EN_TRANSICION.some((r) => enRuta(pathname, r))) return null;
  if (pathname.startsWith("/admin")) return "kiosco";
  return null;
}

export function destinoTenteo(rol: Rol | null): string {
  return rol === "repartidor" ? RUTA_TENTEO_REPARTOS : RUTA_TENTEO_PEDIDOS;
}

// Adónde mandar al usuario cuando no corresponde donde está o recién entró.
// `preferido` (la última elección de quien tiene los dos sistemas) solo mueve
// el destino: nunca da acceso. null = no es personal.
export function destinoPorDefecto(user: UsuarioAcceso, preferido?: Sistema | null): string | null {
  const sistemas = sistemasDe(user);
  if (sistemas.length === 0) return null;
  const elegido: Sistema =
    preferido && sistemas.includes(preferido) ? preferido : sistemas.includes("kiosco") ? "kiosco" : "tenteo";
  return elegido === "kiosco" ? RUTA_KIOSCO : destinoTenteo(rolDe(user));
}
