import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { cargarLocalesParaPedir } from "@/lib/pedidos/locales";
import { ElegirLocal } from "./elegir-local";

// "¿Dónde querés pedir?": cada local tiene su propio catálogo, stock y precios, así
// que quien llega sin un local elegido (la raíz del dominio de clientes) lo elige acá.
// Si hay un solo local habilitado no hay nada que elegir y va directo.
// Este Server Component solo carga los datos; la lista, el orden por cercanía (GPS, en el
// navegador del cliente) y el atajo al último local viven en ElegirLocal.

export const revalidate = 0;
export const metadata: Metadata = { title: "Pedí online" };

export default async function ElegirLocalPage() {
  const locales = await cargarLocalesParaPedir(createAdminClient());
  if (locales.length === 1) redirect(`/pedir/${locales[0].id}`);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-10 pt-12">
      <h1 className="text-[32px] leading-tight">¿Dónde querés pedir?</h1>
      <p className="mt-2 text-[15px] leading-snug text-pd-ink-600">Elegí el local y mirá el menú con lo que hay hoy.</p>

      <ElegirLocal locales={locales} />
    </main>
  );
}
