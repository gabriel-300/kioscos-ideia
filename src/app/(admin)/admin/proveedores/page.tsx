import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import { ProveedoresList } from "./_components/proveedores-list";

export const metadata: Metadata = { title: "Proveedores — Kioscos IDEIA" };
export const revalidate = 0;

export default async function ProveedoresPage() {
  await requireAdmin();
  const supabase = createAdminClient();

  const [provRes, comprasRes] = await Promise.all([
    supabase.from("proveedores").select("id, nombre, contacto, is_active").order("nombre"),
    (supabase as any)
      .from("movimientos")
      .select("proveedor, movimiento_items(subtotal)")
      .eq("tipo", "entrega")
      .not("proveedor", "is", null) as unknown as Promise<{
        data: { proveedor: string; movimiento_items: { subtotal: number | null }[] }[] | null;
      }>,
  ]);

  const comprasMap: Record<string, number> = {};
  for (const m of comprasRes.data ?? []) {
    if (!m.proveedor) continue;
    const sub = m.movimiento_items.reduce((s, i) => s + (i.subtotal ?? 0), 0);
    comprasMap[m.proveedor] = (comprasMap[m.proveedor] ?? 0) + sub;
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Proveedores</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Empresas de las que recibís mercadería</p>
      </div>
      <ProveedoresList proveedores={provRes.data ?? []} comprasMap={comprasMap} />
    </div>
  );
}
