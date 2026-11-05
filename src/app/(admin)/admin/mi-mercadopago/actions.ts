"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { sucursalConCatalogoPropio } from "@/lib/auth/catalogo-propio";
import { cifrarToken, credencialesDeSucursal } from "@/lib/mercadopago/credenciales";
import { asignarExternalIdConToken, cuentaDelToken, listarCajasConToken, type CajaMp } from "@/lib/mercadopago/pos";

// Cuenta de Mercado Pago de un local independiente (catalogo_propio, migración 131 / 134). El dueño conecta SU cuenta
// con su Access Token y elige su Caja: así el QR de sus ventas cobra en su cuenta y no en la de IDEIA.
// El token entra una vez, se verifica contra Mercado Pago, se guarda cifrado y no vuelve nunca al navegador.
// Lo puede hacer el dueño de la sucursal o un admin (indicando la sucursal).

async function resolverSucursal(sucursalId?: string): Promise<{ userId: string; sucursalId: string } | { error: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();
  if (role === "admin") {
    if (!sucursalId) return { error: "Falta indicar la sucursal" };
    const { data } = await (admin as any).from("sucursales").select("catalogo_propio").eq("id", sucursalId).maybeSingle();
    if (!data?.catalogo_propio) return { error: "Esta sucursal no es un local independiente" };
    return { userId, sucursalId };
  }
  const propia = role === "concesionario" ? await sucursalConCatalogoPropio(userId) : null;
  if (!propia) return { error: "Sin permisos" };
  return { userId, sucursalId: propia }; // el dueño solo toca la suya: se ignora cualquier id que mande el cliente
}

export interface EstadoMercadoPago {
  conectado: boolean;
  cuenta: string | null;
  /** Número de la cuenta de Mercado Pago conectada (para que el dueño verifique que es la suya). */
  cuentaId: string | null;
  posId: string | null;
}

export async function estadoMercadoPago(sucursalId?: string): Promise<{ error?: string; estado?: EstadoMercadoPago }> {
  const r = await resolverSucursal(sucursalId);
  if ("error" in r) return r;
  const admin = createAdminClient();
  const [{ data: cred }, { data: suc }] = await Promise.all([
    (admin as any).from("sucursal_mercadopago").select("mp_cuenta, mp_user_id").eq("sucursal_id", r.sucursalId).maybeSingle(),
    (admin as any).from("sucursales").select("mercadopago_pos_id").eq("id", r.sucursalId).maybeSingle(),
  ]);
  return {
    estado: {
      conectado: !!cred,
      cuenta: (cred as { mp_cuenta: string | null } | null)?.mp_cuenta ?? null,
      cuentaId: (cred as { mp_user_id: string | null } | null)?.mp_user_id ?? null,
      posId: (suc as { mercadopago_pos_id: string | null } | null)?.mercadopago_pos_id ?? null,
    },
  };
}

