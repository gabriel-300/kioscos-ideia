import Link from "next/link";

// Vista de solo lectura para un vendedor habilitado en más de una sucursal
// (profile_sucursales) -- a diferencia de SucursalesList (admin), acá no
// hay buscador ni botones de crear/editar/activar: es solo "elegí dónde
// vas a trabajar hoy", se entra y se abre el turno desde adentro.
export function SucursalesPickerList({ sucursales }: { sucursales: { id: string; nombre: string }[] }) {
  if (sucursales.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-10 text-center">
        <p className="text-sm text-neutral-400">No tenés ninguna sucursal asignada todavía — pedile a un administrador que te agregue una desde Staff.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {sucursales.map((s) => (
        <Link
          key={s.id}
          href={`/admin/sucursales/${s.id}`}
          className="rounded-xl border border-neutral-200 bg-white p-5 hover:border-tierra-300 hover:bg-tierra-50/40 transition-colors flex items-center justify-between gap-3"
        >
          <span className="font-semibold text-neutral-900">{s.nombre}</span>
          <svg className="size-4 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </Link>
      ))}
    </div>
  );
}
