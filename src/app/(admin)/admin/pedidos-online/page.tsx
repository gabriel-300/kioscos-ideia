import type { Metadata } from "next";
import Link from "next/link";
import { createClient, createAdminClient, getUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PedidoOnlineAcciones } from "./_components/pedido-online-acciones";

export const revalidate = 0;
export const metadata: Metadata = { title: "Pedidos online — Kioscos IDEIA" };

const ESTADO_LABEL: Record<string, string> = {
  pendiente_pago: "Esperando pago",
  confirmado:     "Nuevo (cobra en la puerta)",
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

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export default async function PedidosOnlinePage() {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const user = await getUser();
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
    .select("id, numero, origen, estado, tipo_entrega, cliente_nombre, cliente_telefono, direccion_entrega, direccion_referencia, zona_nombre, costo_envio, medio_pago, pago_con, notas, eta_min, eta_max, total, repartidor_id, movimiento_id, expira_en, created_at, sucursales(nombre)")
    .not("estado", "in", "(carrito,cancelado,expirado)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (miSucursalId) query = query.eq("sucursal_id", miSucursalId);

  const { data: pedidosRaw } = await query;
  // "pendiente_pago" solo interesa si es un pago por link que el local tiene
  // que confirmar a mano -- el resto (QR automático abandonado) es ruido.
  const ahora = Date.now();
  const pedidos = ((pedidosRaw ?? []) as any[]).filter((p) =>
    p.estado !== "pendiente_pago" ||
    (p.medio_pago === "mercadopago_link" && (!p.expira_en || new Date(p.expira_en).getTime() > ahora))
  );

  // Lista de repartidores para el selector de asignación -- no hay tabla
  // propia, el rol vive en auth.users.app_metadata (mismo criterio que el
  // resto de este proyecto para roles de staff).
  const { data: usuarios } = await admin.auth.admin.listUsers({ perPage: 200 });
  const repartidores = (usuarios?.users ?? [])
    .filter((u) => u.app_metadata?.role === "repartidor")
    .map((u) => ({ id: u.id, nombre: (u.user_metadata?.full_name as string | undefined) || u.email || "Repartidor" }));

  return (
    <div className="p-4 md:p-8 max-w-[1300px]">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Pedidos online</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Pedidos del catálogo público o WhatsApp -- aceptá, prepará, asigná repartidor si es delivery, y marcá cuando esté entregado.</p>
        </div>
        {role === "admin" && (
          <Link
            href="/admin/pedidos-online/configuracion"
            className="h-9 px-4 rounded-lg border border-neutral-300 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 flex items-center"
          >
            Configuración de envíos y horarios
          </Link>
        )}
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
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Pedido</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Sucursal</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Entrega</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Pago</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Estado</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Total</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {pedidos.map((p) => (
                <tr key={p.id} className="hover:bg-neutral-50/80 transition-colors align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-neutral-800 leading-tight">
                      {p.numero ? <span className="text-neutral-400 font-normal">#{p.numero} </span> : null}
                      {p.cliente_nombre ?? "Sin nombre"}
                    </p>
                    <p className="text-[11px] text-neutral-400">{p.cliente_telefono}</p>
                    <p className="text-[10px] text-neutral-300 mt-0.5">{p.origen === "whatsapp" ? "WhatsApp" : "Catálogo online"}</p>
                    {p.notas && <p className="text-[11px] text-neutral-500 mt-1 max-w-[220px]">“{p.notas}”</p>}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{p.sucursales?.nombre ?? "—"}</td>
                  <td className="px-4 py-3">
                    {p.tipo_entrega === "delivery" ? (
                      <>
                        <span className="text-xs font-medium text-neutral-700">
                          Delivery{p.zona_nombre ? ` · ${p.zona_nombre}` : ""}
                        </span>
                        <p className="text-[11px] text-neutral-500 max-w-[220px]">{p.direccion_entrega}</p>
                        {p.direccion_referencia && <p className="text-[11px] text-neutral-400 max-w-[220px]">{p.direccion_referencia}</p>}
                        {p.costo_envio > 0 && <p className="text-[11px] text-neutral-400">Envío {AR.format(p.costo_envio)}</p>}
                      </>
                    ) : (
                      <span className="text-xs font-medium text-neutral-700">Retiro en local</span>
                    )}
                    {p.eta_min != null && (
                      <p className="text-[10px] text-neutral-300">{p.eta_min}–{p.eta_max} min</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-neutral-700">{MEDIO_LABEL[p.medio_pago] ?? "—"}</span>
                    {p.medio_pago === "efectivo" && p.pago_con && (
                      <p className="text-[11px] text-neutral-400">Paga con {AR.format(p.pago_con)}</p>
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
                      medioPago={p.medio_pago}
                      puedeConfirmarPago={role === "admin" || role === "encargado"}
                      tieneVenta={!!p.movimiento_id}
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
