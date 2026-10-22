import type { ConfigTienda } from "../_lib/tipos";
import { lineasLogo, LOGO_MARCA } from "../_lib/tema";
import type { EstadoHorario } from "@/lib/pedidos/horario";
import { BotonCuenta } from "./boton-cuenta";

// Barra de arriba, clara y baja (como las apps de pedidos): logo de la marca, el ingreso, y debajo el
// local con sus datos. La foto grande de comida va aparte, en el banner (banner-destacado.tsx).
export function StoreHeader({ config, horario }: { config: ConfigTienda; horario: EstadoHorario }) {
  const lineas = lineasLogo(config.nombre);
  const direccion = [config.direccion, config.localidad].filter(Boolean).join(", ");
  const enviosDisponibles = config.deliveryHabilitado && config.zonas.length > 0;

  // Con el logo de la marca arriba, el nombre no repite "Angiru Food": queda "Costanera".
  const nombreLocal = LOGO_MARCA && /^angiru food\s+\S/i.test(config.nombre.trim()) ? config.nombre.trim().replace(/^angiru food\s+/i, "") : config.nombre;

  const chip = "inline-flex items-center rounded-full bg-pd-warm px-3 py-1 text-[12.5px] font-semibold text-pd-ink-900 whitespace-nowrap";

  return (
    <header className="bg-pd-paper px-4 pb-3 pt-4">
      <div className="mx-auto max-w-[1100px]">
        <div className="flex items-center justify-between gap-3">
          {LOGO_MARCA ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={LOGO_MARCA.srcOscuro} alt={LOGO_MARCA.alt} width={LOGO_MARCA.ancho} height={LOGO_MARCA.alto} className="h-[40px] w-auto" />
          ) : (
            <div
              className="shrink-0 size-12 rounded-[14px] flex flex-col items-center justify-center text-center text-white leading-[1.05] pd-display font-extrabold text-[9px] tracking-[0.02em]"
              style={{ background: "linear-gradient(145deg, #E8552F, #C2381A)" }}
              aria-hidden
            >
              {lineas.map((l, i) => <span key={i}>{l}</span>)}
            </div>
          )}
          <BotonCuenta config={config} />
        </div>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h1 className="text-[21px] text-pd-ink-900 break-words">{nombreLocal}</h1>
          {direccion && <p className="text-[13px] text-pd-ink-600">{direccion}</p>}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-2">
          <span className={`${chip} ${horario.abierto ? "!bg-pd-success !text-white" : "!bg-pd-warn !text-pd-warn-ink"}`}>
            {horario.abierto ? "Abierto ahora" : "Cerrado ahora"}
          </span>
          {horario.hoyTexto && <span className={chip}>{horario.hoyTexto}</span>}
          {enviosDisponibles && <span className={chip}>Envío a domicilio</span>}
          {!enviosDisponibles && config.retiroHabilitado && <span className={chip}>Retiro en el local</span>}
          {config.retiroHabilitado && config.habilitado && <span className={chip}>Retiro en {config.retiroEtaMin}–{config.retiroEtaMax} min</span>}
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
