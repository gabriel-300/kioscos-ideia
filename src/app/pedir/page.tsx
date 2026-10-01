import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { cargarLocalesParaPedir } from "@/lib/pedidos/locales";

// "¿Dónde querés pedir?": cada local tiene su propio catálogo, stock y precios, así
// que quien llega sin un local elegido (la raíz del dominio de clientes) lo elige acá.
// Si hay un solo local habilitado no hay nada que elegir y va directo.

export const revalidate = 0;
export const metadata: Metadata = { title: "Pedí online" };

export default async function ElegirLocalPage() {
  const locales = await cargarLocalesParaPedir(createAdminClient());
  if (locales.length === 1) redirect(`/pedir/${locales[0].id}`);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-10 pt-12">
      <h1 className="text-[32px] leading-tight">¿Dónde querés pedir?</h1>
      <p className="mt-2 text-[15px] leading-snug text-pd-ink-600">Elegí el local y mirá el menú con lo que hay hoy.</p>

      {locales.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-pd-line bg-white p-5 text-[14.5px] text-pd-ink-600">
          Por ahora no hay locales recibiendo pedidos online. Volvé a probar más tarde.
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {locales.map((l) => (
            <li key={l.id}>
              <Link
                href={`/pedir/${l.id}`}
                className="block rounded-2xl border border-pd-line bg-white p-5 transition-colors active:bg-pd-tint"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="pd-display text-[19px] font-bold leading-tight">{l.nombre}</p>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold ${l.abierto ? "bg-pd-success/10 text-pd-success" : "bg-pd-warm text-pd-ink-600"}`}>
                    {l.abierto ? "Abierto" : "Cerrado"}
                  </span>
                </div>
                {(l.direccion || l.localidad) && (
                  <p className="mt-1 text-[13.5px] text-pd-ink-600">{[l.direccion, l.localidad].filter(Boolean).join(", ")}</p>
                )}
                <p className="mt-3 text-[13px] text-pd-ink-400">
                  {[l.conRetiro && "Retiro en el local", l.conEnvio && "Envío a domicilio"].filter(Boolean).join(" · ")}
                  {!l.abierto && l.proximaApertura ? ` · Abre ${l.proximaApertura}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
