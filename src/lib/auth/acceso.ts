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

// Destinos de cada sistema.
export const RUTA_KIOSCO = "/admin/dashboard";
export const RUTA_TENTEO_PEDIDOS = "/tenteo/pedidos";
export const RUTA_TENTEO_REPARTOS = "/tenteo/repartos";

// Última elección de quien tiene los dos sistemas. Es una comodidad para no
// preguntar en cada login: solo mueve el destino, NUNCA da acceso (siempre se
// contrasta contra sistemasDe).
export const COOKIE_SISTEMA = "sistema_preferido";

export function sistemaValido(valor: unknown): Sistema | null {
  return typeof valor === "string" && (SISTEMAS as readonly string[]).includes(valor) ? (valor as Sistema) : null;
}

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

// Roles cuyo sistema no se elige: el admin ve todo y el repartidor solo tiene
// su pantalla de entregas. Para el resto devuelve null (se elige en Staff).
export function sistemasFijos(rol: Rol | null): Sistema[] | null {
  if (rol === "admin") return [...SISTEMAS];
  if (rol === "repartidor") return ["tenteo"];
  return null;
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
  const fijos = sistemasFijos(rol);
  if (fijos) return fijos;
  const crudo = user?.app_metadata?.sistemas;
  if (Array.isArray(crudo)) {
    const validos = SISTEMAS.filter((s) => crudo.includes(s));
    if (validos.length > 0) return validos;
  }
  return ["kiosco"];
}

// ¿Tiene guardado un dato de sistemas válido? Si no, se aplica el defecto (kiosco);
// Staff lo muestra como "por defecto". Los roles fijos no lo necesitan.
export function tieneSistemasGuardados(user: UsuarioAcceso): boolean {
  if (sistemasFijos(rolDe(user))) return false;
  const crudo = user?.app_metadata?.sistemas;
  return Array.isArray(crudo) && SISTEMAS.some((s) => crudo.includes(s));
}

// Qué guardar en app_metadata.sistemas al crear o editar a alguien con ese rol
// (solo lo llama el servidor, tras requireAdmin). Para los roles fijos no se guarda
// nada (valor null: se borra la clave, así no queda un dato viejo si cambian de rol).
// Para el resto exige al menos un sistema y rechaza valores desconocidos.
export function sistemasAGuardar(rol: Rol, elegidos: unknown): { valor: Sistema[] | null } | { error: string } {
  if (sistemasFijos(rol)) return { valor: null };
  if (!Array.isArray(elegidos) || elegidos.length === 0) return { error: "Elegí al menos un sistema (Kiosco o Tenteo)" };
  if (elegidos.some((e) => sistemaValido(e) === null)) return { error: "Sistema desconocido" };
  return { valor: SISTEMAS.filter((s) => elegidos.includes(s)) };
}

export function puedeEntrar(user: UsuarioAcceso, sistema: Sistema): boolean {
  return sistemasDe(user).includes(sistema);
}

// A qué sistema pertenece una ruta. null = no se controla por sistema.
export function sistemaDeRuta(pathname: string): Sistema | null {
  if (enRuta(pathname, "/tenteo")) return "tenteo";
  if (pathname.startsWith("/admin")) return "kiosco";
  return null;
}

export function destinoTenteo(rol: Rol | null): string {
  return rol === "repartidor" ? RUTA_TENTEO_REPARTOS : RUTA_TENTEO_PEDIDOS;
}

// Página de inicio de un sistema (para rebotar a alguien sin salir de su sistema).
export function destinoDeSistema(sistema: Sistema, rol: Rol | null): string {
  return sistema === "kiosco" ? RUTA_KIOSCO : destinoTenteo(rol);
}

// Adónde mandar al usuario cuando no corresponde donde está o recién entró.
// `preferido` (la última elección de quien tiene los dos sistemas) solo mueve
// el destino: nunca da acceso. null = no es personal.
export function destinoPorDefecto(user: UsuarioAcceso, preferido?: Sistema | null): string | null {
  const sistemas = sistemasDe(user);
  if (sistemas.length === 0) return null;
  const elegido: Sistema =
    preferido && sistemas.includes(preferido) ? preferido : sistemas.includes("kiosco") ? "kiosco" : "tenteo";
  return destinoDeSistema(elegido, rolDe(user));
}
