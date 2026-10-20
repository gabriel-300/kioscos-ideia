"use client";

import type { CategoriaCatalogo, ConfigTienda } from "./[sucursal]/_lib/tipos";
import { estadoHorario } from "@/lib/pedidos/horario";
import { StoreHeader } from "./[sucursal]/_components/store-header";
import { ProductCard } from "./[sucursal]/_components/producto-ui";

// El menú de un local, solo para mirar, que se ve detrás del diálogo "¿Dónde querés pedir?".
// No tiene carrito, buscador ni nada que se pueda tocar; no guarda nada en el navegador
// (la tienda real sí lo hace, por eso no se reutiliza entera).

const sinAccion = () => {};

export function FondoMenu({ config, catalogo }: { config: ConfigTienda; catalogo: CategoriaCatalogo[] }) {
  return (
    <div inert aria-hidden className="pointer-events-none fixed inset-0 select-none overflow-hidden">
      <StoreHeader config={config} horario={estadoHorario(config.horario, new Date())} />
      <div className="mx-auto max-w-[1100px] space-y-9 px-4 pt-6">
        {catalogo.slice(0, 2).map((c) => (
          <section key={c.id}>
            <h2 className="mb-3 text-[23px]">{c.name}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
              {c.items.slice(0, 8).map((item) => (
                <ProductCard key={item.id} item={item} qty={0} puedePedir={false} eager={false} onAdd={sinAccion} onDec={sinAccion} onOpen={sinAccion} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
