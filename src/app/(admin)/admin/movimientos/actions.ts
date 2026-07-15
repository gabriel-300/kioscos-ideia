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
  precio_unitario?: number | null; // override manual del precio de la promo (ej. canal "Pedido Ya")
}

type VentaItemInput = ItemInput | PromoItemInput;

function esPromoItem(item: VentaItemInput): item is PromoItemInput {
  return "promo_id" in item;
}

export async function crearMovimiento(data: {
  sucursal_id:       string;
  fecha:             string;
  tipo:              "entrega" | "devolucion" | "ajuste" | "venta" | "merma";
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

  // Solo el admin puede hacer ajustes de stock (encargado y vendedor, no)
  if (role !== "admin" && data.tipo === "ajuste") {
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

  // Cantidad negativa/cero solo tiene sentido para "ajuste" (resta manual de stock).
  // En venta/entrega/devolución invertiría el efecto sobre el stock -- una "venta"
  // con cantidad negativa SUMARÍA stock en vez de restarlo (y el futuro chequeo de
  // stock insuficiente nunca lo va a detectar, porque nunca deja el stock negativo).
  if (data.tipo !== "ajuste" && data.items.some((i) => i.cantidad <= 0)) {
    throw new Error("La cantidad debe ser mayor a 0");
  }

  // Merma sin motivo no sirve para nada al mirar el reporte después -- el
  // cliente ya lo exige, pero se refuerza acá por si alguien lo evita con devtools.
  if (data.tipo === "merma" && !data.notas?.trim()) {
    throw new Error("Contá el motivo de la pérdida");
  }

  // Cta. Corriente no se cobra en el momento -- ningún medio de pago debería
  // quedar asociado al movimiento, sin importar lo que mande el cliente (si no,
  // ese monto contamina la conciliación del cierre de caja). Pedido Ya Plataforma
  // es el mismo caso: la plata la paga la app después, no hay contraparte todavía
  // en ningún medio. Pedido Ya Efectivo es al revés -- se cobra en efectivo en el
  // momento, se fuerza más abajo una vez que se conoce el total de la venta.
  const esCtaCorriente       = data.canal === "cuenta_corriente";
  const esPedidoYaPlataforma = data.canal === "pedido_ya_plataforma";
  const esPedidoYaEfectivo   = data.canal === "pedido_ya_efectivo";
  const sinConciliacion      = esCtaCorriente || esPedidoYaPlataforma;
  let pagoEfectivo      = sinConciliacion ? null : data.pago_efectivo      ?? null;
  let pagoBilletera     = sinConciliacion ? null : data.pago_billetera     ?? null;
  let pagoTarjeta       = sinConciliacion ? null : data.pago_tarjeta       ?? null;
  let pagoTransferencia = sinConciliacion ? null : data.pago_transferencia ?? null;

  const promoInputs   = data.items.filter(esPromoItem);
  const productInputs = data.items.filter((i): i is ItemInput => !esPromoItem(i));

  // El precio de cada línea NUNCA se confía del cliente -- se resuelve server-side
  // contra el precio real de catálogo. "Pedido Ya" permite un override manual (la
  // comisión de la app hace que el precio cobrado sea otro), pero SIEMPRE por
  // encima del precio de catálogo -- así es como funciona en la realidad, nunca
  // se cobra menos por esa vía. Un valor por debajo del catálogo se descarta acá
  // (no se clamea a un piso intermedio): si el cliente ya lo bloqueó en el
  // formulario esto nunca debería dispararse, pero es la defensa server-side por
  // si alguien le pega directo a esta action con devtools.
  const esVenta = data.tipo === "venta";
  let precioProductoMap = new Map<string, number | null>();
  if (esVenta && productInputs.length > 0) {
    const productIds = [...new Set(productInputs.map((i) => i.product_id))];
    const { data: prods, error: prodsError } = await (supabase as any)
      .from("products").select("id, precio_dist").in("id", productIds);
    if (prodsError) throw new Error(prodsError.message);
    precioProductoMap = new Map(
      (prods ?? []).map((p: { id: string; precio_dist: number | null }) => [p.id, p.precio_dist])
    );
  }
  function precioAutorizado(precioCatalogo: number | null, precioCliente: number | null | undefined): number | null {
    if (!esVenta || precioCatalogo == null) return precioCliente ?? null;
    if ((esPedidoYaEfectivo || esPedidoYaPlataforma) && precioCliente != null && precioCliente >= precioCatalogo) {
      return precioCliente;
    }
    return precioCatalogo;
  }

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
      const precioPromo   = precioAutorizado(promo.price, input.precio_unitario) ?? promo.price;
      const subtotalTotal = input.cantidad * precioPromo;
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
    ...productInputs.map((item) => {
      const precio = precioAutorizado(precioProductoMap.get(item.product_id) ?? null, item.precio_unitario);
      return {
        product_id:      item.product_id,
        cantidad:        item.cantidad,
        precio_unitario: precio,
        subtotal:        precio != null ? item.cantidad * precio : null,
        promo_id:        null as string | null,
      };
    }),
    ...expandedPromoItems,
  ];

  // Pedido Ya Efectivo: el cliente paga en efectivo al recibir el pedido -- se
  // fuerza server-side a que el 100% del total quede como pago_efectivo (sin
  // importar qué mande el cliente en el resto de los medios), así entra a la
  // conciliación de caja como una venta en efectivo más, igual que Consumidor Final.
  if (esVenta && esPedidoYaEfectivo) {
    const totalVentaEfectivo = items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
    pagoEfectivo      = totalVentaEfectivo || null;
    pagoBilletera     = null;
    pagoTarjeta       = null;
    pagoTransferencia = null;
  }

  // Sobrepago: la suma de billetera+tarjeta+transferencia no puede superar el
  // total vendido (a diferencia del efectivo, que puede superarlo -- es vuelto).
  // El cliente ya bloquea el botón de confirmar con esta misma cuenta, pero eso
  // no evita que alguien le pegue directo a esta action con devtools mandando,
  // por ejemplo, $12.000 en tarjeta para una venta de $1.200.
  if (esVenta && !esCtaCorriente) {
    const totalVenta  = items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
    const otrosMedios = (pagoBilletera ?? 0) + (pagoTarjeta ?? 0) + (pagoTransferencia ?? 0);
    if (Math.round(otrosMedios * 100) > Math.round(totalVenta * 100)) {
      throw new Error("La suma de billetera + tarjeta + transferencia no puede superar el total de la venta");
    }
  }

  // Límite de crédito de Cta. Corriente: hasta ahora solo se mostraba en el
  // informe (visual, "Límite excedido"), nunca bloqueaba una venta nueva -- un
  // vendedor podía seguir fiando de largo aunque el cliente ya estuviera pasado.
  // Mismo criterio de saldo que usa /cta-corriente/page.tsx: histórico de ventas
  // fiado en ESTA sucursal menos pagos registrados, ambos por personal_id.
  if (esVenta && esCtaCorriente && data.personal_id) {
    const { data: perfil } = await (supabase as any)
      .from("profiles").select("credito_limite").eq("id", data.personal_id).single();
    const limite = perfil?.credito_limite as number | null | undefined;

    if (limite != null) {
      const totalVenta = items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
      const [{ data: ventasFiado }, { data: pagos }] = await Promise.all([
        (supabase as any)
          .from("movimientos")
          .select("movimiento_items(subtotal)")
          .eq("sucursal_id", data.sucursal_id)
          .eq("personal_id", data.personal_id)
          .eq("canal", "cuenta_corriente")
          .eq("tipo", "venta"),
        (supabase as any)
          .from("cta_corriente_pagos")
          .select("monto")
          .eq("sucursal_id", data.sucursal_id)
          .eq("personal_id", data.personal_id),
      ]);
      const deuda = (ventasFiado ?? []).reduce(
        (s: number, v: { movimiento_items: { subtotal: number | null }[] }) =>
          s + v.movimiento_items.reduce((ss, i) => ss + (i.subtotal ?? 0), 0), 0
      );
      const pagado = (pagos ?? []).reduce((s: number, p: { monto: number }) => s + p.monto, 0);
      const saldoActual = deuda - pagado;

      if (saldoActual + totalVenta > limite) {
        throw new Error(
          `Esta venta supera el límite de crédito de Cta. Corriente (saldo actual ${saldoActual.toFixed(0)} + venta ${totalVenta.toFixed(0)} > límite ${limite.toFixed(0)}).`
        );
      }
    }
  }

  const rpcRes = await (supabase as any).rpc("crear_movimiento_con_items", {
    p_sucursal_id:        data.sucursal_id,
    p_fecha:              data.fecha,
    p_tipo:               data.tipo,
    p_notas:              data.notas              ?? null,
    p_proveedor:          data.proveedor          ?? null,
    p_nro_remito:         data.nro_remito         ?? null,
    p_canal:              data.canal              ?? "consumidor_final",
    p_personal_id:        data.personal_id        ?? null,
    p_pago_efectivo:      pagoEfectivo,
    p_pago_billetera:     pagoBilletera,
    p_pago_tarjeta:       pagoTarjeta,
    p_pago_transferencia: pagoTransferencia,
    p_created_by:         userId,
    p_items:              items,
  });

  if (rpcRes.error) throw new Error(rpcRes.error.message ?? "Error al crear movimiento");

  // Nota: la merma de cocción automática (productos con products.merma_coccion_pct,
  // ej. congelado → cocido) se genera DENTRO de crear_movimiento_con_items, no acá
  // -- así queda en la misma transacción que la venta, sin round-trip extra.

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

// Completa/corrige el costo de items de una entrega ya cargada -- cubre el caso
// de quien recibe la mercadería (encargado/vendedor) sin tener la factura a mano
// todavía; el admin lo completa después desde el historial.
export async function actualizarCostosItems(
  movimientoId: string,
  items: { id: string; cantidad: number; precio_unitario: number | null }[]
) {
  await requireAdmin();
  const supabase = createAdminClient();

  const { data: mov } = await supabase.from("movimientos").select("sucursal_id").eq("id", movimientoId).single();

  const errors = (
    await Promise.all(
      items.map((i) => (supabase as any).from("movimiento_items").update({
        precio_unitario: i.precio_unitario,
        subtotal: i.precio_unitario != null ? i.cantidad * i.precio_unitario : null,
      }).eq("id", i.id).eq("movimiento_id", movimientoId))
    )
  ).filter((r) => r.error);
  if (errors.length > 0) throw new Error(errors[0].error!.message);

  revalidatePath("/admin/movimientos");
  if (mov?.sucursal_id) {
    revalidatePath(`/admin/sucursales/${mov.sucursal_id}`);
    revalidatePath("/admin/stock");
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
