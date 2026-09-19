import { createAdminClient } from "@/lib/supabase/server";
import { chequearRateLimit } from "./rate-limit";
import { resolverItemsPedido, redondearMoneda, type ItemCarritoInput } from "./pricing";
import { chequearStockLiviano } from "./stock";
import { telefonoValido } from "./validaciones";
import { estadoHorario, normalizarHorario } from "./horario";

// Núcleo de iniciarPedido() (src/lib/pedidos/actions.ts), separado a
// propósito de la Server Action: no toca next/headers (el identificador del
// rate limit llega por parámetro), así se puede ejercitar con un script
// contra la base real sin levantar Next.
//
// Nada de lo que decide plata viene del cliente: precios y promos los
// resuelve resolverItemsPedido(), el costo de envío sale de la tabla
// zonas_entrega, y el mínimo de envío se compara contra el subtotal
// calculado acá, no contra un número que mande el browser.

const EXPIRACION_MP_LINK_MS = 2 * 60 * 60 * 1000; // el local manda el link por WhatsApp, hace falta más margen que con QR automático

export type DatosPedidoPublico = {
  sucursal_id:          string;
  cliente_nombre:       string;
  cliente_telefono:     string;
  notas:                string | null;
  tipo_entrega:         "retiro_local" | "delivery";
  zona_entrega_id:      string | null;
  direccion_entrega:    string | null;
  direccion_referencia: string | null;
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
  total?:       number;
  zona_nombre?: string | null;
  eta_min?:     number | null;
  eta_max?:     number | null;
  error?:       string;
};

export async function crearPedidoPublico(
  admin: ReturnType<typeof createAdminClient>,
  data: DatosPedidoPublico,
  identificadorRateLimit: string
): Promise<ResultadoPedidoPublico> {
  // ── Validaciones baratas, sin tocar la base ni el rate limit ──────────
  if (data.cliente_nombre?.trim().length < 2) return { error: "Escribí tu nombre" };
  if (!telefonoValido(data.cliente_telefono ?? "")) return { error: "Escribí un WhatsApp válido (con característica, 10 dígitos)" };
  if (data.tipo_entrega !== "retiro_local" && data.tipo_entrega !== "delivery") return { error: "Elegí cómo querés recibir el pedido" };
  if (data.medio_pago !== "efectivo" && data.medio_pago !== "mercadopago_link") return { error: "Elegí cómo vas a pagar" };
  if (data.tipo_entrega === "delivery") {
    if (!data.zona_entrega_id) return { error: "Elegí la zona de entrega" };
    if (!data.direccion_entrega?.trim()) return { error: "Falta la dirección de entrega" };
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
  // El horario de atención también se valida acá, no solo en la pantalla (auditoría 19/09, H-12).
  // Sin horario cargado la sucursal está siempre abierta.
  const horario = estadoHorario(normalizarHorario(sucursal.horario_pedidos));
  if (!horario.abierto) {
    return { error: `El local está cerrado por ahora${horario.proximaApertura ? `. Abre ${horario.proximaApertura}` : ""}` };
  }
  if (data.tipo_entrega === "delivery" && !sucursal.delivery_habilitado) return { error: "Esta sucursal no hace envíos por ahora" };
  if (data.tipo_entrega === "retiro_local" && !sucursal.retiro_habilitado) return { error: "Esta sucursal no tiene retiro en el local por ahora" };

  // ── Precios/promos/stock: siempre del servidor ────────────────────────
  const resuelto = await resolverItemsPedido(admin, data.sucursal_id, data.items);
  if ("error" in resuelto) return { error: resuelto.error };

  const stockError = await chequearStockLiviano(admin, data.sucursal_id, resuelto.items);
  if (stockError) return { error: stockError };

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

    const minimo = Number(sucursal.pedido_minimo_envio ?? 0);
    if (minimo > 0 && resuelto.subtotal < minimo) {
      return { error: `El pedido mínimo para envío es $${minimo.toLocaleString("es-AR")}` };
    }

    costoEnvio = Number(zona.costo);
    zonaNombre = zona.nombre;
    etaMin = zona.eta_min;
    etaMax = zona.eta_max;
  }

  const total = redondearMoneda(resuelto.subtotal + costoEnvio);

  if (data.medio_pago === "efectivo" && data.pago_con != null) {
    if (!(data.pago_con >= total)) return { error: "El monto con el que pagás tiene que ser al menos el total del pedido" };
  }

  // ── Efectivo: queda aceptado, cobro pendiente. Mercado Pago (link): espera el pago ──
  const esEfectivo = data.medio_pago === "efectivo";

  const { data: pedido, error: pedidoError } = await (admin as any)
    .from("pedidos")
    .insert({
      sucursal_id:          data.sucursal_id,
      origen:               "storefront",
      estado:               esEfectivo ? "confirmado" : "pendiente_pago",
      tipo_entrega:         data.tipo_entrega,
      direccion_entrega:    data.tipo_entrega === "delivery" ? data.direccion_entrega!.trim() : null,
      direccion_referencia: data.tipo_entrega === "delivery" ? (data.direccion_referencia?.trim() || null) : null,
      zona_entrega_id:      data.tipo_entrega === "delivery" ? data.zona_entrega_id : null,
      zona_nombre:          zonaNombre,
      cliente_nombre:       data.cliente_nombre.trim(),
      cliente_telefono:     data.cliente_telefono.trim(),
      notas:                data.notas?.trim() || null,
      subtotal:             resuelto.subtotal,
      costo_envio:          costoEnvio,
      total,
      medio_pago:           data.medio_pago,
      pago_con:             esEfectivo ? (data.pago_con ?? null) : null,
      eta_min:              etaMin,
      eta_max:              etaMax,
      expira_en:            esEfectivo ? null : new Date(Date.now() + EXPIRACION_MP_LINK_MS).toISOString(),
    })
    .select("id, numero, estado")
    .single();
  if (pedidoError || !pedido) return { error: pedidoError?.message ?? "No se pudo crear el pedido" };

  const { error: itemsError } = await (admin as any)
    .from("pedido_items")
    .insert(resuelto.items.map((i) => ({ pedido_id: pedido.id, ...i })));
  if (itemsError) {
    // Un pedido "confirmado" sin ítems le aparecería al local como pedido
    // vacío -- se borra en vez de dejarlo huérfano.
    await (admin as any).from("pedidos").delete().eq("id", pedido.id);
    return { error: itemsError.message };
  }

  return {
    pedido_id:   pedido.id,
    numero:      Number(pedido.numero),
    estado:      pedido.estado,
    subtotal:    resuelto.subtotal,
    costo_envio: costoEnvio,
    total,
    zona_nombre: zonaNombre,
    eta_min:     etaMin,
    eta_max:     etaMax,
  };
}
