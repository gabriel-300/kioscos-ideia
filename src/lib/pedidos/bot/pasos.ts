import { crearPedidoPublico } from "../crear-pedido-publico";
import { aItemsPedido } from "./carrito";
import type { DatosCheckout } from "./estado";
import { siguientePaso, textoConfirmacion, type ConfigCheckout } from "./checkout";
import { guardarEstado, type Admin, type Ctx } from "./contexto";
import {
  enviarCarrito, mensaje, preguntarDireccion, preguntarEntrega, preguntarNombre, preguntarPago, preguntarZona,
} from "./mensajes";

// Pasos del checkout con efectos (leer la base, mandar mensajes, crear el
// pedido). Qué paso toca lo decide siguientePaso() (checkout.ts, puro).

const MAX_ZONAS = 10; // una lista de WhatsApp no admite más filas

async function cargarConfigCheckout(admin: Admin, sucursalId: string): Promise<ConfigCheckout> {
  const [{ data: sucursal }, { data: zonas }] = await Promise.all([
    (admin as any)
      .from("sucursales")
      .select("is_active, pedidos_online_habilitado, delivery_habilitado, retiro_habilitado")
      .eq("id", sucursalId)
      .single(),
    (admin as any)
      .from("zonas_entrega")
      .select("id, nombre, costo, eta_min, eta_max")
      .eq("sucursal_id", sucursalId)
      .eq("is_active", true)
      .order("orden")
      .order("costo")
      .limit(MAX_ZONAS),
  ]);
  return {
    habilitado: !!sucursal?.is_active && !!sucursal.pedidos_online_habilitado,
    retiro:     sucursal?.retiro_habilitado ?? true,
    delivery:   !!sucursal?.delivery_habilitado,
    zonas: ((zonas ?? []) as any[]).map((z) => ({
      id: z.id, nombre: z.nombre, costo: Number(z.costo), etaMin: z.eta_min, etaMax: z.eta_max,
    })),
  };
}

// Vuelve al menú conservando el carrito, con un mensaje (típicamente un error).
export async function volverAlCarrito(ctx: Ctx, encabezado: string) {
  await guardarEstado(ctx, { paso: "menu", propuesta: undefined, checkout: {} });
  await enviarCarrito(ctx.chat, encabezado, ctx.estado.carrito, ctx.indice);
}

// Punto de entrada del checkout y de cada respuesta del cliente: calcula qué
// falta y lo pregunta; si ya está todo, crea el pedido. Llamarlo de nuevo con
// el estado sin cambios repite la pregunta actual.
export async function avanzarCheckout(ctx: Ctx) {
  const cfg = await cargarConfigCheckout(ctx.admin, ctx.sucursalId);
  const siguiente = siguientePaso(cfg, ctx.pedido.cliente_nombre, ctx.estado.checkout);

  if (siguiente.paso === "no_disponible") {
    await volverAlCarrito(ctx, "Por ahora esta sucursal no está recibiendo pedidos por este medio.");
    return;
  }
  if (siguiente.paso === "listo") {
    await confirmarPedido(ctx, siguiente.checkout);
    return;
  }

  await guardarEstado(ctx, { paso: siguiente.paso, checkout: siguiente.checkout });
  switch (siguiente.paso) {
    case "pidiendo_nombre":     return void await preguntarNombre(ctx.chat);
    case "eligiendo_entrega":   return void await preguntarEntrega(ctx.chat);
    case "eligiendo_zona":      return void await preguntarZona(ctx.chat, cfg.zonas);
    case "pidiendo_direccion":  return void await preguntarDireccion(ctx.chat);
    case "eligiendo_pago":      return void await preguntarPago(ctx.chat, siguiente.checkout.tipo!);
  }
}

// Toda la validación de negocio (horario, mínimo de envío, stock, precios,
// rate limit) ocurre en crearPedidoPublico -- la misma que usa el storefront.
async function confirmarPedido(ctx: Ctx, checkout: DatosCheckout) {
  const nombre = ctx.pedido.cliente_nombre ?? "";
  const resultado = await crearPedidoPublico(
    ctx.admin,
    {
      sucursal_id:          ctx.sucursalId,
      cliente_nombre:       nombre,
      cliente_telefono:     ctx.chat.waId,
      notas:                null,
      tipo_entrega:         checkout.tipo!,
      zona_entrega_id:      checkout.tipo === "delivery" ? (checkout.zonaId ?? null) : null,
      direccion_entrega:    checkout.tipo === "delivery" ? (checkout.direccion ?? null) : null,
      direccion_referencia: null,
      medio_pago:           checkout.pago!,
      pago_con:             null,
      items:                aItemsPedido(ctx.estado.carrito),
    },
    `wa:${ctx.chat.waId}`,
    { origen: "whatsapp", cliente_wa_id: ctx.chat.waId, pedido_existente_id: ctx.pedido.id }
  );

  if (resultado.error) {
    await volverAlCarrito(ctx, resultado.error);
    return;
  }
  await mensaje(ctx.chat, textoConfirmacion(resultado, nombre, checkout.tipo!, checkout.pago!));
}
