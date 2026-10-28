import Link from "next/link";
import { LOGO_MARCA } from "../[sucursal]/_lib/tema";
import { estadoHorario } from "@/lib/pedidos/horario";
import { INSTAGRAM, nombreLimpio } from "@/lib/pedidos/seo";
import type { LocalProximo, LocalSeo } from "@/lib/pedidos/seo-servidor";
import { PedidoEnCurso } from "./pedido-en-curso";
import { TarjetasLocales, type TarjetaLocal } from "./tarjetas-locales";

// Portada de Angiru Food (la raíz del sitio): le dice a Google y a quien llega qué es esto, muestra los locales donde
// se puede pedir (uno o varios; con varios se pueden ordenar por cercanía) y los que abren pronto, y lleva a pedir.

// Dorado del título de la portada (sobre la foto oscura).
const DORADO = "#E3B04B";

// Texto principal de la portada. El título que ve Google (<title> y descripción) sigue nombrando Posadas y los rubros.
const BAJADA = "Cafetería, panadería y confitería con identidad propia. Chipas gourmet, empanadas de especialidad y productos a base de mandioca.";

const CLASE_BOTON = "pd-display inline-flex h-14 items-center justify-center rounded-2xl bg-pd-ember px-8 text-[16px] font-bold active:bg-pd-ember-dark";

const PASOS = [
  { titulo: "Elegí lo que querés", texto: "Mirá el menú con lo que hay hoy: bocaditos, chipas, pizzas, empanadas y más." },
  { titulo: "Pagá como prefieras", texto: "Con Mercado Pago, o en efectivo si ingresás con tu cuenta de Google." },
  { titulo: "Retirá o recibilo", texto: "Pasá por el local o pedí el envío a domicilio. Seguís tu pedido paso a paso." },
];

export function Portada({ locales, proximos = [] }: { locales: LocalSeo[]; proximos?: LocalProximo[] }) {
  const tarjetas: TarjetaLocal[] = locales.map((l) => {
    const h = estadoHorario(l.horario);
    return { id: l.id, slug: l.slug, nombre: l.nombre, direccion: l.direccion, localidad: l.localidad, latitud: l.latitud, longitud: l.longitud, abierto: h.abierto, hoyTexto: h.hoyTexto };
  });
  const primero = locales[0];
  const titulo = locales.length + proximos.length > 1 ? "Nuestros locales" : "Nuestro local";

  return (
    <div className="min-h-screen bg-pd-paper text-pd-ink">
      <header className="border-b border-pd-line bg-white">
        <div className="mx-auto flex max-w-[1000px] items-center justify-between gap-3 px-4 py-3">
          {LOGO_MARCA && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={LOGO_MARCA.srcOscuro} alt={LOGO_MARCA.alt} width={LOGO_MARCA.ancho} height={LOGO_MARCA.alto} className="h-[36px] w-auto" />
          )}
          <Link href={`/pedir/${primero.id}/mis-pedidos`} style={{ color: "var(--color-pd-ink)" }} className="pd-display inline-flex h-10 items-center rounded-full border border-pd-line-strong bg-white px-4 text-[13px] font-bold">
            Mis pedidos
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1000px] px-4 pb-14 pt-6 md:pt-10">
        <PedidoEnCurso className="mb-5" />

        <section className="overflow-hidden rounded-3xl bg-pd-ink text-white" style={{ backgroundImage: "linear-gradient(rgba(34,25,15,.62), rgba(34,25,15,.72)), url(/marca/fondo-cabecera.jpg)", backgroundSize: "cover", backgroundPosition: "center" }}>
          <div className="px-6 py-12 text-center md:px-12 md:py-20">
            <h1 className="mx-auto max-w-[640px] text-[34px] leading-[1.1] text-white md:text-[48px]">Delicias con <span className="whitespace-nowrap" style={{ color: DORADO }}>sabor regional</span></h1>
            <p className="mx-auto mt-4 max-w-[560px] text-[16px] leading-snug text-white/90 md:text-[18px]">{BAJADA}</p>
            <Link href={locales.length === 1 ? `/${primero.slug}` : "#locales"} style={{ color: "#fff" }} className={`${CLASE_BOTON} mt-8`}>Pedir online</Link>
          </div>
        </section>

        <section id="locales" aria-labelledby="titulo-local" className="mt-8 scroll-mt-4">
          <h2 id="titulo-local" className="text-[24px]">{titulo}</h2>
          <TarjetasLocales locales={tarjetas} />
          {proximos.map((p) => {
            const h = estadoHorario(p.horario);
            return (
              <div key={p.nombre} className="mt-3 rounded-3xl border border-pd-line bg-white p-5 md:flex md:items-center md:justify-between md:gap-6 md:p-7">
                <div>
                  <p className="pd-display text-[20px] font-bold">{nombreLimpio(p.nombre)}</p>
                  {(p.direccion || p.localidad) && (
                    <p className="mt-1 text-[14.5px] text-pd-ink-600">{[p.direccion?.trim(), p.localidad?.trim() || "Posadas"].filter(Boolean).join(", ")}</p>
                  )}
                  {p.horario && (
                    <div className="mt-3 flex flex-wrap gap-2 text-[12.5px] font-semibold">
                      <span className={`rounded-full px-3 py-1 ${h.abierto ? "bg-pd-success text-white" : "bg-pd-warm text-pd-ink-900"}`}>{h.abierto ? "Abierto ahora" : "Cerrado ahora"}</span>
                      {h.hoyTexto && <span className="rounded-full bg-pd-warm px-3 py-1 text-pd-ink-900">{h.hoyTexto}</span>}
                    </div>
                  )}
                </div>
                <span className="pd-display mt-4 inline-flex h-11 items-center rounded-full border border-pd-line-strong bg-pd-paper px-5 text-[13px] font-bold text-pd-ink-600 md:mt-0 md:shrink-0">Pedidos online: próximamente</span>
              </div>
            );
          })}
        </section>

        <section aria-labelledby="titulo-como" className="mt-10">
          <h2 id="titulo-como" className="text-[24px]">Cómo pedir</h2>
          <ol className="mt-3 grid gap-3 md:grid-cols-3">
            {PASOS.map((p, i) => (
              <li key={p.titulo} className="rounded-3xl border border-pd-line bg-white p-5">
                <span className="pd-display flex size-9 items-center justify-center rounded-full bg-pd-ember text-[15px] font-bold text-white">{i + 1}</span>
                <p className="pd-display mt-3 text-[17px] font-bold">{p.titulo}</p>
                <p className="mt-1 text-[14px] leading-snug text-pd-ink-600">{p.texto}</p>
              </li>
            ))}
          </ol>
        </section>

        <footer className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-pd-line pt-6 text-[13.5px] text-pd-ink-600">
          <a href={INSTAGRAM} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Instagram @angirufood</a>
          <Link href="/terminos" className="underline">Condiciones del servicio</Link>
          <Link href="/privacidad" className="underline">Privacidad</Link>
        </footer>
      </main>
    </div>
  );
}
