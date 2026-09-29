import type { createAdminClient } from "@/lib/supabase/server";
import type { CatalogoSucursal } from "../catalogo";
import type { IndiceCatalogo } from "./carrito";
import { serializarEstado, type BotState } from "./estado";

export type Admin = ReturnType<typeof createAdminClient>;

// A quién se le responde (Graph API: el número del negocio y el del cliente).
export type Chat = { phoneNumberId: string; waId: string };

// Fila del pedido en estado 'carrito' donde vive la conversación.
export type Conversacion = { id: string; cliente_nombre: string | null };

// Todo lo que necesita un paso de la conversación, armado una vez por mensaje.
export type Ctx = {
  admin:      Admin;
  chat:       Chat;
  sucursalId: string;
  pedido:     Conversacion;
  estado:     BotState;
  catalogo:   CatalogoSucursal;
  indice:     IndiceCatalogo;
};

// Aplica el cambio en memoria y lo persiste en bot_paso.
export async function guardarEstado(ctx: Ctx, cambios: Partial<BotState>): Promise<void> {
  ctx.estado = { ...ctx.estado, ...cambios };
  await (ctx.admin as any).from("pedidos").update({ bot_paso: serializarEstado(ctx.estado) }).eq("id", ctx.pedido.id);
}
