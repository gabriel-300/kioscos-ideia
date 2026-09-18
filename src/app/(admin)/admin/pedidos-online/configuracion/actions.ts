"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import { normalizarHorario, type TramoHorario } from "@/lib/pedidos/horario";

// Solo admin: define qué sucursales aceptan pedidos online, qué zonas de
// envío tienen y a qué precio, y el horario que ve el cliente. Nada de esto
// es editable desde el público (el precio del envío sale de acá, nunca del
// browser -- ver crear-pedido-publico.ts).

export type ConfigSucursalInput = {
  pedidos_online_habilitado: boolean;
  delivery_habilitado:       boolean;
  retiro_habilitado:         boolean;
  pedido_minimo_envio:       number;
  retiro_eta_min:            number;
  retiro_eta_max:            number;
  whatsapp_pedidos:          string;
  horario_pedidos:           TramoHorario[];
};

function refrescar() {
  revalidatePath("/admin/pedidos-online/configuracion");
  revalidatePath("/pedir/[sucursal]", "page");
}

export async function guardarConfigSucursal(sucursalId: string, data: ConfigSucursalInput): Promise<{ error?: string }> {
  await requireAdmin();

  if (!(data.pedido_minimo_envio >= 0)) return { error: "El pedido mínimo no puede ser negativo" };
  if (!(data.retiro_eta_min >= 0) || !(data.retiro_eta_max >= data.retiro_eta_min)) {
    return { error: "El tiempo de retiro máximo tiene que ser mayor o igual al mínimo" };
  }

  // wa.me necesita el número en formato internacional sin "+" ni espacios.
  const whatsapp = data.whatsapp_pedidos.replace(/\D/g, "");
  if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 15)) {
    return { error: "El WhatsApp tiene que tener entre 10 y 15 dígitos (ej. 5493764123456)" };
  }

  const horario = normalizarHorario(data.horario_pedidos);

  const admin = createAdminClient();
  const { error } = await (admin as any)
    .from("sucursales")
    .update({
      pedidos_online_habilitado: data.pedidos_online_habilitado,
      delivery_habilitado:       data.delivery_habilitado,
      retiro_habilitado:         data.retiro_habilitado,
      pedido_minimo_envio:       data.pedido_minimo_envio,
      retiro_eta_min:            data.retiro_eta_min,
      retiro_eta_max:            data.retiro_eta_max,
      whatsapp_pedidos:          whatsapp || null,
      horario_pedidos:           horario,
    })
    .eq("id", sucursalId);
  if (error) return { error: error.message };

  refrescar();
  return {};
}

export type ZonaInput = {
  id?:         string;
  sucursal_id: string;
  nombre:      string;
  costo:       number;
  eta_min:     number;
  eta_max:     number;
  is_active:   boolean;
};

export async function guardarZona(data: ZonaInput): Promise<{ error?: string; id?: string }> {
  await requireAdmin();

  if (!data.nombre.trim()) return { error: "La zona necesita un nombre" };
  if (!(data.costo >= 0)) return { error: "El costo de envío no puede ser negativo" };
  if (!(data.eta_min >= 0) || !(data.eta_max >= data.eta_min)) return { error: "El tiempo máximo tiene que ser mayor o igual al mínimo" };

  const admin = createAdminClient();
  const fila = {
    nombre:     data.nombre.trim(),
    costo:      data.costo,
    eta_min:    data.eta_min,
    eta_max:    data.eta_max,
    is_active:  data.is_active,
    updated_at: new Date().toISOString(),
  };

  if (data.id) {
    const { error } = await (admin as any).from("zonas_entrega").update(fila).eq("id", data.id).eq("sucursal_id", data.sucursal_id);
    if (error) return { error: error.message };
    refrescar();
    return { id: data.id };
  }

  const { data: creada, error } = await (admin as any)
    .from("zonas_entrega")
    .insert({ ...fila, sucursal_id: data.sucursal_id })
    .select("id")
    .single();
  if (error) return { error: error.message };
  refrescar();
  return { id: creada.id };
}

// Los pedidos viejos conservan el nombre y costo de la zona (snapshot en
// pedidos.zona_nombre / costo_envio), así que borrar una zona no los rompe.
export async function eliminarZona(zonaId: string): Promise<{ error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await (admin as any).from("zonas_entrega").delete().eq("id", zonaId);
  if (error) return { error: error.message };
  refrescar();
  return {};
}
