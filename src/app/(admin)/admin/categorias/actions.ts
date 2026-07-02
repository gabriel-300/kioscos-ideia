"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
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

export async function crearCategoria(data: { name: string; description?: string | null }) {
  await requireAdmin();
  const supabase = createAdminClient();
  const payload: Insert = {
    name:        data.name,
    slug:        slugify(data.name),
    description: data.description || null,
  };
  const { error } = await supabase.from("categories").insert(payload);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/categorias");
  revalidatePath("/admin/productos");
}

export async function actualizarCategoria(id: string, data: { name: string; description?: string | null }) {
  await requireAdmin();
  const supabase = createAdminClient();
  const payload: Update = {
    name:        data.name,
    slug:        slugify(data.name),
    description: data.description || null,
  };
  const { error } = await supabase.from("categories").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/categorias");
  revalidatePath("/admin/productos");
}

export async function toggleCategoriaActiva(id: string, activa: boolean) {
  await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from("categories").update({ is_active: !activa }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/categorias");
  revalidatePath("/admin/productos");
}

export async function reordenarCategoria(id: string, sort_order: number) {
  await requireAdmin();
  const supabase = createAdminClient();
  const { error } = await supabase.from("categories").update({ sort_order }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/categorias");
}
