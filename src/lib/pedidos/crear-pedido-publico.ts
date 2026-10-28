import { createAdminClient } from "@/lib/supabase/server";
import { chequearRateLimit } from "./rate-limit";
import { resolverItemsPedido, redondearMoneda, type ItemCarritoInput } from "./pricing";
import { revisarStock } from "./stock";
import { verificarAlcance } from "./alcance-envio";
import { leerRadioZona } from "./alcance-servidor";
import { leerCoordenadasSucursal } from "./locales";
import { telefonoValido } from "./validaciones";
import { estadoHorario, normalizarHorario } from "./horario";
import { calcularBeneficio, repartirDescuento } from "./beneficio-cliente";
import { esPrimeraCompra, leerConfigBeneficio } from "./beneficio-servidor";
import { crearCheckoutMercadoPago } from "./checkout-mercadopago";
import { coordenadasValidas, DIRECCION_POR_GPS, redondearCoordenada } from "./ubicacion";
import { aceptaEfectivoOnline, leerEfectivoOnline } from "./medios-pago";
import { estadoEnvios, estadoPedidos, leerDisponibilidadOnline } from "./disponibilidad-online";

// Núcleo de iniciarPedido() (src/lib/pedidos/actions.ts), separado a
// propósito de la Server Action: no toca next/headers (el identificador del
// rate limit llega por parámetro), así se puede ejercitar con un script
// contra la base real sin levantar Next.
//
// Nada de lo que decide plata viene del cliente: precios y promos los
// resuelve resolverItemsPedido(), el costo de envío sale de la tabla
// zonas_entrega, y el mínimo de envío se compara contra el subtotal
// calculado acá, no contra un número que mande el browser.

const EXPIRACION_MP_LINK_MS = 2 * 60 * 60 * 1000; // margen para pagar; también es el vencimiento del enlace de Mercado Pago

// Topes de lo que escribe el cliente (una Server Action no tiene otro límite que el tamaño del cuerpo).
const MAX_NOMBRE = 80;
const MAX_TELEFONO = 30;
const MAX_NOTAS = 500;
const MAX_DIRECCION = 200;
const MAX_PAGO_CON = 10_000_000;

// Contra pedidos falsos en cadena: el rate limit por conexión no frena a quien rota de IP, así que además se
// limita lo que puede quedar abierto de una sola vez. Un local real no llega ni cerca de estos números.
const MAX_ESPERANDO_PAGO_POR_LOCAL = 40;     // pedidos con link de Mercado Pago sin pagar y sin vencer
const MAX_EFECTIVO_EN_CURSO_POR_CLIENTE = 3; // pedidos en efectivo de un mismo cliente que el local todavía no cerró
const ESTADOS_EN_CURSO = ["confirmado", "en_preparacion", "listo_retiro", "en_reparto"];

export type DatosPedidoPublico = {
  sucursal_id:          string;
  cliente_nombre:       string;
  cliente_telefono:     string;
  notas:                string | null;
  tipo_entrega:         "retiro_local" | "delivery";
  zona_entrega_id:      string | null;
  direccion_entrega:    string | null;
  direccion_referencia: string | null;
  entrega_lat?:         number | null; // punto GPS de entrega (opcional): reemplaza a la dirección escrita
  entrega_lng?:         number | null;
  medio_pago:           "efectivo" | "mercadopago_link";
  pago_con:             number | null;
  items:                ItemCarritoInput[]; // nunca lleva precio -- el público no lo manda
};

export type ResultadoPedidoPublico = {
  pedido_id?:   string;
  numero?:      number;
  estado?:      string;
  subtotal?:    number;
  costo_envio?: number;
  descuento?:   number;  // beneficio de cliente registrado (0 si no hubo)
  envio_bonificado?: boolean;
  total?:       number;
  zona_nombre?: string | null;
  eta_min?:     number | null;
  eta_max?:     number | null;
  checkout_url?: string | null; // enlace de pago de Mercado Pago (null si es efectivo o no se pudo generar)
  sin_stock?:   { productId: string; disponible: number; pedido: number }; // qué producto no alcanzó y cuánto queda
  error?:       string;
};

