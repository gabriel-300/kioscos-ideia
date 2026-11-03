"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCatalogo, validarFilaEditable } from "@/lib/auth/catalogo-propio";
import type { Database } from "@/types/database";

type Insert = Database["public"]["Tables"]["categories"]["Insert"];
type Update = Database["public"]["Tables"]["categories"]["Update"];

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// El slug de categories es único en toda la base: una categoría propia que se llame
// igual que una de IDEIA (o de otro local) chocaría, así que lleva un sufijo del dueño.
function slugCategoria(name: string, ownerSucursalId: string | null) {
  const base = slugify(name);
  return ownerSucursalId ? `${base}-${ownerSucursalId.slice(0, 6)}` : base;
}

export async function crearCategoria(data: { name: string; description?: string | null }) {
  const { userId, ownerSucursalId } = await requireCatalogo();
  const supabase = createAdminClient();
  const payload = {
    name:        data.name,
    slug:        slugCategoria(data.name, ownerSucursalId),
    description: data.description || null,
    created_by:  userId,
    owner_sucursal_id: ownerSucursalId,
  } as Insert;
  const { error } = await supabase.from("categories").insert(payload);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/categorias");
  revalidatePath("/admin/productos");
}

export async function actualizarCategoria(id: string, data: { name: string; description?: string | null }) {
  const alcance = await requireCatalogo();
  const { userId } = alcance;
  const errorFila = await validarFilaEditable(alcance, "categories", id);
  if (errorFila) throw new Error(errorFila);
  const supabase = createAdminClient();
  const { data: fila } = await (supabase as any).from("categories").select("owner_sucursal_id").eq("id", id).maybeSingle();
  const payload: Update = {
    name:        data.name,
    slug:        slugCategoria(data.name, (fila as { owner_sucursal_id: string | null } | null)?.owner_sucursal_id ?? null),
    description: data.description || null,
    updated_by:  userId,
  };
  const { error } = await supabase.from("categories").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/categorias");
  revalidatePath("/admin/productos");
}

export async function toggleCategoriaActiva(id: string, activa: boolean) {
  const alcance = await requireCatalogo();
  const { userId } = alcance;
  const errorFila = await validarFilaEditable(alcance, "categories", id);
  if (errorFila) throw new Error(errorFila);
  const supabase = createAdminClient();
  const { error } = await supabase.from("categories").update({ is_active: !activa, updated_by: userId }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/categorias");
  revalidatePath("/admin/productos");
}

export async function reordenarCategoria(id: string, sort_order: number) {
  const alcance = await requireCatalogo();
  const { userId } = alcance;
  const errorFila = await validarFilaEditable(alcance, "categories", id);
  if (errorFila) throw new Error(errorFila);
  const supabase = createAdminClient();
  const { error } = await supabase.from("categories").update({ sort_order, updated_by: userId }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/categorias");
}
