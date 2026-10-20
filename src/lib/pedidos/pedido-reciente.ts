// El último pedido que hizo el cliente desde la tienda, recordado en SU navegador para que
// pueda volver a seguirlo si cierra la página (no tiene cuenta ni le podemos escribir por
// WhatsApp). Solo se guarda qué pedido es -- nunca nombre, teléfono ni dirección.
// Las funciones reciben el storage para poder probarlas sin navegador; todo es "mejor
// esfuerzo": si el almacenamiento está bloqueado simplemente no se recuerda.

export const CLAVE_PEDIDO_RECIENTE = "pedir:pedido-reciente";
export const VIGENCIA_PEDIDO_RECIENTE_MS = 24 * 60 * 60 * 1000;

export type PedidoReciente = { sucursalId: string; pedidoId: string; numero: number; fecha: number };

export function guardarPedidoReciente(storage: Pick<Storage, "setItem">, p: Omit<PedidoReciente, "fecha">, ahora = Date.now()) {
  try {
    storage.setItem(CLAVE_PEDIDO_RECIENTE, JSON.stringify({ ...p, fecha: ahora } satisfies PedidoReciente));
  } catch {
    // modo privado o almacenamiento bloqueado
  }
}

export function leerPedidoReciente(storage: Pick<Storage, "getItem">, ahora = Date.now()): PedidoReciente | null {
  try {
    const crudo = storage.getItem(CLAVE_PEDIDO_RECIENTE);
    if (!crudo) return null;
    const p = JSON.parse(crudo) as Partial<PedidoReciente>;
    if (typeof p.sucursalId !== "string" || typeof p.pedidoId !== "string" || typeof p.numero !== "number" || typeof p.fecha !== "number") return null;
    if (ahora - p.fecha > VIGENCIA_PEDIDO_RECIENTE_MS) return null;
    return { sucursalId: p.sucursalId, pedidoId: p.pedidoId, numero: p.numero, fecha: p.fecha };
  } catch {
    return null;
  }
}

export function olvidarPedidoReciente(storage: Pick<Storage, "removeItem">) {
  try {
    storage.removeItem(CLAVE_PEDIDO_RECIENTE);
  } catch {
    // nada que hacer
  }
}
