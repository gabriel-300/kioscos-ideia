"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import type { Database } from "@/types/database";

type Insert = Database["public"]["Tables"]["sucursales"]["Insert"];
type Update = Database["public"]["Tables"]["sucursales"]["Update"];

export async function crearSucursal(data: Omit<Insert, "id" | "created_at" | "updated_at">) {
  await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from("sucursales").insert(data);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/sucursales");
}

export async function actualizarSucursal(id: string, data: Update) {
  await requireAdmin();
  const supabase = createAdminClient();

  // Si se asigna un nuevo encargado, desasignarlo de cualquier otra sucursal primero
  if (data.encargado_user_id) {
    await supabase
      .from("sucursales")
      .update({ encargado_user_id: null })
      .eq("encargado_user_id", data.encargado_user_id)
      .neq("id", id);
  }

  const { error } = await supabase.from("sucursales").update(data).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/sucursales");
  revalidatePath("/admin/staff");
}

export async function toggleSucursalActiva(id: string, activa: boolean) {
  await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("sucursales")
    .update({ is_active: !activa })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/sucursales");
}

// Para completar mercadopago_pos_id sin que nadie tenga que andar buscando el
// ID a mano en el panel de Mercado Pago -- lista las Cajas ya creadas ahí
// usando el Access Token que ya está cargado como secret de Cloudflare
// (nunca pasa por el cliente ni por acá). Devuelve {error} en vez de throw:
// a diferencia del resto de este archivo, acá el mensaje de error real
// (token inválido, sin cajas, etc.) es justo lo que el admin necesita ver.
export async function listarCajasMercadoPago(): Promise<{
  error?: string;
  cajas?: { id: string; name: string; store_id: string | null }[];
}> {
  await requireAdmin();

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) return { error: "Falta MERCADOPAGO_ACCESS_TOKEN en las variables de entorno" };

  const res = await fetch("https://api.mercadopago.com/pos?limit=50", {
    headers: { "Authorization": `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return { error: `Mercado Pago respondió ${res.status}: ${bodyText || "sin detalle"}` };
  }

  // OJO: el "id" interno de Mercado Pago NO es lo mismo que "external_id" --
  // las órdenes de QR se arman contra external_id (external_pos_id en la URL
  // de la API), no contra el id numérico que asigna Mercado Pago. Primera
  // prueba real contra la API confirmó el error (404 "Point of sale not
  // found") usando el id interno por equivocación.
  const body = await res.json() as { results?: { id: number; external_id: string; name: string; store_id: number | null }[] };
  const cajas = (body.results ?? []).map((p) => ({
    id: p.external_id,
    name: p.name,
    store_id: p.store_id != null ? String(p.store_id) : null,
  }));
  if (cajas.length === 0) return { error: "No se encontraron Cajas en la cuenta de Mercado Pago" };

  return { cajas };
}
