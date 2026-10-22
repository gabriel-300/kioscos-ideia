"use client";

import type { ConfigTienda, ItemCatalogo } from "../_lib/tipos";
import { fmt } from "../_lib/tema";

// El banner grande de la entrada: el producto destacado con su foto y un botón para pedirlo (como los
// banners de Rappi). Sin producto destacado muestra una bienvenida general con la foto de la marca.
export function BannerDestacado({ config, item, kicker, puedePedir, onPedir, onVerMenu }: {
  config:     ConfigTienda;
  item:       ItemCatalogo | null;
  kicker:     string;
  puedePedir: boolean;
  onPedir:    (id: string) => void;
  onVerMenu:  () => void;
}) {
  const imagen = item?.image ?? "/marca/fondo-cabecera.jpg";
  const eta = `${config.retiroEtaMin}–${config.retiroEtaMax} min`;

  return (
    <section
      aria-label={item ? `Destacado: ${item.name}` : "Bienvenida"}
      className="relative overflow-hidden rounded-3xl bg-pd-ink text-white"
      style={{
        backgroundImage: `linear-gradient(90deg, rgba(34,25,15,.90) 0%, rgba(34,25,15,.62) 52%, rgba(34,25,15,.10) 100%), url(${imagen})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
      data-testid="banner-destacado"
    >
      <div className="flex min-h-[210px] max-w-[540px] flex-col justify-center px-5 py-6 md:min-h-[270px] md:px-9 md:py-9">
        {item ? (
          <>
            <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-white/80">{kicker}</p>
            <h2 className="mt-1.5 text-[27px] leading-tight text-white [text-wrap:balance] md:text-[36px]">{item.name}</h2>
            <p className="pd-display mt-1.5 text-[21px] font-extrabold md:text-[24px]">
              {fmt(item.price)}{item.unit && <span className="ml-1.5 text-[13px] font-medium text-white/75">{item.unit}</span>}
            </p>
            {puedePedir && (
              <button
                type="button"
                onClick={() => onPedir(item.id)}
                className="pd-display mt-4 h-12 w-fit rounded-full bg-pd-ember px-7 text-[15.5px] font-bold text-white shadow-lg active:bg-pd-ember-dark"
              >
                Pedir ahora
              </button>
            )}
          </>
        ) : (
          <>
            <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-white/80">Pedí online</p>
            <h2 className="mt-1.5 text-[27px] leading-tight text-white [text-wrap:balance] md:text-[36px]">Sin filas: retirá en {eta}</h2>
            <p className="mt-1.5 text-[14.5px] text-white/85">Elegí del menú, pagá con Mercado Pago y listo.</p>
            <button
              type="button"
              onClick={onVerMenu}
              className="pd-display mt-4 h-12 w-fit rounded-full bg-pd-ember px-7 text-[15.5px] font-bold text-white shadow-lg active:bg-pd-ember-dark"
            >
              Ver el menú
            </button>
          </>
        )}
      </div>
    </section>
  );
}
