"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess as checkAccesoSucursal } from "@/lib/auth/sucursal-access";
import { fechaHoyAR } from "@/lib/fecha";

// Mismo criterio que el resto de las server actions del proyecto (ver
// cierre-actions.ts / movimientos/actions.ts): devolver {error} en vez de
// throw, porque Next.js oculta el mensaje de las excepciones lanzadas desde
// Server Actions en producción.

export async function crearTermo(data: { sucursal_id: string; numero: string; tipo: "frio" | "caliente"; image_url?: string | null }): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  if (role === "vendedor") return { error: "No tenés permisos para dar de alta termos" };
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  const numero = data.numero.trim();
  if (!numero) return { error: "Ingresá un número de termo" };

  const { error } = await (admin as any).from("termos").insert({ sucursal_id: data.sucursal_id, numero, tipo: data.tipo, image_url: data.image_url || null });
  if (error) {
    if (error.code === "23505") return { error: `Ya existe un termo N° ${numero} en esta sucursal` };
    return { error: error.message };
  }

  revalidatePath("/admin/termos");
  return {};
}

export async function actualizarFotoTermo(termoId: string, sucursalId: string, imageUrl: string | null): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  if (role === "vendedor") return { error: "No tenés permisos para editar la foto de un termo" };
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, sucursalId);
  if (accesoError) return { error: accesoError };

  const { error } = await (admin as any).from("termos").update({ image_url: imageUrl }).eq("id", termoId);
  if (error) return { error: error.message };

  revalidatePath("/admin/termos");
  revalidatePath(`/admin/sucursales/${sucursalId}`);
  return {};
}

export async function actualizarTermo(data: { termo_id: string; sucursal_id: string; numero: string; tipo: "frio" | "caliente" }): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  if (role === "vendedor") return { error: "No tenés permisos para editar termos" };
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  const numero = data.numero.trim();
  if (!numero) return { error: "Ingresá un número de termo" };

  const { error } = await (admin as any).from("termos").update({ numero, tipo: data.tipo }).eq("id", data.termo_id);
  if (error) {
    if (error.code === "23505") return { error: `Ya existe un termo N° ${numero} en esta sucursal` };
    return { error: error.message };
  }

  revalidatePath("/admin/termos");
  return {};
}

export async function darDeBajaTermo(termoId: string, sucursalId: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  if (role === "vendedor") return { error: "No tenés permisos para dar de baja un termo" };
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, sucursalId);
  if (accesoError) return { error: accesoError };

  const { data: termo } = await (admin as any).from("termos").select("estado").eq("id", termoId).single();
  if (termo?.estado === "prestado") {
    return { error: "No podés dar de baja un termo prestado -- registrá la devolución primero" };
  }

  const { error } = await (admin as any).from("termos").update({ estado: "baja" }).eq("id", termoId);
  if (error) return { error: error.message };

  revalidatePath("/admin/termos");
  return {};
}

export async function reactivarTermo(termoId: string, sucursalId: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  if (role === "vendedor") return { error: "No tenés permisos para reactivar un termo" };
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, sucursalId);
  if (accesoError) return { error: accesoError };

  const { error } = await (admin as any).from("termos").update({ estado: "disponible" }).eq("id", termoId);
  if (error) return { error: error.message };

  revalidatePath("/admin/termos");
  return {};
}

