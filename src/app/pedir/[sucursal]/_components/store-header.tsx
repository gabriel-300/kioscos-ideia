import type { ConfigTienda } from "../_lib/tipos";
import { lineasLogo, LOGO_MARCA } from "../_lib/tema";
import type { EstadoHorario } from "@/lib/pedidos/horario";
import { BotonCuenta } from "./boton-cuenta";

// Cabecera del local: foto de fondo, logo de la marca, el local y chips de estado/horario/envío. Es
// baja a propósito: lo que vende es el menú, y tiene que empezar lo antes posible.
export function StoreHeader({ config, horario }: { config: ConfigTienda; horario: EstadoHorario }) {
  const lineas = lineasLogo(config.nombre);
  const direccion = [config.direccion, config.localidad].filter(Boolean).join(", ");
  const enviosDisponibles = config.deliveryHabilitado && config.zonas.length > 0;

  // Con el logo de la marca arriba, el nombre no repite "Angiru Food": queda "Costanera".
  const nombreLocal = LOGO_MARCA && /^angiru food\s+\S/i.test(config.nombre.trim()) ? config.nombre.trim().replace(/^angiru food\s+/i, "") : config.nombre;

  const chip = "inline-flex items-center rounded-full px-3 py-1.5 text-[12.5px] font-bold text-pd-cream bg-white/10 whitespace-nowrap";

  return (
    <header className="relative overflow-hidden bg-pd-ink text-pd-cream px-4 pt-5 pb-5"
      style={{
        backgroundImage:
          "linear-gradient(90deg, rgba(34,25,15,.92) 0%, rgba(34,25,15,.78) 45%, rgba(34,25,15,.50) 100%), url(/marca/fondo-cabecera.jpg)",
        backgroundSize: "cover",
        backgroundPosition: "center 40%",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-20 size-72 rounded-full"
        style={{ background: "radial-gradient(circle at 40% 40%, rgba(217,63,30,.35), rgba(217,63,30,0) 68%)" }}
      />
      <div className="relative mx-auto max-w-[1100px]">
      <BotonCuenta config={config} />
      <div className={LOGO_MARCA ? "relative" : "relative flex items-start gap-3.5"}>
        {LOGO_MARCA ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={LOGO_MARCA.src} alt={LOGO_MARCA.alt} width={LOGO_MARCA.ancho} height={LOGO_MARCA.alto} className="mb-2.5 h-[46px] w-auto" />
        ) : (
          <div
            className="shrink-0 size-16 rounded-[18px] flex flex-col items-center justify-center text-center text-white leading-[1.05] pd-display font-extrabold text-[11px] tracking-[0.02em] shadow-lg"
            style={{ background: "linear-gradient(145deg, #E8552F, #C2381A)" }}
            aria-hidden
          >
            {lineas.map((l, i) => <span key={i}>{l}</span>)}
          </div>
        )}
        <div className="min-w-0 pt-0.5">
          <h1 className="text-[24px] text-pd-paper break-words">{nombreLocal}</h1>
          {direccion && <p className="mt-1 text-[13px] text-pd-cream/80">{direccion}</p>}
        </div>
      </div>

      <div className="relative mt-4 flex flex-wrap gap-2">
        <span className={`${chip} ${horario.abierto ? "!bg-pd-success" : "!bg-pd-warn-2/45 !text-pd-warn-ink"}`}>
          {horario.abierto ? "Abierto ahora" : "Cerrado ahora"}
        </span>
        {horario.hoyTexto && <span className={chip}>{horario.hoyTexto}</span>}
        {enviosDisponibles && <span className={chip}>Envío a domicilio</span>}
        {!enviosDisponibles && config.retiroHabilitado && <span className={chip}>Retiro en el local</span>}
      </div>
      </div>
    </header>
  );
}

export function ClosedBanner({ proxima }: { proxima: string | null }) {
  return (
    <div className="bg-pd-warn text-pd-warn-ink px-4 py-3 text-[13px] leading-snug">
      <div className="mx-auto flex max-w-[1100px] items-start gap-2.5">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#F0A03C]" />
        <p>Ahora cerrado. Podés armar el pedido y lo preparamos al abrir{proxima ? `, ${proxima}` : ""}.</p>
      </div>
    </div>
  );
}