// Solo lo puede pasar código de servidor, NUNCA viene del browser: por eso no es
// parte de DatosPedidoPublico, que la Server Action recibe tal cual del cliente.
export type ContextoPedido = {
  // Conversación del bot de WhatsApp: en vez de insertar, se completa la fila
  // "carrito" donde el bot venía armando el pedido (así el número de pedido no
  // salta y no queda una fila vacía).
  bot?: { cliente_wa_id: string; pedido_existente_id: string };
  // Cliente registrado: sale de la sesión, nunca de lo que mande el browser.
  // Es lo que habilita los beneficios (descuento / envío gratis).
  clienteId?: string;
  // Persona del personal logueada en la sucursal del pedido (sale de la sesión): puede pedir en efectivo sin ser cliente.
  personalId?: string;
};

export async function crearPedidoPublico(
  admin: ReturnType<typeof createAdminClient>,
  data: DatosPedidoPublico,
  identificadorRateLimit: string,
  contexto?: ContextoPedido
): Promise<ResultadoPedidoPublico> {
  // ── Validaciones baratas, sin tocar la base ni el rate limit ──────────
  // Una Server Action recibe lo que mande el navegador: tipos y largos se controlan acá, no se confían.
  for (const campo of [data.cliente_nombre, data.cliente_telefono, data.notas, data.direccion_entrega, data.direccion_referencia]) {
    if (campo != null && typeof campo !== "string") return { error: "Los datos del pedido no son válidos" };
  }
  if ((data.cliente_nombre ?? "").length > MAX_NOMBRE) return { error: `El nombre es muy largo (máximo ${MAX_NOMBRE} letras)` };
  if ((data.cliente_telefono ?? "").length > MAX_TELEFONO) return { error: "El teléfono no es válido" };
  if ((data.notas ?? "").length > MAX_NOTAS) return { error: `Las notas son muy largas (máximo ${MAX_NOTAS} letras)` };
  if ((data.direccion_entrega ?? "").length > MAX_DIRECCION || (data.direccion_referencia ?? "").length > MAX_DIRECCION) {
    return { error: `La dirección es muy larga (máximo ${MAX_DIRECCION} letras)` };
  }
  if (data.pago_con != null && !(Number.isFinite(data.pago_con) && data.pago_con <= MAX_PAGO_CON)) return { error: "El monto con el que pagás no es válido" };
  if ((data.cliente_nombre ?? "").trim().length < 2) return { error: "Escribí tu nombre" };
  if (!telefonoValido(data.cliente_telefono ?? "")) return { error: "Escribí un WhatsApp válido (con característica, 10 dígitos)" };
  if (data.tipo_entrega !== "retiro_local" && data.tipo_entrega !== "delivery") return { error: "Elegí cómo querés recibir el pedido" };
  if (data.medio_pago !== "efectivo" && data.medio_pago !== "mercadopago_link") return { error: "Elegí cómo vas a pagar" };
  // Un envío lleva la dirección escrita, el punto GPS del celular, o las dos.
  const mandoGps = data.entrega_lat != null || data.entrega_lng != null;
  const conGps = data.tipo_entrega === "delivery" && coordenadasValidas(data.entrega_lat, data.entrega_lng);
  if (data.tipo_entrega === "delivery") {
    if (!data.zona_entrega_id) return { error: "Elegí la zona de entrega" };
    // Desde la tienda el envío va siempre a la ubicación GPS. El bot de WhatsApp todavía arma el envío con la dirección escrita.
    if (mandoGps && !conGps) return { error: "No pudimos tomar tu ubicación. Probá de nuevo." };
    if (!conGps && !contexto?.bot) return { error: "Compartí tu ubicación para que el repartidor te encuentre" };
    if (!conGps && !data.direccion_entrega?.trim()) return { error: "Falta la dirección de entrega" };
    // Además del GPS, desde la tienda hay que decir dónde exactamente (aula, piso o dirección): se pide en cada pedido.
    if (!contexto?.bot && (data.direccion_referencia ?? "").trim().length < 3) return { error: "Escribí el aula, piso o dirección para que el repartidor te encuentre" };
  }

  const rateLimitError = await chequearRateLimit(admin, identificadorRateLimit);
  if (rateLimitError) return { error: rateLimitError };

  // ── Sucursal habilitada para lo que se pide ───────────────────────────
  const { data: sucursal } = await (admin as any)
    .from("sucursales")
    .select("is_active, pedidos_online_habilitado, delivery_habilitado, retiro_habilitado, pedido_minimo_envio, retiro_eta_min, retiro_eta_max, horario_pedidos")
    .eq("id", data.sucursal_id)
    .single();
  if (!sucursal?.is_active || !sucursal.pedidos_online_habilitado) {
    return { error: "Esta sucursal todavía no acepta pedidos online" };
  }
  // Efectivo: solo si la sucursal lo habilita y el cliente ingresó (la sesión, no lo que mande el navegador).
  if (data.medio_pago === "efectivo" && !aceptaEfectivoOnline(await leerEfectivoOnline(admin, data.sucursal_id), !!contexto?.clienteId || !!contexto?.personalId)) {
    return { error: "Para pagar en efectivo tenés que ingresar con Google. Si no, pagá con Mercado Pago." };
  }
  if (data.medio_pago === "efectivo" && contexto?.clienteId) {
    const { count } = await (admin as any)
      .from("pedidos")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", contexto.clienteId)
      .eq("medio_pago", "efectivo")
      .in("estado", ESTADOS_EN_CURSO);
    if ((count ?? 0) >= MAX_EFECTIVO_EN_CURSO_POR_CLIENTE) {
      return { error: "Ya tenés pedidos en curso. Esperá a que el local los entregue para hacer otro, o pagá con Mercado Pago." };
    }
  }
  if (data.medio_pago === "mercadopago_link") {
    const { count } = await (admin as any)
      .from("pedidos")
      .select("id", { count: "exact", head: true })
      .eq("sucursal_id", data.sucursal_id)
      .eq("estado", "pendiente_pago")
      .gt("expira_en", new Date().toISOString());
    if ((count ?? 0) >= MAX_ESPERANDO_PAGO_POR_LOCAL) {
      return { error: "Hay muchos pedidos esperando el pago en este local. Probá de nuevo en unos minutos." };
    }
  }
  // El horario de atención también se valida acá, no solo en la pantalla (auditoría 19/09, H-12).
  // Sin horario cargado la sucursal está siempre abierta.
  const horario = estadoHorario(normalizarHorario(sucursal.horario_pedidos));
  if (!horario.abierto) {
    return { error: `El local está cerrado por ahora${horario.proximaApertura ? `. Abre ${horario.proximaApertura}` : ""}` };
  }
  // Pausas que el personal prende desde Tenteo y horario propio del envío (migración 122; sin ella, todo normal).
  const disponibilidad = await leerDisponibilidadOnline(admin, data.sucursal_id);
  const pedidos = estadoPedidos(disponibilidad);
  if (pedidos.pausado) return { error: `Por ahora no estamos tomando pedidos online${pedidos.motivo ? `: ${pedidos.motivo}` : ""}` };
  if (data.tipo_entrega === "delivery") {
    const envio = estadoEnvios(disponibilidad);
    if (!envio.disponible) return { error: envio.mensaje ?? "Ahora no hacemos envíos" };
  }
  if (data.tipo_entrega === "delivery" && !sucursal.delivery_habilitado) return { error: "Esta sucursal no hace envíos por ahora" };
  if (data.tipo_entrega === "retiro_local" && !sucursal.retiro_habilitado) return { error: "Esta sucursal no tiene retiro en el local por ahora" };

  // ── Precios/promos/stock: siempre del servidor ────────────────────────
  const resuelto = await resolverItemsPedido(admin, data.sucursal_id, data.items);
  if ("error" in resuelto) return { error: resuelto.error };

  const faltaStock = await revisarStock(admin, data.sucursal_id, resuelto.items);
  if (faltaStock) {
    return {
      error: faltaStock.error,
      ...(faltaStock.productId ? { sin_stock: { productId: faltaStock.productId, disponible: faltaStock.disponible ?? 0, pedido: faltaStock.pedido ?? 0 } } : {}),
    };
  }

  // ── Envío: zona y costo salen de la base, nunca del cliente ───────────
  let costoEnvio = 0;
  let zonaNombre: string | null = null;
  let etaMin: number | null = sucursal.retiro_eta_min ?? null;
  let etaMax: number | null = sucursal.retiro_eta_max ?? null;

  if (data.tipo_entrega === "delivery") {
    const { data: zona } = await (admin as any)
      .from("zonas_entrega")
      .select("id, nombre, costo, eta_min, eta_max")
      .eq("id", data.zona_entrega_id)
      .eq("sucursal_id", data.sucursal_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!zona) return { error: "La zona de entrega elegida ya no está disponible" };

    // El punto GPS tiene que caer dentro de lo que cubre la zona (radio opcional por zona, migración 128).
    if (conGps) {
      const [radio, local] = await Promise.all([leerRadioZona(admin, zona.id), leerCoordenadasSucursal(admin, data.sucursal_id)]);
      const alcance = verificarAlcance({ lat: data.entrega_lat as number, lng: data.entrega_lng as number }, local, radio, zona.nombre);
      if (!alcance.ok) return { error: alcance.mensaje };
    }

    const minimo = Number(sucursal.pedido_minimo_envio ?? 0);
    if (minimo > 0 && resuelto.subtotal < minimo) {
      return { error: `El pedido mínimo para envío es $${minimo.toLocaleString("es-AR")}` };
    }

    costoEnvio = Number(zona.costo);
    zonaNombre = zona.nombre;
    etaMin = zona.eta_min;
    etaMax = zona.eta_max;
  }

  // ── Beneficios de cliente registrado (se calculan siempre acá, nunca en el browser) ──
  const beneficio = contexto?.clienteId
    ? calcularBeneficio({
        subtotal:        resuelto.subtotal,
        esCliente:       true,
        esPrimeraCompra: await esPrimeraCompra(admin, contexto.clienteId),
        esDelivery:      data.tipo_entrega === "delivery",
        config:          await leerConfigBeneficio(admin, data.sucursal_id),
      })
    : { descuentoProductos: 0, envioBonificado: false };
  if (beneficio.envioBonificado) costoEnvio = 0;
  const itemsAGuardar = repartirDescuento(resuelto.items, beneficio.descuentoProductos);

  const total = redondearMoneda(resuelto.subtotal - beneficio.descuentoProductos + costoEnvio);

  if (data.medio_pago === "efectivo" && data.pago_con != null) {
    if (!(data.pago_con >= total)) return { error: "El monto con el que pagás tiene que ser al menos el total del pedido" };
  }

  // ── Efectivo: queda aceptado, cobro pendiente. Mercado Pago (link): espera el pago ──
  const esEfectivo = data.medio_pago === "efectivo";

  const fila = {
      sucursal_id:          data.sucursal_id,
      origen:               contexto?.bot ? "whatsapp" : "storefront",
      cliente_wa_id:        contexto?.bot?.cliente_wa_id ?? null,
      estado:               esEfectivo ? "confirmado" : "pendiente_pago",
      tipo_entrega:         data.tipo_entrega,
      direccion_entrega:    data.tipo_entrega === "delivery" ? (data.direccion_entrega?.trim() || DIRECCION_POR_GPS) : null,
      direccion_referencia: data.tipo_entrega === "delivery" ? (data.direccion_referencia?.trim() || null) : null,
      zona_entrega_id:      data.tipo_entrega === "delivery" ? data.zona_entrega_id : null,
      zona_nombre:          zonaNombre,
      cliente_nombre:       data.cliente_nombre.trim(),
      cliente_telefono:     data.cliente_telefono.trim(),
      notas:                data.notas?.trim() || null,
      subtotal:             resuelto.subtotal,
      costo_envio:          costoEnvio,
      total,
      // Columnas de la migración 118: solo se escriben si el cliente compartió su ubicación.
      ...(conGps ? { entrega_latitud: redondearCoordenada(data.entrega_lat as number), entrega_longitud: redondearCoordenada(data.entrega_lng as number) } : {}),
      // Columnas de la migración 099: solo se escriben si hay cliente registrado.
      ...(contexto?.clienteId ? { cliente_id: contexto.clienteId, descuento_total: beneficio.descuentoProductos } : {}),
      medio_pago:           data.medio_pago,
      pago_con:             esEfectivo ? (data.pago_con ?? null) : null,
      eta_min:              etaMin,
      eta_max:              etaMax,
      expira_en:            esEfectivo ? null : new Date(Date.now() + EXPIRACION_MP_LINK_MS).toISOString(),
  };

  const { data: pedido, error: pedidoError } = contexto?.bot
    ? await (admin as any)
        .from("pedidos")
        .update(fila)
        .eq("id", contexto.bot.pedido_existente_id)
        .eq("sucursal_id", data.sucursal_id)
        .eq("estado", "carrito") // atómico: dos "confirmar" seguidos no generan dos pedidos
        .select("id, numero, estado")
        .single()
    : await (admin as any).from("pedidos").insert(fila).select("id, numero, estado").single();
  if (pedidoError || !pedido) return { error: pedidoError?.message ?? "No se pudo crear el pedido" };

  const { error: itemsError } = await (admin as any)
    .from("pedido_items")
    .insert(itemsAGuardar.map((i) => ({ pedido_id: pedido.id, ...i })));
  if (itemsError) {
    // Un pedido "confirmado" sin ítems le aparecería al local como pedido
    // vacío: se borra (o, si era la conversación del bot, vuelve a "carrito").
    if (contexto?.bot) {
      await (admin as any).from("pedidos").update({ estado: "carrito", expira_en: null }).eq("id", pedido.id);
    } else {
      await (admin as any).from("pedidos").delete().eq("id", pedido.id);
    }
    return { error: itemsError.message };
  }

  // Mercado Pago: el cliente paga con un checkout propio, sin que el local mande ningún link.
  // Si no se puede generar, el pedido queda esperando el pago y el local lo confirma a mano.
  let checkoutUrl: string | null = null;
  if (!esEfectivo) {
    const checkout = await crearCheckoutMercadoPago(admin, {
      id: pedido.id, numero: Number(pedido.numero), sucursal_id: data.sucursal_id, total, expira_en: fila.expira_en,
    });
    checkoutUrl = checkout.url;
    if (checkout.error) console.error("[pedidos] checkout de Mercado Pago:", checkout.error);
  }

  return {
    pedido_id:   pedido.id,
    numero:      Number(pedido.numero),
    estado:      pedido.estado,
    subtotal:    resuelto.subtotal,
    costo_envio: costoEnvio,
    descuento:   beneficio.descuentoProductos,
    envio_bonificado: beneficio.envioBonificado,
    total,
    zona_nombre: zonaNombre,
    eta_min:     etaMin,
    eta_max:     etaMax,
    checkout_url: checkoutUrl,
  };
}
