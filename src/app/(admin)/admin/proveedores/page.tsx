import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import { ProveedoresList } from "./_components/proveedores-list";

export const metadata: Metadata = { title: "Proveedores — Kioscos IDEIA" };
export const revalidate = 0;

export default async function ProveedoresPage() {
  await requireAdmin();
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("proveedores")
    .select("id, nombre, contacto, is_active")
    .order("nombre");

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Proveedores</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Empresas de las que recibís mercadería</p>
      </div>
      <ProveedoresList proveedores={data ?? []} />
    </div>
  );
}
