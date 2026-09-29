import { cargarCatalogoSucursal } from "../catalogo";
import { interpretarPedidoConIA } from "../interpretar-pedido-ia";
import { agregarAlCarrito, buscarItem, fusionarCarritos, indexarCatalogo } from "./carrito";
import { limpiarDireccion } from "./checkout";
import { guardarEstado, type Admin, type Ctx, type Conversacion } from "./contexto";
import { esPasoCheckout, leerEstado, serializarEstado, estadoInicial, type ItemCarrito } from "./estado";
import {
  ID, enviarCarrito, enviarCategorias, enviarProductos, enviarPropuestaIA, mensaje,
} from "./mensajes";
import { avanzarCheckout } from "./pasos";

// Motor del bot de pedidos por WhatsApp. Se invoca una vez por mensaje
// entrante, ya deduplicado por src/app/api/webhooks/whatsapp/route.ts (índice
// único en wa_message_id). Carrito y avance del cliente: estado.ts; qué se
// pregunta en el checkout: checkout.ts; efectos del checkout: pasos.ts.

export type MensajeEntrante = {
  sucursalId:    string;
  phoneNumberId: string;
  waId:          string;
  nombrePerfil:  string | null;
  texto:         string | null;
  interactive?:  { button_reply?: { id?: string; title?: string } | null; list_reply?: { id?: string; title?: string } | null } | null;
};

// La conversación es la fila 'carrito' más reciente de ese cliente en esa
// sucursal; si no hay, se abre una nueva.
async function obtenerConversacion(admin: Admin, m: MensajeEntrante): Promise<(Conversacion & { bot_paso: string | null }) | null> {
  const { data: existente } = await (admin as any)
    .from("pedidos")
    .select("id, bot_paso, cliente_nombre")
    .eq("cliente_wa_id", m.waId)
    .eq("sucursal_id", m.sucursalId)
    .eq("estado", "carrito")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existente) return existente;

  const { data: nuevo, error } = await (admin as any)
    .from("pedidos")
    .insert({
      sucursal_id:      m.sucursalId,
      origen:           "whatsapp",
      estado:           "carrito",
      tipo_entrega:     "retiro_local",
      cliente_wa_id:    m.waId,
      cliente_telefono: m.waId,
      cliente_nombre:   m.nombrePerfil ?? null,
      bot_paso:         serializarEstado(estadoInicial()),
    })
    .select("id, bot_paso, cliente_nombre")
    .single();
  if (error || !nuevo) {
    console.error("[bot-pedidos] no se pudo crear la conversación:", error?.message);
    return null;
  }
  return nuevo;
}

export async function procesarMensajeBot(admin: Admin, m: MensajeEntrante) {
  const conversacion = await obtenerConversacion(admin, m);
  if (!conversacion) return;

  const catalogo = await cargarCatalogoSucursal(admin, m.sucursalId);
  const ctx: Ctx = {
    admin,
    chat: { phoneNumberId: m.phoneNumberId, waId: m.waId },
    sucursalId: m.sucursalId,
    pedido: { id: conversacion.id, cliente_nombre: conversacion.cliente_nombre },
    estado: leerEstado(conversacion.bot_paso),
    catalogo,
    indice: indexarCatalogo(catalogo.items),
  };

  const replyId = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? null;
  if (replyId) return manejarBoton(ctx, replyId);
  if (m.texto?.trim()) return manejarTexto(ctx, m.texto.trim());
  await enviarCategorias(ctx.chat, ctx.catalogo.grupos);
}

// ── Texto libre ─────────────────────────────────────────────────────────

async function manejarTexto(ctx: Ctx, texto: string) {
  switch (ctx.estado.paso) {
    case "pidiendo_nombre": {
      const nombre = texto.slice(0, 80);
      await (ctx.admin as any).from("pedidos").update({ cliente_nombre: nombre }).eq("id", ctx.pedido.id);
      ctx.pedido.cliente_nombre = nombre;
      return avanzarCheckout(ctx);
    }
    case "pidiendo_direccion":
      await guardarEstado(ctx, { checkout: { ...ctx.estado.checkout, direccion: limpiarDireccion(texto) } });
      return avanzarCheckout(ctx);
    case "eligiendo_entrega":
    case "eligiendo_zona":
    case "eligiendo_pago":
      return avanzarCheckout(ctx); // esperaba un botón: se repite la pregunta
    default:
      return proponerConIA(ctx, texto);
  }
}

