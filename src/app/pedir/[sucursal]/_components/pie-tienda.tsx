import type { ConfigTienda } from "../_lib/tipos";
import { LOGO_MARCA } from "../_lib/tema";

// Pie de la tienda: dónde estamos, el horario, una forma directa de consultar y las páginas legales
// (Google las pide enlazadas desde la página principal para verificar la marca).
export function PieTienda({ config, horarioHoy }: { config: ConfigTienda; horarioHoy: string | null }) {
  const direccion = [config.direccion, config.localidad].filter(Boolean).join(", ");
  const telefono = config.whatsapp?.replace(/\D/g, "");
  const consulta = telefono ? `https://wa.me/${telefono}?text=${encodeURIComponent("Hola, tengo una consulta sobre la tienda online.")}` : null;
  const vinculo = "underline";

  return (
    <footer className="mx-auto max-w-[1100px] px-4 pb-28 pt-6 text-center text-[13px] text-pd-ink-600">
      <div className="border-t border-pd-line pt-6">
        {LOGO_MARCA && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={LOGO_MARCA.srcOscuro} alt={LOGO_MARCA.alt} width={LOGO_MARCA.ancho} height={LOGO_MARCA.alto} className="mx-auto mb-3 h-[28px] w-auto opacity-80" />
        )}
        {direccion && <p>{direccion}</p>}
        {horarioHoy && <p className="mt-0.5">{horarioHoy}</p>}

        {consulta && (
          <a
            href={consulta}
            target="_blank"
            rel="noopener noreferrer"
            // Color en línea: la regla global `a { color: inherit }` le gana a las clases text-*.
            style={{ color: "var(--color-pd-ink)" }}
            className="pd-display mt-4 inline-flex h-11 items-center rounded-full border-[1.5px] border-pd-line-strong bg-white px-5 text-[14px] font-bold"
          >
            ¿Dudas? Escribinos por WhatsApp
          </a>
        )}

        <p className="mt-4 text-[12px] text-pd-ink-400">Pagos seguros con Mercado Pago</p>
        <p className="mt-1.5 flex items-center justify-center gap-3 text-[12px]">
          <a href="/privacidad" style={{ color: "var(--color-pd-ink-600)" }} className={vinculo}>Política de privacidad</a>
          <a href="/terminos" style={{ color: "var(--color-pd-ink-600)" }} className={vinculo}>Condiciones del servicio</a>
        </p>
      </div>
    </footer>
  );
}