/** Conecta la cuenta: verifica el token contra Mercado Pago y lo guarda cifrado. */
export async function conectarMercadoPago(token: string, sucursalId?: string): Promise<{ error?: string; cuenta?: string }> {
  const r = await resolverSucursal(sucursalId);
  if ("error" in r) return r;
  const limpio = token.trim();
  if (/^APP_USR-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(limpio)) {
    return { error: "Eso es la Public Key, no el Access Token. Copiá el campo \"Access Token\" de las credenciales de producción." };
  }
  if (/^TEST-/i.test(limpio)) return { error: "Ese es un token de prueba. Necesitás el Access Token de PRODUCCIÓN (empieza con APP_USR-)." };
  if (!/^APP_USR-[0-9]+-[0-9]{4,8}-[0-9a-f]{20,64}-[0-9]+$/i.test(limpio)) {
    return { error: "No parece un Access Token de Mercado Pago (tiene la forma APP_USR-números-números-letras-números). Copialo completo, sin espacios." };
  }

  const cuenta = await cuentaDelToken(limpio);
  if (cuenta.error || !cuenta.userId) return { error: cuenta.error ?? "No se pudo verificar el token" };

  // La cuenta de IDEIA no se puede conectar a un local independiente (la plata se mezclaría).
  const ideia = process.env.MERCADOPAGO_USER_ID;
  if (ideia && cuenta.userId === ideia) return { error: "Ese token es de la cuenta de IDEIA. Cada local tiene que usar su propia cuenta." };

  let cifrado: string;
  try { cifrado = await cifrarToken(limpio); } catch (e) { return { error: (e as Error).message }; }

  const admin = createAdminClient();
  const { error } = await (admin as any).from("sucursal_mercadopago").upsert({
    sucursal_id:          r.sucursalId,
    access_token_cifrado: cifrado,
    mp_user_id:           cuenta.userId,
    mp_cuenta:            cuenta.cuenta ?? null,
    updated_at:           new Date().toISOString(),
    updated_by:           r.userId,
  }, { onConflict: "sucursal_id" });
  if (error) return { error: error.message };

  // Si cambió de cuenta, la Caja anterior ya no sirve.
  await (admin as any).from("sucursales").update({ mercadopago_pos_id: null }).eq("id", r.sucursalId);
  revalidatePath("/admin/mi-mercadopago");
  return { cuenta: cuenta.cuenta };
}

export async function desconectarMercadoPago(sucursalId?: string): Promise<{ error?: string }> {
  const r = await resolverSucursal(sucursalId);
  if ("error" in r) return r;
  const admin = createAdminClient();
  const { error } = await (admin as any).from("sucursal_mercadopago").delete().eq("sucursal_id", r.sucursalId);
  if (error) return { error: error.message };
  await (admin as any).from("sucursales").update({ mercadopago_pos_id: null }).eq("id", r.sucursalId);
  revalidatePath("/admin/mi-mercadopago");
  return {};
}

async function tokenPropio(sucursalId: string): Promise<{ error: string } | { accessToken: string }> {
  const cred = await credencialesDeSucursal(createAdminClient(), sucursalId);
  if (!cred?.propia) return { error: "Primero conectá tu cuenta de Mercado Pago" };
  return { accessToken: cred.accessToken };
}

export async function buscarCajasMercadoPago(sucursalId?: string): Promise<{ error?: string; cajas?: CajaMp[] }> {
  const r = await resolverSucursal(sucursalId);
  if ("error" in r) return r;
  const t = await tokenPropio(r.sucursalId);
  if ("error" in t) return t;
  return listarCajasConToken(t.accessToken);
}

export async function asignarIdCajaMercadoPago(internalId: string, nombre: string, sucursalId?: string): Promise<{ error?: string; externalId?: string }> {
  const r = await resolverSucursal(sucursalId);
  if ("error" in r) return r;
  if (!/^\d{1,20}$/.test(internalId)) return { error: "Caja inválida" };
  const t = await tokenPropio(r.sucursalId);
  if ("error" in t) return t;
  return asignarExternalIdConToken(t.accessToken, internalId, nombre);
}

/** Deja elegida la Caja con la que cobra el QR de este local. */
export async function elegirCajaMercadoPago(externalId: string, sucursalId?: string): Promise<{ error?: string }> {
  const r = await resolverSucursal(sucursalId);
  if ("error" in r) return r;
  const id = externalId.trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return { error: "El ID de la Caja no es válido" };
  const t = await tokenPropio(r.sucursalId);
  if ("error" in t) return t;
  // Solo se acepta una Caja que realmente exista en SU cuenta.
  const lista = await listarCajasConToken(t.accessToken);
  if (lista.error) return { error: lista.error };
  if (!lista.cajas?.some((c) => c.externalId === id)) return { error: "Esa Caja no existe en tu cuenta de Mercado Pago" };

  const admin = createAdminClient();
  const { error } = await (admin as any).from("sucursales").update({ mercadopago_pos_id: id }).eq("id", r.sucursalId);
  if (error) return { error: error.message };
  revalidatePath("/admin/mi-mercadopago");
  return {};
}
