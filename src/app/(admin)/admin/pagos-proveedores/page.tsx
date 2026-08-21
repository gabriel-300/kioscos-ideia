import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const metadata: Metadata = { title: "Pagos a proveedores — Kioscos IDEIA" };
export const revalidate = 0;

// Índice para llegar directo desde el menú -- Pagos a proveedores en sí sigue
// viviendo por sucursal (/admin/sucursales/[id]/pagos-proveedores), esto solo
// evita tener que entrar primero a un kiosco puntual para encontrarlo.
export default async function PagosProveedoresIndexPage() {
  const supabase = await createClient();
  const admin    = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role as string) ?? "";
  if (role === "vendedor") redirect("/admin/dashboard");

  if (role === "encargado") {
    const { data: suc } = await admin.from("sucursales").select("id").eq("encargado_user_id", user.id).single();
    if (!suc) redirect("/admin/dashboard");
    redirect(`/admin/sucursales/${suc.id}/pagos-proveedores`);
  }

  const { data: sucursales } = await admin.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre");

  return (
    <div className="p-4 md:p-8 max-w-lg">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Pagos a proveedores</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Elegí el kiosco</p>
      </div>
      <div className="space-y-2">
        {(sucursales ?? []).map((s) => (
          <Link
            key={s.id}
            href={`/admin/sucursales/${s.id}/pagos-proveedores`}
            className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3.5 hover:border-tierra-300 hover:bg-tierra-50/40 transition-colors"
          >
            <span className="font-medium text-neutral-800">{s.nombre}</span>
            <svg className="size-4 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </Link>
        ))}
      </div>
    </div>
  );
}
