import type { ConfigTienda } from "../_lib/tipos";
import { fmt, lineasLogo } from "../_lib/tema";
import type { EstadoHorario } from "@/lib/pedidos/horario";

// Cabecera del local: fondo brand-ink con halo ember, logo generado a partir
// del nombre de la sucursal (no hace falta subir imágenes -- funciona igual
// para todas las sucursales), y chips de estado/horario/envío.
export function StoreHeader({ config, horario }: { config: ConfigTienda; horario: EstadoHorario }) {
  const lineas = lineasLogo(config.nombre);
  const direccion = [config.direccion, config.localidad].filter(Boolean).join(", ");
  const enviosDisponibles = config.deliveryHabilitado && config.zonas.length > 0;
  const desde = enviosDisponibles ? Math.min(...config.zonas.map((z) => z.costo)) : null;

  const chip = "inline-flex items-center rounded-full px-3 py-1.5 text-[12.5px] font-bold text-pd-cream bg-white/10 whitespace-nowrap";

  return (
    <header className="relative overflow-hidden bg-pd-ink text-pd-cream px-4 pt-14 pb-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full"
        style={{ background: "radial-gradient(circle at 40% 40%, rgba(217,63,30,.75), rgba(217,63,30,0) 68%)" }}
      />
      <div className="relative flex items-start gap-3.5">
        <div
          className="shrink-0 size-16 rounded-[18px] flex flex-col items-center justify-center text-center text-white leading-[1.05] pd-display font-extrabold text-[11px] tracking-[0.02em] shadow-lg"
          style={{ background: "linear-gradient(145deg, #E8552F, #C2381A)" }}
          aria-hidden
        >
          {lineas.map((l, i) => <span key={i}>{l}</span>)}
        </div>
        <div className="min-w-0 pt-0.5">
          <h1 className="text-[27px] text-pd-paper break-words">{config.nombre}</h1>
          {direccion && <p className="mt-1.5 text-[13px] text-pd-cream/75">{direccion}</p>}
        </div>
      </div>

      <div className="relative mt-4 flex flex-wrap gap-2">
        <span className={`${chip} ${horario.abierto ? "!bg-pd-success" : "!bg-pd-warn-2/45 !text-pd-warn-ink"}`}>
          {horario.abierto ? "Abierto ahora" : "Cerrado ahora"}
        </span>
        {horario.hoyTexto && <span className={chip}>{horario.hoyTexto}</span>}
        {desde != null && <span className={chip}>Envío desde {fmt(desde)}</span>}
        {!enviosDisponibles && config.retiroHabilitado && <span className={chip}>Retiro en el local</span>}
      </div>
    </header>
  );
}

export function ClosedBanner({ proxima }: { proxima: string | null }) {
  return (
    <div className="flex items-start gap-2.5 bg-pd-warn text-pd-warn-ink px-4 py-3 text-[13px] leading-snug">
      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#F0A03C]" />
      <p>Ahora cerrado. Podés armar el pedido y lo preparamos al abrir{proxima ? `, ${proxima}` : ""}.</p>
    </div>
  );
}
