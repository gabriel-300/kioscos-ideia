import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { cargarLocalesParaPedir } from "@/lib/pedidos/locales";
import { cargarTienda } from "@/lib/pedidos/tienda-servidor";
import { ElegirLocal } from "./elegir-local";
import { FondoMenu } from "./fondo-menu";
import { PedidoEnCurso } from "./_components/pedido-en-curso";
import { Portada } from "./_components/portada";
import { JsonLd } from "@/components/json-ld";
import { cargarLocalesSeo } from "@/lib/pedidos/seo-servidor";
import { DESCRIPCION_MARCA, IMAGEN_COMPARTIR, jsonLdLocal, jsonLdMarca } from "@/lib/pedidos/seo";

// "¿Dónde querés pedir?": cada local tiene su propio catálogo, stock y precios, así
// que quien llega sin un local elegido (la raíz del dominio de clientes) lo elige acá.
// Si hay un solo local habilitado no hay nada que elegir y va directo.
// Se muestra como un diálogo translúcido sobre el menú de un local (como PedidosYa), para
// que el cliente vea productos desde el primer segundo.
// Este Server Component solo carga los datos; la lista, el orden por cercanía (GPS, en el
// navegador del cliente) y el atajo al último local viven en ElegirLocal.

export const revalidate = 0;
const TITULO = "Angiru Food · Panadería, confitería y delicatessen en Posadas";
export const metadata: Metadata = {
  title: { absolute: TITULO },
  description: DESCRIPCION_MARCA,
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "es_AR", siteName: "Angiru Food", title: TITULO, description: DESCRIPCION_MARCA, url: "/", images: [{ url: IMAGEN_COMPARTIR, width: 1200, height: 630, alt: "Angiru Food" }] },
  twitter: { card: "summary_large_image", title: TITULO, description: DESCRIPCION_MARCA, images: [IMAGEN_COMPARTIR] },
};

export default async function ElegirLocalPage() {
  const admin = createAdminClient();
  const locales = await cargarLocalesParaPedir(admin);
  // Un solo local: portada de la marca con ese local (y datos estructurados). Con dos o más, se elige acá.
  if (locales.length === 1) {
    const [local] = (await cargarLocalesSeo(admin)).filter((l) => l.id === locales[0].id);
    if (local) return <><Portada local={local} /><JsonLd datos={jsonLdMarca()} /><JsonLd datos={jsonLdLocal(local)} /></>;
    redirect(`/pedir/${locales[0].id}`);
  }

  // El fondo es decoración: si falla o no hay locales, el diálogo se ve igual sobre fondo liso.
  const paraFondo = locales.find((l) => l.abierto) ?? locales[0];
  const fondo = paraFondo ? await cargarTienda(admin, paraFondo.id).catch(() => null) : null;

  return (
    <>
      {fondo && <FondoMenu config={fondo.config} catalogo={fondo.catalogo} />}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-pd-ink/35 p-4 backdrop-blur-[3px]">
        <main
          role="dialog"
          aria-modal="true"
          aria-labelledby="titulo-elegir-local"
          className="max-h-[90dvh] w-full max-w-[480px] overflow-y-auto rounded-3xl border border-white/60 bg-pd-paper/90 px-5 pb-6 pt-6 shadow-2xl backdrop-blur-md"
        >
          <PedidoEnCurso className="mb-4" />
          <h1 id="titulo-elegir-local" className="text-[28px] leading-tight">¿Dónde querés pedir?</h1>
          <p className="mt-2 text-[15px] leading-snug text-pd-ink-600">Elegí el local y mirá el menú con lo que hay hoy.</p>

          <ElegirLocal locales={locales} />
        </main>
      </div>
    </>
  );
}
