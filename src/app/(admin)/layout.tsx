import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/admin/admin-nav";
import { NumberInputWheelGuard } from "@/components/admin/number-input-wheel-guard";
import { redirect } from "next/navigation";

const STAFF_ROLES = ["admin", "encargado", "vendedor"];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const role = (user.app_metadata?.role as string) ?? null;
  if (!role || !STAFF_ROLES.includes(role)) redirect("/login");

  const email = user.email ?? null;
  const name  = (user.user_metadata?.full_name as string | null) ?? null;

  let sucursalId: string | null = null;
  if (role === "encargado") {
    const { data } = await supabase
      .from("sucursales")
      .select("id")
      .eq("encargado_user_id", user.id)
      .single();
    sucursalId = data?.id ?? null;
  } else if (role === "vendedor") {
    const res = await (supabase as any).from("profiles").select("sucursal_id").eq("id", user.id).single();
    sucursalId = (res.data as { sucursal_id: string | null } | null)?.sucursal_id ?? null;
  }

  let auditoriaPendientes = 0;
  let alertasPrecioPendientes = 0;
  let transferenciasPendientes = 0;
  let reposicionPendientes = 0;
  if (role === "admin") {
    const [{ count: countAuditoria }, { count: countAlertas }, { count: countTransferencias }, { data: puntosConPedido }] = await Promise.all([
      (supabase as any)
        .from("auditoria_stock_items")
        .select("id", { count: "exact", head: true })
        .neq("diferencia", 0)
        .is("revisado_por", null),
      (supabase as any)
        .from("alertas_precio")
        .select("id", { count: "exact", head: true })
        .is("revisado_por", null),
      (supabase as any)
        .from("transferencias_stock")
        .select("id", { count: "exact", head: true })
        .eq("estado", "enviada"),
      // Reposición no se puede contar con un filtro simple (compara dos
      // columnas de tablas distintas, algo que PostgREST no soporta) -- se
      // trae solo lo que tiene punto_pedido cargado (subconjunto chico del
      // catálogo) y se cruza con el stock actual acá abajo.
      (supabase as any)
        .from("product_prices")
        .select("product_id, sucursal_id, punto_pedido")
        .not("punto_pedido", "is", null) as unknown as Promise<{
          data: { product_id: string; sucursal_id: string; punto_pedido: number }[] | null;
        }>,
    ]);
    auditoriaPendientes     = countAuditoria ?? 0;
    alertasPrecioPendientes = countAlertas ?? 0;
    transferenciasPendientes = countTransferencias ?? 0;

    if (puntosConPedido && puntosConPedido.length > 0) {
      const productIds = [...new Set(puntosConPedido.map((p) => p.product_id))];
      const { data: stockRows } = await (supabase as any)
        .from("stock_sucursal")
        .select("product_id, sucursal_id, stock_actual")
        .in("product_id", productIds) as { data: { product_id: string; sucursal_id: string; stock_actual: number }[] | null };
      const stockMap = new Map((stockRows ?? []).map((r) => [`${r.sucursal_id}:${r.product_id}`, r.stock_actual]));
      reposicionPendientes = puntosConPedido.filter((p) => (stockMap.get(`${p.sucursal_id}:${p.product_id}`) ?? 0) <= p.punto_pedido).length;
    }
  } else if ((role === "encargado" || role === "vendedor") && sucursalId) {
    // Acá el badge es solo lo que ESE kiosco tiene pendiente de recibir --
    // no el total global (eso es privado de admin, ver arriba).
    const { count } = await (supabase as any)
      .from("transferencias_stock")
      .select("id", { count: "exact", head: true })
      .eq("estado", "enviada")
      .eq("sucursal_destino_id", sucursalId);
    transferenciasPendientes = count ?? 0;
  }

  return (
    <div className="h-screen flex flex-col bg-neutral-50">
      <NumberInputWheelGuard />
      <AdminNav
        role={role} email={email} name={name} sucursalId={sucursalId}
        auditoriaPendientes={auditoriaPendientes}
        alertasPrecioPendientes={alertasPrecioPendientes}
        transferenciasPendientes={transferenciasPendientes}
        reposicionPendientes={reposicionPendientes}
      />
      <main className="flex-1 overflow-auto pt-14 md:pt-0">{children}</main>
    </div>
  );
}