// El modelo solo propone; nada entra al carrito hasta que el cliente confirma
// con el botón (ia_confirmar). Cada id que devuelve se valida contra el
// catálogo en interpretar-pedido-ia.ts.
async function proponerConIA(ctx: Ctx, texto: string) {
  const propuesta = await interpretarPedidoConIA(
    texto,
    ctx.catalogo.items.map((i) => ({ id: i.id, name: i.name, price: i.price, esPromo: i.esPromo }))
  );
  if (propuesta.length === 0) return enviarCategorias(ctx.chat, ctx.catalogo.grupos);

  const items: ItemCarrito[] = propuesta.map((p) => ({ id: p.id, esPromo: p.esPromo, cantidad: p.cantidad }));
  await guardarEstado(ctx, { paso: "ia_pendiente", propuesta: items });
  await enviarPropuestaIA(ctx.chat, items, ctx.indice);
}

// ── Botones y filas de lista ────────────────────────────────────────────

async function actualizarCarrito(ctx: Ctx, carrito: ItemCarrito[]) {
  await guardarEstado(ctx, { paso: "menu", propuesta: undefined, carrito });
}

async function manejarBoton(ctx: Ctx, id: string) {
  const { estado, chat } = ctx;

  if (id.startsWith(ID.categoria)) {
    const grupoId = id.slice(ID.categoria.length);
    return enviarProductos(chat, ctx.catalogo.grupos.find((g) => g.id === grupoId), 0);
  }
  if (id.startsWith(ID.masCategorias)) {
    return enviarCategorias(chat, ctx.catalogo.grupos, parseInt(id.slice(ID.masCategorias.length), 10) || 0);
  }
  if (id.startsWith(ID.masProductos)) {
    const resto = id.slice(ID.masProductos.length);
    const corte = resto.lastIndexOf("_");
    const grupoId = corte >= 0 ? resto.slice(0, corte) : resto;
    const offset = corte >= 0 ? (parseInt(resto.slice(corte + 1), 10) || 0) : 0;
    return enviarProductos(chat, ctx.catalogo.grupos.find((g) => g.id === grupoId), offset);
  }
  if (id.startsWith(ID.producto) || id.startsWith(ID.promo)) {
    const esPromo = id.startsWith(ID.promo);
    const itemId = id.slice((esPromo ? ID.promo : ID.producto).length);
    const item = buscarItem(ctx.indice, itemId, esPromo);
    if (!item) return mensaje(chat, "Ese producto ya no está disponible.");
    await actualizarCarrito(ctx, agregarAlCarrito(estado.carrito, itemId, esPromo, 1));
    return enviarCarrito(chat, `Agregado: ${item.name}`, ctx.estado.carrito, ctx.indice);
  }

  switch (id) {
    case ID.seguir:
      return enviarCategorias(chat, ctx.catalogo.grupos);
    case ID.vaciar:
      await actualizarCarrito(ctx, []);
      return mensaje(chat, "Listo, vacié tu carrito.");
    case ID.finalizar:
      if (estado.carrito.length === 0) return mensaje(chat, "Todavía no agregaste nada a tu pedido.");
      return avanzarCheckout(ctx);
    case ID.iaConfirmar:
      if (estado.paso !== "ia_pendiente" || !estado.propuesta) return;
      await actualizarCarrito(ctx, fusionarCarritos(estado.carrito, estado.propuesta));
      return enviarCarrito(chat, "Agregado.", ctx.estado.carrito, ctx.indice);
    case ID.iaCancelar:
      await actualizarCarrito(ctx, estado.carrito);
      return mensaje(chat, "Listo, no lo agregué.");
  }

  return manejarRespuestaCheckout(ctx, id);
}

// Respuestas a las preguntas del checkout. Solo valen en el paso que las hizo:
// un botón de un mensaje viejo no puede pisar lo elegido después.
async function manejarRespuestaCheckout(ctx: Ctx, id: string) {
  const { estado } = ctx;
  const checkout = estado.checkout;

  if (estado.paso === "eligiendo_entrega" && (id === ID.entregaRetiro || id === ID.entregaDelivery)) {
    await guardarEstado(ctx, { checkout: { ...checkout, tipo: id === ID.entregaRetiro ? "retiro_local" : "delivery" } });
  } else if (estado.paso === "eligiendo_zona" && id.startsWith(ID.zona)) {
    await guardarEstado(ctx, { checkout: { ...checkout, zonaId: id.slice(ID.zona.length) } });
  } else if (estado.paso === "eligiendo_pago" && (id === ID.pagoEfectivo || id === ID.pagoMercadoPago)) {
    await guardarEstado(ctx, { checkout: { ...checkout, pago: id === ID.pagoEfectivo ? "efectivo" : "mercadopago_link" } });
  } else if (!esPasoCheckout(estado.paso)) {
    return; // id desconocido, de una conversación vieja: se ignora
  }
  // (Si es un paso de checkout y el id no corresponde, avanzarCheckout repite la pregunta.)
  return avanzarCheckout(ctx);
}
