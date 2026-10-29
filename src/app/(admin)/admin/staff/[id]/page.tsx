import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/require-role";
import { permisosTesoreria } from "@/lib/tesoreria/permisos";
import { cargarFichaPersonal, cargarFiadoPersona, esTablaFichaFaltante } from "@/lib/personal/ficha-consultas";
import { cargarCuentaDePersona } from "@/lib/tesoreria/persona-cuenta-consultas";
import { FichaForm } from "../_components/ficha-form";
import { TarjetaPersona } from "../../tesoreria/_components/personas-view";

export const metadata: Metadata = { title: "Ficha del personal — Kioscos IDEIA" };
export const revalidate = 0;

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const ROLES: Record<string, string> = { admin: "Administrador", encargado: "Encargado", concesionario: "Concesionario", vendedor: "Vendedor", repartidor: "Repartidor" };

export default async function FichaPersonalPage({ params }: { params: Promise<{ id: string }> }) {
  // Trae sueldo, CUIL y CBU: como Staff, solo un administrador (el chequeo no depende solo del middleware).
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const admin = createAdminClient();
  const permisos = await permisosTesoreria();
  const [{ data: usuario }, { data: perfil }] = await Promise.all([
    admin.auth.admin.getUserById(id),
    admin.from("profiles").select("id, full_name, phone, document_type, document_number, es_socio, sucursal_id").eq("id", id).maybeSingle(),
  ]);
  if (!usuario?.user || !perfil) notFound();

  const nombre = perfil.full_name?.trim() || (usuario.user.user_metadata?.full_name as string | undefined) || usuario.user.email || "Sin nombre";
  const rol = ROLES[(usuario.user.app_metadata?.role as string) ?? ""] ?? "Sin rol";
  const sucursal = perfil.sucursal_id ? (await admin.from("sucursales").select("nombre").eq("id", perfil.sucursal_id).maybeSingle()).data?.nombre ?? null : null;

  let ficha = null, fichaError = "";
  try {
    ficha = await cargarFichaPersonal(admin, id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fichaError = esTablaFichaFaltante(msg) ? "Falta aplicar la migración 130 (carpeta supabase/migrations) en el SQL Editor de Supabase." : msg;
  }
  const [cuenta, fiado] = await Promise.all([cargarCuentaDePersona(admin, id), cargarFiadoPersona(admin, id)]);
  const debeAdelantos = cuenta ? Math.max(0, cuenta.cuenta.debe) : 0;
  const debeFiado = Math.max(0, fiado.saldo);

  return (
    <div className="p-4 md:p-8 max-w-5xl space-y-6">
      <div>
        <Link href="/admin/staff" className="text-xs font-semibold text-tierra-700 hover:underline">← Volver a Staff</Link>
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900 mt-2">{nombre}</h1>
        <p className="text-sm text-neutral-400 mt-0.5">
          {perfil.es_socio ? "Socio · " : ""}{rol}{sucursal ? ` · ${sucursal}` : ""}{usuario.user.email ? ` · ${usuario.user.email}` : ""}
          {perfil.phone ? ` · ${perfil.phone}` : ""}{perfil.document_number ? ` · ${perfil.document_type ?? "Doc."} ${perfil.document_number}` : ""}
        </p>
        <p className="text-xs text-neutral-400 mt-0.5">Nombre, teléfono, documento, rol y kiosco se editan en Staff → Editar.</p>
      </div>

      <section className="space-y-3" aria-label="Cuentas con la empresa">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">Debe a la empresa en total</p>
          <p className={`text-2xl font-bold font-display tabular-nums ${debeAdelantos + debeFiado > 0 ? "text-red-700" : "text-neutral-700"}`}>{AR.format(debeAdelantos + debeFiado)}</p>
          <ul className="text-xs text-neutral-500 mt-1 space-y-0.5">
            <li>Adelantos y retiros de plata (cuenta de Tesorería): <b>{AR.format(debeAdelantos)}</b></li>
            <li>
              Compras fiadas en los kioscos (Cta. Corriente): <b>{AR.format(debeFiado)}</b>
              {fiado.ventas > 0 && <> · {fiado.ventas} {fiado.ventas === 1 ? "venta" : "ventas"}, {AR.format(fiado.vendido)} comprado y {AR.format(fiado.pagado)} pagado</>}
            </li>
          </ul>
          <p className="text-xs text-neutral-400 mt-2">
            Son dos cuentas distintas que se suman acá. Hoy el descuento de sueldo se anota a mano en cada una; la liquidación automática del sueldo viene en la etapa siguiente.
          </p>
        </div>
        {cuenta ? (
          <TarjetaPersona persona={cuenta} puedeCargar={!!permisos?.puedeCargar} conFicha={false} />
        ) : (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">La cuenta de adelantos todavía no está lista: falta aplicar la migración 129.</p>
        )}
      </section>

      {fichaError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="font-semibold">La ficha del personal todavía no está lista en la base de datos.</p>
          <p className="mt-1">{fichaError}</p>
        </div>
      ) : ficha && (
        <>
          {!ficha.existe && <p className="text-sm text-neutral-500">Esta persona todavía no tiene la ficha completa. Cargá lo que tengas: todo es opcional.</p>}
          <FichaForm personaId={id} inicial={ficha.ficha} puedeCargar={!!permisos?.puedeCargar} />
        </>
      )}
    </div>
  );
}
