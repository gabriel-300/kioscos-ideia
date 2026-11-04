import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { Panel } from "./_components/panel";

export const revalidate = 0;
export const metadata: Metadata = { title: "Facturación — Kioscos IDEIA" };

export type EmisorRow = { id: string; cuit: string; razon_social: string; ambiente: "homologacion" | "produccion"; activo: boolean };
export type SucursalArca = { id: string; nombre: string; arca_modo: "desactivado" | "digital"; arca_emisor_id: string | null; arca_punto_venta: number | null };
export type ComprobanteListado = {
  id: string; cbte_tipo: number; punto_venta: number; numero: number | null; fecha: string; imp_total: number;
  estado: "pendiente" | "emitido" | "error"; cae: string | null; error: string | null; origen: string; intentos: number;
  ambiente: string; created_at: string; sucursal: { nombre: string } | null;
};

export default async function FacturacionPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.app_metadata?.role !== "admin") redirect("/admin/dashboard");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = createAdminClient();
  const [emisores, sucursales, comprobantes] = await Promise.all([
    db.from("arca_emisores").select("id, cuit, razon_social, ambiente, activo").order("created_at"),
    db.from("sucursales").select("id, nombre, arca_modo, arca_emisor_id, arca_punto_venta").order("nombre"),
    db.from("comprobantes_arca")
      .select("id, cbte_tipo, punto_venta, numero, fecha, imp_total, estado, cae, error, origen, intentos, ambiente, created_at, sucursal:sucursales(nombre)")
      .order("created_at", { ascending: false }).limit(100),
  ]);

  // Sin la migración 132 la pantalla avisa en vez de romperse (mismo criterio que Tesorería).
  const falta = [emisores, sucursales, comprobantes].find((r) => r.error);
  if (falta) {
    return (
      <div className="max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        <p className="font-semibold">Falta aplicar la migración 132 (facturación ARCA).</p>
        <p className="mt-1">Ejecutá <code>supabase/migrations/132_facturacion_arca.sql</code> en el SQL Editor de Supabase y recargá. ({falta.error.message})</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Facturación electrónica (ARCA)</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Lo cobrado por medios digitales se factura solo (Factura B). El efectivo se factura a mano, desde el historial de la sucursal, cuando el cliente pide el comprobante.
        </p>
      </div>
      <Panel
        emisores={emisores.data as EmisorRow[]}
        sucursales={sucursales.data as SucursalArca[]}
        comprobantes={comprobantes.data as ComprobanteListado[]}
      />
    </div>
  );
}
