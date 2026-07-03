"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaff } from "@/lib/auth/require-role";

export interface ItemInput {
  product_id:      string;
  cantidad:        number;
  precio_unitario: number | null;
}

export interface PromoItemInput {
  promo_id: string;
  cantidad: number;
}

type VentaItemInput = ItemInput | PromoItemInput;

function esPromoItem(item: VentaItemInput): item is PromoItemInput {
  return "promo_id" in item;
}

export async function crearMovimiento(data: {
  sucursal_id:       string;
  fecha:             string;
  tipo:              "entrega" | "devolucion" | "ajuste" | "venta";
  notas:             string | null;
  items:             VentaItemInput[];
  proveedor?:        string | null;
  nro_remito?:       string | null;
  remito_image_url?: string | null;
  canal?:            string | null;
  personal_id?:      string | null;
  pago_efectivo?:      number | null;
  pago_billetera?:     number | null;
  pago_tarjeta?:       number | null;
  pago_transferencia?: number | null;
}) {
  const { userId, role } = await requireStaff();
  const supabase         = createAdminClient();

  // Encargados no pueden hacer ajustes de stock
  if (role === "encargado" && data.tipo === "ajuste") {
    throw new Error("No tenés permisos para realizar ajustes de stock");
  }

  // Encargados y vendedores solo pueden registrar en su propia sucursal
  if (role === "encargado") {
    const { data: suc } = await supabase
      .from("sucursales")
      .select("encargado_user_id")
      .eq("id", data.sucursal_id)
      .single();
    if (suc?.encargado_user_id !== userId) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }
  if (role === "vendedor") {
    const profileRes = await (supabase as any)
      .from("profiles")
      .select("sucursal_id")
      .eq("id", userId)
      .single();
    const profile = profileRes.data as { sucursal_id: string | null } | null;
    if (profile?.sucursal_id !== data.sucursal_id) {
      throw new Error("No tenés permisos para esta sucursal");
    }
  }

  const promoInputs   = data.items.filter(esPromoItem);
  const productInputs = data.items.filter((i): i is ItemInput => !esPromoItem(i));

  const expandedPromoItems: {
    product_id: string; cantidad: number; precio_unitario: number | null; subtotal: number | null; promo_id: string;
  }[] = [];

  if (promoInputs.length > 0) {
    const promoIds = [...new Set(promoInputs.map((i) => i.promo_id))];
    const { data: promos, error: promosError } = await (supabase as any)
      .from("promos")
      .select("id, price, is_active, promo_items(product_id, cantidad)")
      .in("id", promoIds);
    if (promosError) throw new Error(promosError.message);

    type PromoRow = { id: string; price: number; is_active: boolean; promo_items: { product_id: string; cantidad: number }[] };
    const promoMap = new Map<string, PromoRow>((promos ?? []).map((p: PromoRow) => [p.id, p]));

    for (const input of promoInputs) {
      const promo = promoMap.get(input.promo_id);
      if (!promo) throw new Error("Promoción no encontrada");
      if (!promo.is_active) throw new Error(`La promoción "${promo.id}" ya no está activa`);
      if (!promo.promo_items || promo.promo_items.length === 0) {
        throw new Error("La promoción no tiene productos configurados");
      }
      const subtotalTotal = input.cantidad * promo.price;
      promo.promo_items.forEach((pi: { product_id: string; cantidad: number }, idx: number) => {
        expandedPromoItems.push({
          product_id:      pi.product_id,
          cantidad:        input.cantidad * pi.cantidad,
          precio_unitario: null,
          subtotal:        idx === 0 ? subtotalTotal : null,
          promo_id:        input.promo_id,
        });
      });
    }
  }

  const items = [
    ...productInputs.map((item) => ({
      product_id:      item.product_id,
      cantidad:        item.cantidad,
      precio_unitario: item.precio_unitario ?? null,
      subtotal:        item.precio_unitario != null ? item.cantidad * item.precio_unitario : null,
      promo_id:        null as string | null,
    })),
    ...expandedPromoItems,
  ];

  const rpcRes = await (supabase as any).rpc("crear_movimiento_con_items", {
    p_sucursal_id:        data.sucursal_id,
    p_fecha:              data.fecha,
    p_tipo:               data.tipo,
    p_notas:              data.notas              ?? null,
    p_proveedor:          data.proveedor          ?? null,
    p_nro_remito:         data.nro_remito         ?? null,
    p_canal:              data.canal              ?? "consumidor_final",
    p_personal_id:        data.personal_id        ?? null,
    p_pago_efectivo:      data.pago_efectivo      ?? null,
    p_pago_billetera:     data.pago_billetera     ?? null,
    p_pago_tarjeta:       data.pago_tarjeta       ?? null,
    p_pago_transferencia: data.pago_transferencia ?? null,
    p_created_by:         userId,
    p_items:              items,
  });

  if (rpcRes.error) throw new Error(rpcRes.error.message ?? "Error al crear movimiento");

  // Asociar imagen si se proporcionó — intentamos con el ID devuelto por la función
  if (data.remito_image_url) {
    const newId = typeof rpcRes.data === "string" ? rpcRes.data : null;
    if (newId) {
      await (supabase as any).from("movimientos").update({ remito_image_url: data.remito_image_url }).eq("id", newId);
    } else {
      // Fallback: actualizar el movimiento más reciente con los mismos parámetros
      const { data: recent } = await (supabase as any)
        .from("movimientos").select("id")
        .eq("sucursal_id", data.sucursal_id).eq("tipo", data.tipo).eq("fecha", data.fecha)
        .order("created_at", { ascending: false }).limit(1).single();
      if (recent?.id) {
        await (supabase as any).from("movimientos").update({ remito_image_url: data.remito_image_url }).eq("id", recent.id);
      }
    }
  }

  revalidatePath("/admin/movimientos");
  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  revalidatePath("/admin/sucursales");
  revalidatePath("/admin/stock");
}

export async function actualizarMovimientoMetadata(
  id: string,
  data: {
    fecha?:            string;
    notas?:            string | null;
    proveedor?:        string | null;
    nro_remito?:       string | null;
    remito_image_url?: string | null;
  }
) {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data: mov } = await supabase.from("movimientos").select("sucursal_id").eq("id", id).single();
  const { error }     = await (supabase as any).from("movimientos").update(data).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/movimientos");
  if (mov?.sucursal_id) {
    revalidatePath(`/admin/sucursales/${mov.sucursal_id}`);
    revalidatePath("/admin/sucursales");
  }
}

export async function eliminarMovimiento(id: string) {
  await requireAdmin();
  const supabase = createAdminClient();

  const { data: mov } = await supabase
    .from("movimientos")
    .select("sucursal_id")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("movimientos").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/movimientos");
  if (mov?.sucursal_id) {
    revalidatePath(`/admin/sucursales/${mov.sucursal_id}`);
    revalidatePath("/admin/stock");
  }
}
