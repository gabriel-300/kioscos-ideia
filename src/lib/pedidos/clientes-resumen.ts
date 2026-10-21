// Resumen de los clientes registrados (los que ingresaron con Google) para la pantalla "Clientes" de
// Tenteo: cuántos pedidos hizo cada uno, cuánto gastó y cuándo compró. Puro (sin base ni red).
//
// Un pedido cuenta si no se cayó (cancelado, vencido o carrito) ni está esperando un pago que
// todavía no llegó: lo que cuenta es lo que el cliente realmente compró.

export type ClienteFila = { id: string; nombre: string | null; telefono: string | null; created_at: string };
export type PedidoDeCliente = { cliente_id: string; total: number | string | null; estado: string; created_at: string };

export type ResumenCliente = {
  id:            string;
  nombre:        string | null;
  email:         string | null;
  telefono:      string | null;
  alta:          string;
  pedidos:       number;
  gastado:       number;
  primerPedido:  string | null;
  ultimoPedido:  string | null;
};

export const ESTADOS_QUE_CUENTAN = ["pagado", "confirmado", "en_preparacion", "listo_retiro", "en_reparto", "entregado"];

export function resumirClientes(clientes: ClienteFila[], pedidos: PedidoDeCliente[], emails: Map<string, string>): ResumenCliente[] {
  const porCliente = new Map<string, PedidoDeCliente[]>();
  for (const p of pedidos) {
    if (!ESTADOS_QUE_CUENTAN.includes(p.estado)) continue;
    porCliente.set(p.cliente_id, [...(porCliente.get(p.cliente_id) ?? []), p]);
  }

  return clientes.map((c) => {
    const suyos = porCliente.get(c.id) ?? [];
    const fechas = suyos.map((p) => p.created_at).sort();
    return {
      id:           c.id,
      nombre:       c.nombre?.trim() || null,
      email:        emails.get(c.id) ?? null,
      telefono:     c.telefono?.trim() || null,
      alta:         c.created_at,
      pedidos:      suyos.length,
      gastado:      suyos.reduce((s, p) => s + (Number(p.total) || 0), 0),
      primerPedido: fechas[0] ?? null,
      ultimoPedido: fechas[fechas.length - 1] ?? null,
    };
  });
}

export type TotalesClientes = { registrados: number; conPedidos: number; recurrentes: number; pedidos: number; gastado: number };

export function totalesClientes(resumen: ResumenCliente[]): TotalesClientes {
  return {
    registrados: resumen.length,
    conPedidos:  resumen.filter((r) => r.pedidos >= 1).length,
    recurrentes: resumen.filter((r) => r.pedidos >= 2).length,
    pedidos:     resumen.reduce((s, r) => s + r.pedidos, 0),
    gastado:     resumen.reduce((s, r) => s + r.gastado, 0),
  };
}

export type OrdenClientes = "gastado" | "pedidos" | "reciente" | "nuevos";

// Búsqueda por nombre, mail o teléfono (sin tildes ni mayúsculas) y orden elegido.
export function filtrarYOrdenar(resumen: ResumenCliente[], consulta: string, orden: OrdenClientes): ResumenCliente[] {
  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = norm(consulta.trim());
  const digitos = consulta.replace(/\D/g, "");
  const filtrados = !q ? resumen : resumen.filter((r) =>
    norm(r.nombre ?? "").includes(q) || norm(r.email ?? "").includes(q) || (digitos.length >= 3 && (r.telefono ?? "").replace(/\D/g, "").includes(digitos)));

  const fecha = (iso: string | null) => (iso ? Date.parse(iso) : 0);
  const comparar: Record<OrdenClientes, (a: ResumenCliente, b: ResumenCliente) => number> = {
    gastado:  (a, b) => b.gastado - a.gastado || b.pedidos - a.pedidos,
    pedidos:  (a, b) => b.pedidos - a.pedidos || b.gastado - a.gastado,
    reciente: (a, b) => fecha(b.ultimoPedido) - fecha(a.ultimoPedido),
    nuevos:   (a, b) => fecha(b.alta) - fecha(a.alta),
  };
  return [...filtrados].sort(comparar[orden]);
}
