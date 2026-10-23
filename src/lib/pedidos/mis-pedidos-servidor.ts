import type { createAdminClient } from "@/lib/supabase/server";
import { cargarLineasDePedidos } from "./lineas-servidor";
import { armarResumen, type FilaPedidoResumen, type PedidoResumen } from "./mis-pedidos";

// Carga de "Mis pedidos". Sin "use server": la llaman la página (cliente con sesión) y una acción (ids que recuerda
// el navegador). Un "carrito" del bot no es un pedido para el cliente.

type Admin = ReturnType<typeof createAdminClient>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PEDIDOS_LISTA = 30;
const COLUMNAS = "id, numero, estado, tipo_entrega, medio_pago, total, created_at, sucursal_id, sucursales(nombre)";

async function resumir(admin: Admin, filas: FilaPedidoResumen[]): Promise<PedidoResumen[]> {
  const lineas = await cargarLineasDePedidos(admin, filas.map((f) => f.id));
  return filas.map((f) => armarResumen(f, lineas.get(f.id) ?? []));
}

// Cliente con cuenta: todos sus pedidos, de cualquier local, el más nuevo primero.
export async function pedidosDelCliente(admin: Admin, clienteId: string): Promise<PedidoResumen[]> {
  const { data } = await (admin as any)
    .from("pedidos").select(COLUMNAS)
    .eq("cliente_id", clienteId).neq("estado", "carrito")
    .order("created_at", { ascending: false }).limit(MAX_PEDIDOS_LISTA);
  return resumir(admin, (data ?? []) as FilaPedidoResumen[]);
}

// Sin cuenta: los pedidos que el navegador recuerda. El id (uuid aleatorio) es la única credencial, igual que el
// enlace de seguimiento; se descartan los que no son uuid y se acota la cantidad.
export async function pedidosPorIds(admin: Admin, ids: string[]): Promise<PedidoResumen[]> {
  const validos = [...new Set((Array.isArray(ids) ? ids : []).filter((i) => typeof i === "string" && UUID.test(i)))].slice(0, MAX_PEDIDOS_LISTA);
  if (validos.length === 0) return [];
  const { data } = await (admin as any)
    .from("pedidos").select(COLUMNAS)
    .in("id", validos).neq("estado", "carrito")
    .order("created_at", { ascending: false });
  return resumir(admin, (data ?? []) as FilaPedidoResumen[]);
}
