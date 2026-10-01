import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { esPersonal, sistemasDe } from "@/lib/auth/acceso";

export const metadata: Metadata = { title: "Elegir sistema — Kioscos IDEIA" };

// Quien tiene los dos sistemas elige adónde entrar. /auth/sistema guarda la
// elección para no preguntar la próxima vez (en los menús hay un enlace para cambiar).
export default async function ElegirSistemaPage() {
  const user = await getUser();
  if (!user || !esPersonal(user)) redirect("/login");
  // Con un solo sistema no hay nada que elegir.
  if (sistemasDe(user).length < 2) redirect("/auth/redirect");

  const opciones = [
    { ir: "kiosco", titulo: "Kiosco", detalle: "Venta, caja, stock, informes y tesorería" },
    { ir: "tenteo", titulo: "Tenteo", detalle: "Pedidos online, WhatsApp y entregas" },
  ];

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <h1 className="font-display text-2xl font-semibold text-neutral-900">¿Adónde querés entrar?</h1>
        <p className="text-sm text-neutral-500 mt-1">Después podés cambiar desde el menú.</p>
      </div>
      <div className="flex flex-col gap-3">
        {opciones.map((o) => (
          // <a> y no <Link>: es una ruta que guarda la elección, no debe precargarse.
          <a
            key={o.ir}
            href={`/auth/sistema?ir=${o.ir}`}
            className="bg-white rounded-2xl border border-neutral-200 p-5 hover:border-tierra-700 transition-colors"
          >
            <p className="font-display text-lg font-semibold text-neutral-900">{o.titulo}</p>
            <p className="text-sm text-neutral-500 mt-0.5">{o.detalle}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
