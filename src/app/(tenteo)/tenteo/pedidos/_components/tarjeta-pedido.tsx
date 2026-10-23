import type { LineaPedido } from "@/lib/pedidos/lineas";
import { MINUTOS_DEMORADO, haceTiempo, type GrupoPedido } from "@/lib/pedidos/presentacion";
import { pesos } from "@/lib/pedidos/aviso";
import { urlMapa } from "@/lib/pedidos/ubicacion";
import { ChatPedido } from "@/components/chat-pedido";
import { cargarChatLocal, enviarChatLocal } from "../chat-actions";
import { PedidoOnlineAcciones } from "./pedido-online-acciones";

// Un pedido online del personal, como tarjeta: lo más importante (qué pidió el cliente
// y el botón de la siguiente acción) arriba y grande; el detalle, chico.

const ESTADO_LABEL: Record<string, string> = {
  pendiente_pago: "Esperando pago",
  confirmado:     "Nuevo · cobra en la puerta",
  pagado:         "Pagado",
  en_preparacion: "En preparación",
  listo_retiro:   "Listo para retirar",
  en_reparto:     "En reparto",
  entregado:      "Entregado",
};

const MEDIO_LABEL: Record<string, string> = {
  efectivo:         "Efectivo",
  mercadopago_link: "Mercado Pago (link)",
  mercadopago_qr:   "Mercado Pago (QR)",
};

// Borde de color según urgencia.
const BORDE: Record<GrupoPedido, string> = {
  atender:    "border-l-amber-500",
  preparando: "border-l-sky-500",
  listos:     "border-l-emerald-500",
  entregados: "border-l-neutral-300",
};

function Chip({ children, tono = "neutro" }: { children: React.ReactNode; tono?: "neutro" | "aviso" | "ok" }) {
  const clases = {
    neutro: "bg-neutral-100 text-neutral-700",
    aviso:  "bg-amber-100 text-amber-900",
    ok:     "bg-emerald-100 text-emerald-800",
  }[tono];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${clases}`}>{children}</span>;
}

export type PedidoTarjeta = {
  id: string; numero: number | null; origen: string; estado: string; tipo_entrega: string;
  cliente_nombre: string | null; cliente_telefono: string | null;
  direccion_entrega: string | null; direccion_referencia: string | null; zona_nombre: string | null;
  entrega_latitud?: number | string | null; entrega_longitud?: number | string | null; // migración 118
  costo_envio: number | null; medio_pago: string | null; pago_con: number | null; notas: string | null;
  eta_min: number | null; eta_max: number | null; total: number; repartidor_id: string | null;
  movimiento_id: string | null; created_at: string; expira_en: string | null; sucursales?: { nombre: string } | null;
};

export function TarjetaPedido({ pedido: p, grupo, lineas, repartidores, puedeConfirmarPago, mensajesSinLeer = 0 }: {
  pedido:             PedidoTarjeta;
  grupo:              GrupoPedido;
  lineas:             LineaPedido[];
  repartidores:       { id: string; nombre: string }[];
  puedeConfirmarPago: boolean;
  mensajesSinLeer?:   number;
}) {
  const delivery = p.tipo_entrega === "delivery";
  const espera = haceTiempo(p.created_at);
  const demorado = grupo === "atender" && espera.minutos >= MINUTOS_DEMORADO;
  const esperandoPago = p.estado === "pendiente_pago";

  return (
    <article className={`flex flex-col overflow-hidden rounded-xl border border-neutral-200 border-l-4 bg-white shadow-sm ${BORDE[grupo]}`}>
      <div className="flex-1 px-4 pt-3.5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-neutral-900">
              {p.numero ? <span className="font-normal text-neutral-400">#{p.numero} </span> : null}
              {p.cliente_nombre ?? "Sin nombre"}
            </p>
            {p.cliente_telefono && <p className="text-xs text-neutral-500">{p.cliente_telefono}</p>}
          </div>
          <p className={`shrink-0 text-xs ${demorado ? "font-bold text-red-600" : "text-neutral-400"}`}>
            {demorado ? `⏱ ${espera.texto}` : espera.texto}
          </p>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip tono={grupo === "atender" ? "aviso" : "neutro"}>{ESTADO_LABEL[p.estado] ?? p.estado}</Chip>
          <Chip>{delivery ? `Envío${p.zona_nombre ? ` · ${p.zona_nombre}` : ""}` : "Retiro en el local"}</Chip>
          <Chip tono={esperandoPago ? "aviso" : "neutro"}>{MEDIO_LABEL[p.medio_pago ?? ""] ?? "Pago sin definir"}</Chip>
          {p.sucursales?.nombre && <Chip>{p.sucursales.nombre}</Chip>}
          {p.origen === "whatsapp" && <Chip tono="ok">WhatsApp</Chip>}
        </div>

        <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Pidió</p>
        {lineas.length === 0 ? (
          <p className="mt-0.5 text-sm text-neutral-400">Sin detalle cargado</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {lineas.map((l, i) => (
              <li key={i} className="text-[15px] font-medium leading-snug text-neutral-900">
                {l.titulo}
                {l.componentes.length > 0 && (
                  <span className="block text-xs font-normal text-neutral-500">{l.componentes.join(" · ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {p.notas && (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
            Aclaración: “{p.notas}”
          </p>
        )}

        {delivery && (
          <div className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
            <p className="font-medium">{p.direccion_entrega ?? "Sin dirección"}</p>
            {p.direccion_referencia && <p className="text-xs text-neutral-500">{p.direccion_referencia}</p>}
            {p.entrega_latitud != null && p.entrega_longitud != null && (
              <a
                href={urlMapa(Number(p.entrega_latitud), Number(p.entrega_longitud))}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#1d4ed8" }}
                className="mt-1 inline-block text-xs font-semibold underline"
              >
                📍 Abrir en el mapa
              </a>
            )}
            {Number(p.costo_envio) > 0 && <p className="text-xs text-neutral-500">Envío {pesos(Number(p.costo_envio))}</p>}
          </div>
        )}
      </div>

      <ChatPedido pedidoId={p.id} cargar={cargarChatLocal} enviar={enviarChatLocal} estilo="panel" desplegable sinLeerInicial={mensajesSinLeer} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 bg-neutral-50/70 px-4 py-2.5">
        <div>
          <p className="text-lg font-bold leading-tight tabular-nums text-neutral-900">{pesos(p.total)}</p>
          {p.medio_pago === "efectivo" && p.pago_con ? (
            <p className="text-xs text-neutral-500">Paga con {pesos(Number(p.pago_con))}</p>
          ) : p.eta_min != null ? (
            <p className="text-xs text-neutral-400">{p.eta_min}–{p.eta_max} min</p>
          ) : null}
        </div>
        <PedidoOnlineAcciones
          pedidoId={p.id}
          estado={p.estado}
          tipoEntrega={p.tipo_entrega}
          tieneRepartidor={!!p.repartidor_id}
          repartidores={repartidores}
          medioPago={p.medio_pago}
          puedeConfirmarPago={puedeConfirmarPago}
          tieneVenta={!!p.movimiento_id}
        />
      </div>
    </article>
  );
}
