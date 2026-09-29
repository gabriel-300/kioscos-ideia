import type { createAdminClient } from "@/lib/supabase/server";
import { enviarTexto } from "@/lib/whatsapp/enviar-mensaje";
import { urlSeguimiento } from "./enlaces";
import { armarSeguimiento } from "./seguimiento";

// Avisa por WhatsApp cuando el local cambia el estado de un pedido.
//
// Solo a los pedidos que vinieron del bot: el cliente escribió primero, así que
// estamos dentro de la ventana de 24 h de Meta y se puede responder con texto
// libre. A quien pidió por la tienda web no se le puede escribir sin una
// plantilla aprobada (nunca nos escribió), y esos clientes ya tienen la página
// de seguimiento. Todo es "mejor esfuerzo": si falla, el cambio de estado que
// hizo el local ya está guardado y no se revierte.

type Admin = ReturnType<typeof createAdminClient>;

// Los estados en los que el cliente quiere enterarse. "confirmado" ya lo cubre
// el mensaje de confirmación del bot; "entregado" y "expirado" no aportan.
const ESTADOS_QUE_AVISAN = ["pagado", "en_preparacion", "listo_retiro", "en_reparto", "cancelado"];

export function textoCambioEstado(
  p: { numero: number | null; estado: string; tipo_entrega: string; medio_pago: string | null },
  enlace: string
): string | null {
  if (!ESTADOS_QUE_AVISAN.includes(p.estado)) return null;
  const { titulo, detalle } = armarSeguimiento(p);
  const lineas = [`Pedido #${p.numero ?? ""}: ${titulo}`];
  if (detalle) lineas.push(detalle);
  lineas.push("", `Seguilo acá: ${enlace}`);
  return lineas.join("\n");
}

export async function notificarCambioEstado(admin: Admin, pedidoId: string): Promise<void> {
  // Sin credenciales de WhatsApp no hay nada que mandar: ni se consulta la base.
  if (!process.env.WHATSAPP_ACCESS_TOKEN) return;
  try {
    const { data: p } = await (admin as any)
      .from("pedidos")
      .select("origen, cliente_wa_id, estado, numero, tipo_entrega, medio_pago, sucursal_id, sucursales(whatsapp_phone_number_id)")
      .eq("id", pedidoId)
      .maybeSingle();
    if (!p || p.origen !== "whatsapp" || !p.cliente_wa_id) return;

    const phoneNumberId = p.sucursales?.whatsapp_phone_number_id as string | null | undefined;
    if (!phoneNumberId) return;

    const texto = textoCambioEstado(p, urlSeguimiento(p.sucursal_id, pedidoId));
    if (!texto) return;

    const r = await enviarTexto(phoneNumberId, p.cliente_wa_id, texto);
    if (!r.ok) console.error("[notificar-cliente] no se pudo avisar por WhatsApp:", r.error);
  } catch (e) {
    console.error("[notificar-cliente] error inesperado:", (e as Error).message);
  }
}
