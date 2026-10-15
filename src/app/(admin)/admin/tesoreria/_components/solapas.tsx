import Link from "next/link";

// Barra de solapas de Tesorería. Es el único sector de la plata: las solapas de abajo son pantallas distintas (cada una con
// su ruta y sus filtros) pero todas muestran esta misma barra, así que desde cualquiera se pasa a las demás sin volver al menú.
// Cierres y Conciliación MP son solo de admin (sus páginas lo exigen); Informe mensual lo ven admin y socio, igual que Tesorería.

export type SolapaTesoreria =
  | "resumen" | "para-registrar" | "egresos" | "fijos" | "cierres" | "mercadopago" | "conciliacion" | "informe-mensual" | "historial";

const SOLAPAS: { id: SolapaTesoreria; etiqueta: string; href: string; soloAdmin?: boolean }[] = [
  { id: "resumen",         etiqueta: "Resumen",         href: "/admin/tesoreria?vista=resumen" },
  { id: "para-registrar",  etiqueta: "Para registrar",  href: "/admin/tesoreria?vista=para-registrar" },
  { id: "egresos",         etiqueta: "Egresos",         href: "/admin/tesoreria?vista=egresos" },
  { id: "fijos",           etiqueta: "Gastos fijos",    href: "/admin/tesoreria?vista=fijos" },
  { id: "cierres",         etiqueta: "Cierres de caja", href: "/admin/cierres", soloAdmin: true },
  { id: "mercadopago",     etiqueta: "Cobros MP",       href: "/admin/tesoreria?vista=mercadopago" },
  { id: "conciliacion",    etiqueta: "Conciliación MP", href: "/admin/conciliacion-mercadopago", soloAdmin: true },
  { id: "informe-mensual", etiqueta: "Informe mensual", href: "/admin/informe-mensual" },
  { id: "historial",       etiqueta: "Historial",       href: "/admin/tesoreria?vista=historial" },
];

export function SolapasTesoreria({
  activa, esAdmin, pendientes = 0, mes,
}: {
  activa:      SolapaTesoreria;
  esAdmin:     boolean;
  pendientes?: number;   // retiros de caja sin registrar (insignia en "Para registrar")
  mes?:        string;   // YYYY-MM: las solapas propias de Tesorería lo conservan
}) {
  return (
    <nav aria-label="Tesorería" className="flex flex-wrap gap-1.5 mb-6">
      {SOLAPAS.filter((s) => esAdmin || !s.soloAdmin).map((s) => {
        const propia = s.href.startsWith("/admin/tesoreria");
        const href   = propia && mes ? `${s.href}&mes=${mes}` : s.href;
        return (
          <Link key={s.id} href={href}
            aria-current={activa === s.id ? "page" : undefined}
            className={`px-3.5 py-2 text-sm whitespace-nowrap rounded-lg border transition-colors ${
              activa === s.id
                ? "border-tierra-700 bg-tierra-700 font-semibold text-white"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
            }`}>
            {s.etiqueta}
            {s.id === "para-registrar" && pendientes > 0 && (
              <span className="ml-2 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-800">{pendientes}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
