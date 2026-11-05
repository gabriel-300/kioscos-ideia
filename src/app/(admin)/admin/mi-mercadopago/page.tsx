import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { sucursalConCatalogoPropio } from "@/lib/auth/catalogo-propio";
import { estadoMercadoPago } from "./actions";
import { MercadoPagoLocal } from "./_components/mercadopago-local";

export const metadata: Metadata = { title: "Mi Mercado Pago — Kioscos IDEIA" };
export const revalidate = 0;

// El dueño de un local independiente conecta SU cuenta de Mercado Pago (migración 134). Un admin entra con
// ?sucursal=<id> para configurarla en nombre del local.
export default async function MiMercadoPagoPage({ searchParams }: { searchParams: Promise<{ sucursal?: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const role = user.app_metadata?.role as string | undefined;
  const sp = await searchParams;

  let sucursalId: string | null = null;
  if (role === "admin") sucursalId = sp.sucursal ?? null;
  else if (role === "concesionario") sucursalId = await sucursalConCatalogoPropio(user.id);
  if (!sucursalId) redirect("/admin/dashboard");

  const admin = createAdminClient();
  const { data: suc } = await (admin as any).from("sucursales").select("nombre, catalogo_propio").eq("id", sucursalId).maybeSingle();
  if (!suc?.catalogo_propio) redirect("/admin/dashboard");

  const res = await estadoMercadoPago(role === "admin" ? sucursalId : undefined);
  if (res.error || !res.estado) redirect("/admin/dashboard");

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Mi Mercado Pago</h1>
        <p className="text-sm text-neutral-400 mt-0.5">
          Conectá la cuenta de Mercado Pago de {(suc.nombre as string).trim()}: el QR de tus ventas cobra directo ahí.
        </p>
      </div>
      <MercadoPagoLocal estado={res.estado} sucursalId={role === "admin" ? sucursalId : undefined} />
    </div>
  );
}
