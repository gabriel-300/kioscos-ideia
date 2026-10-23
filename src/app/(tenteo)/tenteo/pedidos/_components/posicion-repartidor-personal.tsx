import { createAdminClient } from "@/lib/supabase/server";
import { posicionParaPersonal } from "@/lib/pedidos/posicion-servidor";
import { textoHace } from "@/lib/pedidos/posicion-repartidor";
import { urlMapa } from "@/lib/pedidos/ubicacion";

// Última posición del repartidor de un pedido en reparto, con enlace al mapa. Componente de servidor: se
// monta solo dentro de las tarjetas de /tenteo/pedidos, que ya vienen filtradas por las sucursales de quien mira.
export async function PosicionRepartidorPersonal({ pedidoId }: { pedidoId: string }) {
  const pos = await posicionParaPersonal(createAdminClient(), pedidoId);
  if (!pos) return <p className="mt-2 text-xs text-neutral-400">El repartidor no está compartiendo su ubicación.</p>;
  return (
    <p className="mt-2 text-xs text-neutral-600">
      🛵 Última ubicación del repartidor {textoHace(pos.haceSeg)}{pos.vieja ? " (señal vieja)" : ""} ·{" "}
      <a href={urlMapa(pos.lat, pos.lng)} target="_blank" rel="noopener noreferrer" style={{ color: "#1d4ed8" }} className="font-semibold underline">
        Ver en el mapa
      </a>
    </p>
  );
}
