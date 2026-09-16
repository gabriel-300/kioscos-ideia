import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PedidoOnlineAcciones } from "./_components/pedido-online-acciones";

export const revalidate = 0;
export const metadata: Metadata = { title: "Pedidos online — Kioscos IDEIA" };

const ESTADO_LABEL: Record<string, string> = {
  pagado:         "Pagado",
  en_preparacion: "En preparación",
  listo_retiro:   "Listo para retirar",
  en_reparto:     "En reparto",
  entregado:      "Entregado",
};

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export default async function PedidosOnlinePage() {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;
  if (!role || !["admin", "encargado", "vendedor", "concesionario"].includes(role)) redirect("/admin/dashboard");

  // Mismo patrón que transferencias/page.tsx: encargado/concesionario/
  // vendedor solo ven su propia sucursal, admin ve todas.
  let miSucursalId: string | null = null;
  if (role === "encargado" || role === "concesionario") {
    const { data } = await admin.from("sucursales").select("id").eq("encargado_user_id", user.id).single();
    miSucursalId = (data as { id: string } | null)?.id ?? null;
  } else if (role === "vendedor") {
    const res = await (admin as any).from("profiles").select("sucursal_id").eq("id", user.id).single();
    miSucursalId = (res.data as { sucursal_id: string | null } | null)?.sucursal_id ?? null;
  }
  if (role !== "admin" && !miSucursalId) redirect("/admin/dashboard");

  let query = (admin as any)
    .from("pedidos")
    .select("id, origen, estado, tipo_entrega, cliente_nombre, cliente_telefono, direccion_entrega, total, repartidor_id, created_at, sucursales(nombre)")
    .not("estado", "in", "(carrito,pendiente_pago,cancelado,expirado)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (miSucursalId) query = query.eq("sucursal_id", miSucursalId);

  const { data: pedidosRaw } = await query;
  const pedidos = (pedidosRaw ?? []) as any[];

  // Lista de repartidores para el selector de asignación -- no hay tabla
  // propia, el rol vive en auth.users.app_metadata (mismo criterio que el
  // resto de este proyecto para roles de staff).
  const { data: usuarios } = await admin.auth.admin.listUsers({ perPage: 200 });
  const repartidores = (usuarios?.users ?? [])
    .filter((u) => u.app_metadata?.role === "repartidor")
    .map((u) => ({ id: u.id, nombre: (u.user_metadata?.full_name as string | undefined) || u.email || "Repartidor" }));

  return (
    <div className="p-4 md:p-8 max-w-[1300px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Pedidos online</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Pedidos pagados desde el catálogo público o WhatsApp -- prepará, asigná repartidor si es delivery, y marcá cuando esté entregado.</p>
      </div>

      {pedidos.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-400">
          No hay pedidos online activos en este momento.
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-200">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Cliente</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Sucursal</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Entrega</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Estado</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Total</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {pedidos.map((p) => (
                <tr key={p.id} className="hover:bg-neutral-50/80 transition-colors align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-neutral-800 leading-tight">{p.cliente_nombre ?? "Sin nombre"}</p>
                    <p className="text-[11px] text-neutral-400">{p.cliente_telefono}</p>
                    <p className="text-[10px] text-neutral-300 mt-0.5">{p.origen === "whatsapp" ? "WhatsApp" : "Storefront"}</p>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{p.sucursales?.nombre ?? "—"}</td>
                  <td className="px-4 py-3">
                    {p.tipo_entrega === "delivery" ? (
                      <>
                        <span className="text-xs font-medium text-neutral-700">Delivery</span>
                        <p className="text-[11px] text-neutral-400 max-w-[200px]">{p.direccion_entrega}</p>
                      </>
                    ) : (
                      <span className="text-xs font-medium text-neutral-700">Retiro en local</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-neutral-700">{ESTADO_LABEL[p.estado] ?? p.estado}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-tierra-700 tabular-nums">{AR.format(p.total)}</td>
                  <td className="px-4 py-3">
                    <PedidoOnlineAcciones
                      pedidoId={p.id}
                      estado={p.estado}
                      tipoEntrega={p.tipo_entrega}
                      tieneRepartidor={!!p.repartidor_id}
                      repartidores={repartidores}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
