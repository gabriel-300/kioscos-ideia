import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { urlCatalogo } from "@/lib/pedidos/enlaces";
import { qrComoSvg } from "@/lib/pedidos/qr";
import { BotonImprimir } from "./boton-imprimir";

// Cartel imprimible con el QR del catálogo de una sucursal. Es público a
// propósito (el QR solo apunta a una página que ya es pública) y queda fuera
// del layout del admin, así el navegador imprime solo el cartel.

export const revalidate = 0;
export const metadata: Metadata = { title: "QR para pedir", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function QrPage({ params }: { params: Promise<{ sucursal: string }> }) {
  const { sucursal: sucursalId } = await params;
  if (!UUID.test(sucursalId)) notFound();

  const admin = createAdminClient();
  const { data: sucursal } = await (admin as any)
    .from("sucursales")
    .select("nombre, is_active, pedidos_online_habilitado")
    .eq("id", sucursalId)
    .maybeSingle();
  if (!sucursal?.is_active) notFound();

  const url = urlCatalogo(sucursalId);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col items-center justify-center px-6 py-10 text-center">
      {!sucursal.pedidos_online_habilitado && (
        <p className="mb-6 rounded-xl bg-pd-tint px-4 py-3 text-[13.5px] text-pd-warn print:hidden">
          Esta sucursal todavía no acepta pedidos online: activalo en Pedidos online → Configuración antes de imprimir.
        </p>
      )}

      <p className="text-[15px] font-bold tracking-[0.08em] text-pd-ink-400">{String(sucursal.nombre).toUpperCase()}</p>
      <h1 className="mt-2 text-[44px] font-extrabold leading-none">Pedí desde tu celular</h1>
      <p className="mt-3 text-[18px] text-pd-ink-600">Escaneá el código, elegí lo que querés y lo preparamos.</p>

      <div
        className="mt-8 w-full max-w-[340px] rounded-3xl border-4 border-pd-ink bg-white p-5"
        role="img"
        aria-label={`Código QR para pedir en ${sucursal.nombre}`}
        dangerouslySetInnerHTML={{ __html: qrComoSvg(url) }}
      />

      <p className="mt-6 break-all text-[13px] text-pd-ink-400">{url}</p>

      <div className="mt-8 print:hidden"><BotonImprimir /></div>
    </main>
  );
}