export async function prestarTermo(data: {
  sucursal_id:    string;
  termo_id:       string;
  dni:            string;
  telefono:       string;
  nombre?:        string | null;
  movimiento_id?: string | null;
}): Promise<{ error?: string; id?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  const dni = data.dni.trim();
  if (!dni) return { error: "Ingresá el DNI" };
  const telefono = data.telefono.trim();
  if (!telefono) return { error: "Ingresá el teléfono" };

  const { data: rpcData, error } = await (admin as any).rpc("prestar_termo", {
    p_termo_id:      data.termo_id,
    p_dni:           dni,
    p_telefono:      telefono,
    p_nombre:        data.nombre || null,
    p_movimiento_id: data.movimiento_id || null,
    p_created_by:    userId,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/termos");
  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  return { id: rpcData as string };
}

export async function devolverTermo(data: { prestamo_id: string; sucursal_id: string }): Promise<{ error?: string; monto_multa?: number }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  const { data: rpcData, error } = await (admin as any).rpc("devolver_termo", {
    p_prestamo_id: data.prestamo_id,
    p_devuelto_by: userId,
  });
  if (error) return { error: error.message };

  revalidatePath("/admin/termos");
  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  return { monto_multa: (rpcData as number) ?? 0 };
}

// El cobro de la multa se registra como un movimiento tipo "venta" con un
// producto de servicio ficticio (sku MULTA-TERMO, ver migración 063) -- así
// entra a la conciliación de caja del cierre de turno igual que cualquier
// venta, sin tener que tocar esa lógica (ya es la parte más sensible/probada
// del sistema). Se llama al RPC directo (no a crearMovimiento) porque ese
// wrapper fuerza el precio de catálogo para ventas normales -- acá el monto
// es distinto en cada préstamo, no un precio de lista.
export async function pagarMultaTermo(data: {
  prestamo_id:         string;
  sucursal_id:         string;
  pago_efectivo:       number;
  pago_billetera:      number;
  pago_tarjeta:        number;
  pago_transferencia:  number;
}): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  const { data: prestamo } = await (admin as any)
    .from("prestamos_termo")
    .select("dni, monto_multa, multa_pagada_en")
    .eq("id", data.prestamo_id)
    .single();
  if (!prestamo) return { error: "Préstamo no encontrado" };
  if (prestamo.multa_pagada_en) return { error: "Esta multa ya está pagada" };
  if (!(prestamo.monto_multa > 0)) return { error: "Este préstamo no tiene multa" };

  const total = data.pago_efectivo + data.pago_billetera + data.pago_tarjeta + data.pago_transferencia;
  if (Math.round(total * 100) !== Math.round(prestamo.monto_multa * 100)) {
    return { error: `El total ingresado (${total}) no coincide con la multa ($${prestamo.monto_multa})` };
  }

  const { data: producto } = await (admin as any).from("products").select("id").eq("sku", "MULTA-TERMO").single();
  if (!producto) return { error: "Falta el producto de servicio MULTA-TERMO -- avisale a soporte" };

  const { data: movRes, error: movError } = await (admin as any).rpc("crear_movimiento_con_items", {
    p_sucursal_id:             data.sucursal_id,
    p_fecha:                   fechaHoyAR(),
    p_tipo:                    "venta",
    p_notas:                   `Multa por atraso de termo — DNI ${prestamo.dni}`,
    p_proveedor:               null,
    p_nro_remito:               null,
    p_canal:                   "multa_termo",
    p_personal_id:             null,
    p_pago_efectivo:           data.pago_efectivo       || null,
    p_pago_billetera:          data.pago_billetera      || null,
    p_pago_tarjeta:            data.pago_tarjeta        || null,
    p_pago_transferencia:      data.pago_transferencia  || null,
    p_created_by:              userId,
    p_items: [{ product_id: producto.id, cantidad: 1, precio_unitario: prestamo.monto_multa, subtotal: prestamo.monto_multa, promo_id: null }],
  });
  if (movError) return { error: movError.message };

  const { error: updError } = await (admin as any)
    .from("prestamos_termo")
    .update({ multa_pagada_en: new Date().toISOString(), multa_movimiento_id: movRes })
    .eq("id", data.prestamo_id);
  if (updError) return { error: updError.message };

  revalidatePath("/admin/termos");
  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  revalidatePath("/admin/cierres");
  return {};
}

export async function actualizarConfigMulta(data: {
  sucursal_id:              string;
  termo_horas_limite:       number;
  termo_tarifa_multa_hora:  number;
}): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  if (role === "vendedor") return { error: "No tenés permisos para cambiar esta configuración" };
  const admin = createAdminClient();

  const accesoError = await checkAccesoSucursal(admin, userId, role, data.sucursal_id);
  if (accesoError) return { error: accesoError };

  if (data.termo_horas_limite < 0 || data.termo_tarifa_multa_hora < 0) {
    return { error: "Los valores no pueden ser negativos" };
  }

  const { error } = await (admin as any)
    .from("sucursales")
    .update({ termo_horas_limite: data.termo_horas_limite, termo_tarifa_multa_hora: data.termo_tarifa_multa_hora })
    .eq("id", data.sucursal_id);
  if (error) return { error: error.message };

  revalidatePath("/admin/termos");
  return {};
}
