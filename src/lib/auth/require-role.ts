import { createClient } from "@/lib/supabase/server";
import { ROLES_CON_SUCURSAL, puedeEntrar, rolDe, type Sistema } from "@/lib/auth/acceso";

// Sin "use server" a propósito: son guardas internas que llaman las Server
// Actions, no acciones invocables desde el navegador. Con la directiva quedaban
// expuestas como endpoints (solo devolvían el id y el rol, pero no corresponde).
//
// Además del rol, cada guarda exige pertenecer al sistema de la acción: sin
// esto, un usuario solo de Tenteo podría llamar por POST a una acción del
// kiosco (y al revés), porque el middleware solo mira las rutas de páginas.
// El dato "sistemas" se resuelve en lib/auth/acceso.ts.

async function usuarioActual() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado");
  return user;
}

async function requirePersonal(sistema: Sistema): Promise<{ userId: string; role: string }> {
  const user = await usuarioActual();
  const role = rolDe(user);
  if (!role || !(ROLES_CON_SUCURSAL as readonly string[]).includes(role) || !puedeEntrar(user, sistema)) {
    throw new Error("Sin permisos");
  }
  return { userId: user.id, role };
}

export async function requireAdmin(): Promise<{ userId: string }> {
  const user = await usuarioActual();
  if (rolDe(user) !== "admin") throw new Error("Sin permisos de administrador");
  return { userId: user.id };
}

// Personal del KIOSCO: admin, encargado, vendedor, concesionario (no repartidor, a propósito).
export async function requireStaff(): Promise<{ userId: string; role: string }> {
  return requirePersonal("kiosco");
}

// Mismos roles, pero del sistema TENTEO (pedidos online). Lo usan las acciones de
// la zona de Tenteo.
export async function requireStaffTenteo(): Promise<{ userId: string; role: string }> {
  return requirePersonal("tenteo");
}

// Repartidor es un rol aparte, a propósito NO incluido en requireStaff()
// (esa función la usan decenas de Server Actions del resto del admin, y
// nunca se auditaron pensando en un repartidor viendo esas pantallas). Solo
// las acciones de repartos usan este chequeo angosto. Admin siempre
// puede, mismo criterio que requireAdminOAccesoSucursal en reposicion.
export async function requireRepartidor(): Promise<{ userId: string; role: string }> {
  const user = await usuarioActual();
  const role = rolDe(user);
  if ((role !== "repartidor" && role !== "admin") || !puedeEntrar(user, "tenteo")) throw new Error("Sin permisos");
  return { userId: user.id, role };
}
