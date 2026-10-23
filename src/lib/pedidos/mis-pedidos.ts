import { armarSeguimiento } from "./seguimiento";
import type { LineaPedido } from "./lineas";

// "Mis pedidos" del cliente de la tienda. Puro (sin base ni red): lo que se recuerda en el navegador de quien
// pidió sin cuenta, y cómo se resume un pedido para mostrarlo en la lista. Con cuenta de Google la lista sale
// de la base (pedidos.cliente_id); sin cuenta, de los pedidos que este navegador recuerda. Solo se guarda qué
// pedido es -- nunca nombre, teléfono ni dirección.

export const CLAVE_MIS_PEDIDOS = "pedir:mis-pedidos";
export const MAX_PEDIDOS_RECORDADOS = 20;
export const VIGENCIA_MIS_PEDIDOS_MS = 90 * 24 * 60 * 60 * 1000;

export type PedidoRecordado = { sucursalId: string; pedidoId: string; numero: number; fecha: number };

export function leerPedidosRecordados(storage: Pick<Storage, "getItem">, ahora = Date.now()): PedidoRecordado[] {
  try {
    const crudo = storage.getItem(CLAVE_MIS_PEDIDOS);
    if (!crudo) return [];
    const lista = JSON.parse(crudo);
    if (!Array.isArray(lista)) return [];
    return lista.filter((p): p is PedidoRecordado =>
      !!p && typeof p.sucursalId === "string" && typeof p.pedidoId === "string" && typeof p.numero === "number" && typeof p.fecha === "number"
      && ahora - p.fecha <= VIGENCIA_MIS_PEDIDOS_MS);
  } catch {
    return [];
  }
}

// Suma un pedido (el más nuevo primero), sin repetirlo y sin pasarse del máximo. "Mejor esfuerzo": si el
// almacenamiento está bloqueado simplemente no se recuerda.
export function recordarPedido(storage: Pick<Storage, "getItem" | "setItem">, p: Omit<PedidoRecordado, "fecha">, ahora = Date.now()) {
  try {
    const resto = leerPedidosRecordados(storage, ahora).filter((x) => x.pedidoId !== p.pedidoId);
    storage.setItem(CLAVE_MIS_PEDIDOS, JSON.stringify([{ ...p, fecha: ahora }, ...resto].slice(0, MAX_PEDIDOS_RECORDADOS)));
  } catch {
    // modo privado o almacenamiento bloqueado
  }
}

export type PedidoResumen = {
  id:         string;
  sucursalId: string;
  numero:     number;
  estado:     string;
  titulo:     string;  // el estado en lenguaje del cliente ("Pedido entregado")
  final:      boolean; // ya no va a cambiar
  total:      number;
  creadoEn:   string;
  sucursal:   string;
  delivery:   boolean;
  resumen:    string;  // "2× Chipa, 1× Café con leche y 1 más"
};

export type FilaPedidoResumen = {
  id: string; numero: number; estado: string; tipo_entrega: string; medio_pago: string | null;
  total: number | string; created_at: string; sucursal_id: string; sucursales?: { nombre?: string | null } | null;
};

const MAX_LINEAS_VISIBLES = 3;

export function resumirLineas(lineas: LineaPedido[]): string {
  if (lineas.length === 0) return "";
  const visibles = lineas.slice(0, MAX_LINEAS_VISIBLES).map((l) => l.titulo);
  const resto = lineas.length - visibles.length;
  if (resto > 0) return `${visibles.join(", ")} y ${resto} más`;
  return visibles.length > 1 ? `${visibles.slice(0, -1).join(", ")} y ${visibles[visibles.length - 1]}` : visibles[0];
}

export function armarResumen(p: FilaPedidoResumen, lineas: LineaPedido[]): PedidoResumen {
  const seg = armarSeguimiento({ estado: p.estado, tipo_entrega: p.tipo_entrega, medio_pago: p.medio_pago });
  return {
    id:         p.id,
    sucursalId: p.sucursal_id,
    numero:     p.numero,
    estado:     p.estado,
    titulo:     seg.titulo,
    final:      seg.final,
    total:      Number(p.total),
    creadoEn:   p.created_at,
    sucursal:   (p.sucursales?.nombre ?? "").trim().replace(/^angiru food\s+/i, ""),
    delivery:   p.tipo_entrega === "delivery",
    resumen:    resumirLineas(lineas),
  };
}
