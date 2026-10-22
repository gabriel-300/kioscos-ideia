"use client";

import type { ConfigTienda, ItemCatalogo } from "../_lib/tipos";
import { fmt } from "../_lib/tema";
import { precioPor100g } from "@/lib/pedidos/cantidad-peso";

// El banner grande de la entrada: el producto destacado, con su foto ENTERA a un costado y un botón para
// pedirlo (como los banners de Rappi). La foto va en un cuadro propio, no de fondo: así no se recorta ni se
// ve ampliada (las fotos de producto son casi cuadradas y el banner es ancho y bajo).
// Sin producto destacado muestra una bienvenida general sobre la foto de la marca, que sí es ancha.
export function BannerDestacado({ config, item, kicker, puedePedir, onPedir, onVerMenu, compacto = false }: {
  config:     ConfigTienda;
  item:       ItemCatalogo | null;
  kicker:     string;
  puedePedir: boolean;
  onPedir:    (id: string) => void;
  onVerMenu:  () => void;
  compacto?:  boolean; // varios banners a la vez: más bajos y con letra más chica
}) {
  const boton = "pd-display mt-4 h-11 w-fit rounded-full bg-pd-ember px-5 text-[14.5px] font-bold text-white shadow-lg active:bg-pd-ember-dark md:h-12 md:px-7 md:text-[15.5px]";
  const titulo = compacto ? "text-[19px] md:text-[25px]" : "text-[22px] md:text-[34px]";

  if (item) {
    const foto = compacto ? "size-[128px] sm:size-[168px] md:size-[200px]" : "size-[150px] sm:size-[190px] md:size-[240px]";
    const alto = compacto ? "min-h-[180px] md:min-h-[236px]" : "min-h-[190px] md:min-h-[264px]";
    return (
      <section
        aria-label={`Destacado: ${item.name}`}
        className={`group/banner relative flex items-center overflow-hidden rounded-3xl text-white ${alto}`}
        style={{ background: "linear-gradient(105deg, #22190F 0%, #3A2616 58%, #8A3216 100%)" }}
        data-testid="banner-destacado"
      >
        <div className="relative z-10 flex min-w-0 flex-1 flex-col justify-center py-5 pl-5 pr-2 md:pl-8">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-white/75">{kicker}</p>
          <h2 className={`mt-1.5 leading-tight text-white [text-wrap:balance] ${titulo}`}>{item.name}</h2>
          <p className="pd-display mt-1.5 text-[18px] font-extrabold md:text-[22px]">
            {item.unit
              ? <>{fmt(precioPor100g(item.price))}<span className="ml-1.5 text-[12.5px] font-medium text-white/75">cada 100 g</span></>
              : fmt(item.price)}
          </p>
          {puedePedir && (
            <button type="button" onClick={() => onPedir(item.id)} className={boton}>Pedir ahora</button>
          )}
        </div>
        <div className={`relative m-3 shrink-0 overflow-hidden rounded-2xl bg-white ${foto}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.image ?? ""}
            alt={item.name}
            className="size-full object-cover transition-transform duration-700 ease-out motion-safe:group-hover/banner:scale-105"
          />
        </div>
      </section>
    );
  }

  const eta = `${config.retiroEtaMin}–${config.retiroEtaMax} min`;
  return (
    <section
      aria-label="Bienvenida"
      className="group/banner relative overflow-hidden rounded-3xl bg-pd-ink text-white"
      data-testid="banner-destacado"
    >
      <div
        aria-hidden
        className="absolute inset-0 transition-transform duration-700 ease-out motion-safe:group-hover/banner:scale-[1.05]"
        style={{
          backgroundImage: "linear-gradient(90deg, rgba(34,25,15,.90) 0%, rgba(34,25,15,.62) 52%, rgba(34,25,15,.10) 100%), url(/marca/fondo-cabecera.jpg)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="relative flex min-h-[210px] max-w-[540px] flex-col justify-center px-5 py-6 md:min-h-[270px] md:px-9 md:py-9">
        <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-white/80">Pedí online</p>
        <h2 className={`mt-1.5 leading-tight text-white [text-wrap:balance] ${titulo}`}>Sin filas: retirá en {eta}</h2>
        <p className="mt-1.5 text-[14.5px] text-white/85">Elegí del menú, pagá con Mercado Pago y listo.</p>
        <button type="button" onClick={onVerMenu} className={boton}>Ver el menú</button>
      </div>
    </section>
  );
}
