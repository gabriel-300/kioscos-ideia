"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaff } from "@/lib/auth/require-role";
import { requireSucursalAccess } from "@/lib/auth/sucursal-access";
import { obtenerTenedorActual } from "@/lib/auth/turno-actual";
import { leerComprobanteConGroq, validarComprobante } from "@/lib/groq";

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

// cantidad * precio con floats de JS puede dejar arrastres tipo
// 1199.9999999999998 grabados de forma permanente en el subtotal -- sobre todo
// con productos por kg (cantidad fraccionaria). Se redondea acá, antes de
// insertar, en vez de solo en los totales que se arman sumando esto después.
function redondearMoneda(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function crearMovimiento(data: {
  sucursal_id:       string;
  fecha:             string;
  tipo:              "entrega" | "devolucion" | "ajuste" | "venta" | "merma";
  notas:             string | null;
  items:             VentaItemInput[];
  proveedor?:        string | null;
  proveedor_id?:     string | null;
  nro_remito?:       string | null;
  remito_image_url?: string | null;
  canal?:            string | null;
  personal_id?:      string | null;
  descuento_total?:  number | null;
  pago_efectivo?:      number | null;
  pago_billetera?:     number | null;
  pago_tarjeta?:       number | null;
  pago_transferencia?: number | null;
}): Promise<{ movimiento_id: string | null; error?: string }> {
  const { userId, role } = await requireStaff();
  const supabase         = createAdminClient();

  // Solo el admin puede hacer ajustes de stock (encargado y vendedor, no)
  if (role !== "admin" && data.tipo === "ajuste") {
    return { movimiento_id: null, error: "No tenés permisos para realizar ajustes de stock" };
  }

  // Encargados y vendedores solo pueden registrar en su propia sucursal
  const accesoError = await requireSucursalAccess(supabase, userId, role, data.sucursal_id);
  if (accesoError) return { movimiento_id: null, error: accesoError };

  // Un vendedor que no es el tenedor actual de la caja no puede vender --
  // si vendiera igual, esa venta quedaría atada a él (created_by) pero el
  // sistema seguiría reconociendo a otra persona como dueña del turno, y
  // después no podría cerrarlo él mismo (caso real: alguien vendiendo en el
  // turno de otra persona sin haber hecho "Traspaso de turno" primero). Se
  // bloquea acá server-side, no solo con un aviso -- pedido explícito del
  // usuario. Encargado/admin no se restringen (ya pueden cerrar cualquier
  // turno de su sucursal, tenedor o no).
  if (role === "vendedor" && data.tipo === "venta") {
    const { data: ultimaApertura } = await (supabase as any)
      .from("aperturas_caja")
      .select("id, created_at, created_by")
      .eq("sucursal_id", data.sucursal_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultimaApertura) {
      const { data: ultimoCierre } = await (supabase as any)
        .from("cierres_caja")
        .select("created_at")
        .eq("sucursal_id", data.sucursal_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const cajaAbierta = !ultimoCierre || ultimoCierre.created_at < ultimaApertura.created_at;
      if (cajaAbierta) {
        const tenedorActualId = await obtenerTenedorActual(supabase, ultimaApertura.id, ultimaApertura.created_by);
        if (tenedorActualId && tenedorActualId !== userId) {
          return { movimiento_id: null, error: 'No tenés la caja de este turno -- tocá "Traspaso de turno" antes de vender.' };
        }
      }
    }
  }

  // Cantidad negativa/cero solo tiene sentido para "ajuste" (resta manual de stock).
  // En venta/entrega/devolución invertiría el efecto sobre el stock -- una "venta"
  // con cantidad negativa SUMARÍA stock en vez de restarlo (y el futuro chequeo de
  // stock insuficiente nunca lo va a detectar, porque nunca deja el stock negativo).
  if (data.tipo !== "ajuste" && data.items.some((i) => i.cantidad <= 0)) {
    return { movimiento_id: null, error: "La cantidad debe ser mayor a 0" };
  }

  // Merma sin motivo no sirve para nada al mirar el reporte después -- el
  // cliente ya lo exige, pero se refuerza acá por si alguien lo evita con devtools.
  if (data.tipo === "merma" && !data.notas?.trim()) {
    return { movimiento_id: null, error: "Contá el motivo de la pérdida" };
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
  const esVenta   = data.tipo === "venta";
  const esEntrega = data.tipo === "entrega";
  // Precio y costo son por sucursal (ver migración 059) -- se resuelven
  // siempre contra product_prices filtrado por data.sucursal_id, nunca
  // contra products directamente (esta es la fuente de verdad server-side,
  // "nunca se confía del cliente").
  let precioProductoMap = new Map<string, number | null>();
  if (esVenta && productInputs.length > 0) {
    const productIds = [...new Set(productInputs.map((i) => i.product_id))];
    const { data: precios, error: preciosError } = await supabase
      .from("product_prices").select("product_id, precio_dist")
      .eq("sucursal_id", data.sucursal_id).in("product_id", productIds);
    if (preciosError) return { movimiento_id: null, error: preciosError.message };
    precioProductoMap = new Map((precios ?? []).map((p) => [p.product_id, p.precio_dist]));
  }

  // Costo actual, para comparar contra el precio de la entrega y avisar si el
  // proveedor cambió el precio (ver alertas_precio más abajo, después del RPC).
  let costoProductoMap = new Map<string, number | null>();
  if (esEntrega && productInputs.length > 0) {
    const productIds = [...new Set(productInputs.map((i) => i.product_id))];
    const { data: precios, error: preciosError } = await supabase
      .from("product_prices").select("product_id, costo")
      .eq("sucursal_id", data.sucursal_id).in("product_id", productIds);
    if (preciosError) return { movimiento_id: null, error: preciosError.message };
    costoProductoMap = new Map((precios ?? []).map((p) => [p.product_id, p.costo]));
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
    if (promosError) return { movimiento_id: null, error: promosError.message };

    type PromoItemRow = { product_id: string; cantidad: number };
    type PromoRow = { id: string; price: number; is_active: boolean; promo_items: PromoItemRow[] };
    const promoMap = new Map<string, PromoRow>((promos ?? []).map((p: PromoRow) => [p.id, p]));

    // El precio de la promo es por sucursal desde la migración 070 (mismo caso
    // que product_prices para productos sueltos) -- promos.price quedó
    // vestigial. Sin esta consulta, una promo con precio distinto en esta
    // sucursal se factura al precio global viejo, lo que después no coincide
    // con lo que el vendedor cobró de verdad (rechaza la venta como "sobrepago").
    const { data: preciosPromo, error: preciosPromoError } = await (supabase as any)
      .from("promo_prices").select("promo_id, price")
      .eq("sucursal_id", data.sucursal_id).in("promo_id", promoIds);
    if (preciosPromoError) return { movimiento_id: null, error: preciosPromoError.message };
    const precioPromoMap = new Map<string, number>((preciosPromo ?? []).map((p: { promo_id: string; price: number }) => [p.promo_id, p.price]));

    // El costo de cada componente para repartir el facturado de la promo
    // (más abajo) es el costo de ESTA sucursal -- consulta aparte en vez de
    // anidarla dentro del embed de promo_items, más simple y confiable que
    // filtrar una tabla relacionada de otra tabla relacionada por PostgREST.
    const componentProductIds: string[] = [...new Set(
      (promos ?? []).flatMap((p: PromoRow) => p.promo_items.map((pi) => pi.product_id))
    )] as string[];
    let costoComponenteMap = new Map<string, number>();
    if (componentProductIds.length > 0) {
      const { data: preciosComponentes, error: preciosCompError } = await supabase
        .from("product_prices").select("product_id, costo")
        .eq("sucursal_id", data.sucursal_id).in("product_id", componentProductIds);
      if (preciosCompError) return { movimiento_id: null, error: preciosCompError.message };
      costoComponenteMap = new Map((preciosComponentes ?? []).map((p) => [p.product_id, p.costo]));
    }

    for (const input of promoInputs) {
      const promo = promoMap.get(input.promo_id);
      if (!promo) return { movimiento_id: null, error: "Promoción no encontrada" };
      if (!promo.is_active) return { movimiento_id: null, error: `La promoción "${promo.id}" ya no está activa` };
      if (!promo.promo_items || promo.promo_items.length === 0) {
        return { movimiento_id: null, error: "La promoción no tiene productos configurados" };
      }
      const precioCatalogoPromo = precioPromoMap.get(promo.id) ?? promo.price;
      const precioPromo   = precioAutorizado(precioCatalogoPromo, input.precio_unitario) ?? precioCatalogoPromo;
      const subtotalTotal = redondearMoneda(input.cantidad * precioPromo);

      // El facturado del combo se reparte entre sus componentes proporcional
      // al costo de cada uno (antes se cargaba entero al primer producto y el
      // resto quedaba en null) -- así el margen por producto en /admin/ventas
      // no muestra negativos engañosos en los componentes que "no cobraron"
      // nada pero sí tienen costo. Sin costo cargado en ningún componente, se
      // reparte en partes iguales.
      const cantidades = promo.promo_items.map((pi) => input.cantidad * pi.cantidad);
      const pesos = promo.promo_items.map((pi, i) => cantidades[i] * (costoComponenteMap.get(pi.product_id) ?? 0));
      const pesoTotal = pesos.reduce((s, w) => s + w, 0);
      const pesosFinal = pesoTotal > 0 ? pesos : cantidades.map(() => 1);
      const pesoFinalTotal = pesosFinal.reduce((s, w) => s + w, 0);

      let acumulado = 0;
      promo.promo_items.forEach((pi, idx) => {
        const esUltimo = idx === promo.promo_items.length - 1;
        const subtotalItem = esUltimo
          ? redondearMoneda(subtotalTotal - acumulado)
          : redondearMoneda(subtotalTotal * (pesosFinal[idx] / pesoFinalTotal));
        acumulado += subtotalItem;
        expandedPromoItems.push({
          product_id:      pi.product_id,
          cantidad:        cantidades[idx],
          precio_unitario: null,
          subtotal:        subtotalItem,
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
        subtotal:        precio != null ? redondearMoneda(item.cantidad * precio) : null,
        promo_id:        null as string | null,
      };
    }),
    ...expandedPromoItems,
  ];

  // Descuento de Pedido Ya ("descuento en menú completo" que a veces absorbe
  // el vendor): se carga como un monto único sobre el pedido, igual que se ve
  // en la app, y acá se reparte proporcional al subtotal de cada línea -- mismo
  // criterio que el reparto de combos más arriba, para que el margen por
  // producto en /admin/ventas no quede inflado (el total vendido tiene que
  // coincidir con lo que realmente se cobra/concilia).
  if (esVenta && (esPedidoYaEfectivo || esPedidoYaPlataforma) && data.descuento_total) {
    const itemsConSubtotal = items.filter((i) => (i.subtotal ?? 0) > 0);
    const subtotalTotal    = itemsConSubtotal.reduce((s, i) => s + (i.subtotal ?? 0), 0);
    const descuento        = Math.min(data.descuento_total, subtotalTotal);
    if (subtotalTotal > 0 && descuento > 0) {
      let acumulado = 0;
      itemsConSubtotal.forEach((item, idx) => {
        const esUltimo = idx === itemsConSubtotal.length - 1;
        const recorte  = esUltimo
          ? redondearMoneda(descuento - acumulado)
          : redondearMoneda(descuento * ((item.subtotal ?? 0) / subtotalTotal));
        acumulado += recorte;
        item.subtotal = redondearMoneda((item.subtotal ?? 0) - recorte);
        if (item.precio_unitario != null && item.cantidad) {
          item.precio_unitario = redondearMoneda(item.subtotal / item.cantidad);
        }
      });
    }
  }

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
      return { movimiento_id: null, error: "La suma de billetera + tarjeta + transferencia no puede superar el total de la venta" };
    }
  }

  // Límite de crédito de Cta. Corriente: el chequeo vive DENTRO del RPC
  // (crear_movimiento_con_items, con pg_advisory_xact_lock por personal_id)
  // para que dos ventas fiado simultáneas del mismo cliente no puedan leer el
  // mismo saldo "todavía dentro del límite" cada una por separado y terminar
  // superando el límite entre las dos -- acá haciendo el chequeo en un
  // round-trip aparte antes del RPC no hay forma de cerrar esa ventana.

  const rpcRes = await (supabase as any).rpc("crear_movimiento_con_items", {
    p_sucursal_id:        data.sucursal_id,
    p_fecha:              data.fecha,
    p_tipo:               data.tipo,
    p_notas:              data.notas              ?? null,
    p_proveedor:          data.proveedor          ?? null,
    p_proveedor_id:       data.proveedor_id       ?? null,
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

  if (rpcRes.error) return { movimiento_id: null, error: rpcRes.error.message ?? "Error al crear movimiento" };

  // Nota: la merma de cocción automática (productos con products.merma_coccion_pct,
  // ej. congelado → cocido) se genera DENTRO de crear_movimiento_con_items, no acá
  // -- así queda en la misma transacción que la venta, sin round-trip extra.

  const movimientoId: string | null = typeof rpcRes.data === "string" ? rpcRes.data : null;

  // Asociar imagen si se proporcionó — intentamos con el ID devuelto por la función
  if (data.remito_image_url) {
    if (movimientoId) {
      await (supabase as any).from("movimientos").update({ remito_image_url: data.remito_image_url }).eq("id", movimientoId);
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

  // Alerta de cambio de precio: si el costo cargado en la entrega difiere del
  // costo actual del producto, queda para que el admin lo revise en
  // /admin/alertas-precio -- ver aviso inline equivalente en movimiento-form.tsx.
  // Sin threshold: cualquier diferencia genera alerta.
  if (esEntrega && movimientoId) {
    const alertas = productInputs
      .map((item) => {
        const costoAnterior = costoProductoMap.get(item.product_id) ?? null;
        if (costoAnterior == null || item.precio_unitario == null) return null;
        if (item.precio_unitario === costoAnterior) return null;
        return {
          movimiento_id:  movimientoId,
          product_id:     item.product_id,
          proveedor:      data.proveedor ?? null,
          costo_anterior: costoAnterior,
          costo_nuevo:    item.precio_unitario,
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);
    if (alertas.length > 0) {
      await (supabase as any).from("alertas_precio").insert(alertas);
    }
  }

  revalidatePath("/admin/movimientos");
  revalidatePath(`/admin/sucursales/${data.sucursal_id}`);
  revalidatePath("/admin/sucursales");
  revalidatePath("/admin/stock");
  revalidatePath("/admin/alertas-precio");

  return { movimiento_id: movimientoId };
}

// Sin acentos, en minúsculas, espacios colapsados -- para comparar "PAN MIÑÓN"
// contra "Pan Miñon x50" sin que un tilde o un espacio de más rompa el match.
function normalizarNombre(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type LineaRemitoLeida = {
  producto:       string;
  cantidad:       number;
  precio:         number;
  productIdMatch: string | null;
};

// Lee una foto de remito con IA (Groq, con fallback entre 2 modelos de
// visión) y devuelve las líneas con el producto del catálogo matcheado
// cuando hay uno solo claro -- nunca adivina entre varios candidatos, esas
// líneas quedan sin matchear para elegir a mano. Groq marca sus modelos de
// visión como "preview" (ver lib/groq.ts) -- las advertencias de
// consistencia de validarComprobante() viajan igual, para que quien cargó
// la foto sepa que conviene revisar antes de guardar, no confiar a ciegas.
export async function leerRemito(imageBase64: string, mimeType: string): Promise<{ error?: string; lineas?: LineaRemitoLeida[]; advertencias?: string[] }> {
  await requireStaff();

  let comprobante: Awaited<ReturnType<typeof leerComprobanteConGroq>>;
  try {
    comprobante = await leerComprobanteConGroq(imageBase64, mimeType);
  } catch (e) {
    return { error: (e as Error).message };
  }
  if (comprobante.items.length === 0) return { error: "No se pudo leer ninguna línea en la foto" };

  const supabase = createAdminClient();
  const { data: products, error: prodsError } = await supabase
    .from("products").select("id, name").eq("is_active", true);
  if (prodsError) return { error: prodsError.message };

  const catalogo = (products ?? []).map((p) => ({ id: p.id, nombreNorm: normalizarNombre(p.name) }));

  const resultado: LineaRemitoLeida[] = comprobante.items.map((l) => {
    const nombreNorm = normalizarNombre(l.descripcion);
    const exactos = catalogo.filter((p) => p.nombreNorm === nombreNorm);
    let match = exactos.length === 1 ? exactos[0] : null;
    if (!match) {
      const parciales = catalogo.filter((p) => p.nombreNorm.includes(nombreNorm) || nombreNorm.includes(p.nombreNorm));
      match = parciales.length === 1 ? parciales[0] : null;
    }
    return { producto: l.descripcion, cantidad: l.cantidad, precio: l.precio_unitario, productIdMatch: match?.id ?? null };
  });

  return { lineas: resultado, advertencias: validarComprobante(comprobante) };
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
        subtotal: i.precio_unitario != null ? redondearMoneda(i.cantidad * i.precio_unitario) : null,
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

// Anular una venta cargada por error (ej. duplicada) -- no la borra, la marca
// (quién, cuándo, motivo obligatorio) y a partir de ahí queda excluida de
// stock/caja/informes (ver migración 063), pero sigue visible en el
// Historial para trazabilidad. Solo mientras la caja de ESE turno siga
// abierta -- una vez cerrada, la venta queda fija para siempre, igual que
// todo lo demás del turno.
export async function anularVenta(id: string, motivo: string): Promise<{ error?: string }> {
  const { userId, role } = await requireStaff();
  const supabase = createAdminClient();

  const motivoTrim = motivo?.trim();
  if (!motivoTrim) return { error: "Contá por qué anulás esta venta" };

  const { data: mov, error: movError } = await supabase
    .from("movimientos")
    .select("sucursal_id, tipo, created_at, anulado_en")
    .eq("id", id)
    .single();
  if (movError || !mov) return { error: "No se encontró la venta" };
  if (mov.tipo !== "venta") return { error: "Solo se pueden anular ventas" };
  if (mov.anulado_en) return { error: "Esta venta ya está anulada" };

  // Mismo chequeo de permisos por sucursal que crearMovimiento/cerrarCaja.
  const accesoErrorAnular = await requireSucursalAccess(supabase, userId, role, mov.sucursal_id);
  if (accesoErrorAnular) return { error: accesoErrorAnular };

  // La caja de ese turno tiene que seguir abierta -- como abrir_caja no deja
  // abrir un turno nuevo sin cerrar el anterior, alcanza con mirar la
  // apertura más reciente de la sucursal (mismo criterio que `cajaAbierta`
  // en sucursales/[id]/page.tsx) y confirmar que esta venta cae dentro de ella.
  const aperturaRes = await (supabase as any)
    .from("aperturas_caja")
    .select("created_at")
    .eq("sucursal_id", mov.sucursal_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const apertura = aperturaRes.data as { created_at: string } | null;

  const cierreRes = await (supabase as any)
    .from("cierres_caja")
    .select("created_at")
    .eq("sucursal_id", mov.sucursal_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ultimoCierre = cierreRes.data as { created_at: string } | null;

  const cajaAbierta = !!apertura && (!ultimoCierre || apertura.created_at > ultimoCierre.created_at);
  if (!apertura || !cajaAbierta || mov.created_at < apertura.created_at) {
    return { error: "La caja de ese turno ya está cerrada -- no se puede anular" };
  }

  const { error } = await supabase
    .from("movimientos")
    .update({ anulado_en: new Date().toISOString(), anulado_por: userId, motivo_anulacion: motivoTrim })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/admin/sucursales/${mov.sucursal_id}`);
  revalidatePath("/admin/movimientos");
  revalidatePath("/admin/stock");
  revalidatePath("/admin/ventas");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/cierres");
  return {};
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
