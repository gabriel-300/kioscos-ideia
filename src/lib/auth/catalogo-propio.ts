import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
export { filtroCatalogoDe } from "@/lib/catalogo-dueno";

// Catálogo con dueño (migración 131). Dos tipos de persona pueden tocar productos,
// categorías y promos:
//   - admin: todo el catálogo (el global de IDEIA y el de cualquier dueño).
//   - concesionario cuya sucursal tenga catalogo_propio = true: SOLO lo que es de su
//     sucursal (owner_sucursal_id = la suya). Lo global no lo puede modificar.
// Cualquier otro rol (encargado, vendedor, concesionario sin catálogo propio) no entra.
//
// Sin "use server": es una guarda interna de las Server Actions, no un endpoint.

export interface AlcanceCatalogo {
  userId: string;
  role: string;
  /** null = admin (sin límite); un id = dueño, solo filas con ese owner_sucursal_id. */
  ownerSucursalId: string | null;
}

/** Sucursal con catálogo propio que maneja este usuario, o null si no tiene. */
export async function sucursalConCatalogoPropio(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await (admin as any)
    .from("sucursales")
    .select("id")
    .eq("encargado_user_id", userId)
    .eq("catalogo_propio", true)
    .eq("is_active", true)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** Alcance del usuario sobre el catálogo, o null si no puede gestionarlo. */
export async function alcanceCatalogo(userId: string, role: string): Promise<AlcanceCatalogo | null> {
  if (role === "admin") return { userId, role, ownerSucursalId: null };
  if (role !== "concesionario") return null;
  const suc = await sucursalConCatalogoPropio(userId);
  return suc ? { userId, role, ownerSucursalId: suc } : null;
}

export async function requireCatalogo(): Promise<AlcanceCatalogo> {
  const { userId, role } = await requireStaff();
  const alcance = await alcanceCatalogo(userId, role);
  if (!alcance) throw new Error("Sin permisos para gestionar el catálogo");
  return alcance;
}

/** ¿Puede este alcance modificar una fila cuyo dueño es `ownerDeFila`? */
export function puedeEditarFila(alcance: AlcanceCatalogo, ownerDeFila: string | null): boolean {
  if (alcance.ownerSucursalId === null) return true; // admin
  return ownerDeFila === alcance.ownerSucursalId;
}

/** Lee el dueño actual de una fila y valida que el alcance pueda tocarla. */
export async function validarFilaEditable(
  alcance: AlcanceCatalogo,
  tabla: "products" | "categories" | "promos",
  id: string
): Promise<string | null> {
  if (alcance.ownerSucursalId === null) return null;
  const admin = createAdminClient();
  const { data } = await (admin as any).from(tabla).select("owner_sucursal_id").eq("id", id).maybeSingle();
  if (!data) return "No existe";
  return puedeEditarFila(alcance, (data as { owner_sucursal_id: string | null }).owner_sucursal_id)
    ? null
    : "No podés modificar el catálogo de IDEIA ni el de otro local";
}

/** Concesionario dueño de una sucursal con catálogo propio (no admin): su sucursal. */
export async function requireDueno(): Promise<{ userId: string; sucursalId: string }> {
  const { userId, role } = await requireStaff();
  const suc = role === "concesionario" ? await sucursalConCatalogoPropio(userId) : null;
  if (!suc) throw new Error("Sin permisos");
  return { userId, sucursalId: suc };
}

/**
 * Verifica que todos esos productos puedan existir en esa sucursal: globales o propios de
 * ELLA. Devuelve un mensaje de error o null. Es la defensa de las acciones que reciben
 * `product_id` del cliente y escriben con el cliente admin (precios, transferencias,
 * auditorías): sin esto, alguien podría colgarle a su local un producto propio de otro.
 */
export async function validarProductosDeSucursal(
  admin: ReturnType<typeof createAdminClient>,
  productIds: string[],
  sucursalId: string
): Promise<string | null> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return null;
  const { data, error } = await (admin as any).from("products").select("id, owner_sucursal_id").in("id", ids);
  if (error) return error.message;
  const filas = (data ?? []) as { id: string; owner_sucursal_id: string | null }[];
  if (filas.length !== ids.length) return "Uno de los productos no existe.";
  if (filas.some((p) => p.owner_sucursal_id != null && p.owner_sucursal_id !== sucursalId)) {
    return "Uno de los productos no está disponible en esta sucursal.";
  }
  return null;
}
