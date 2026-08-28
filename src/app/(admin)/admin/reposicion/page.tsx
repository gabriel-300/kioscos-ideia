import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatKg } from "@/lib/utils";
import { obtenerItemsReposicion, type ItemReposicion } from "@/lib/reposicion";
import { MarcarPedidoButton } from "./_components/marcar-pedido-button";

export const revalidate = 0;
export const metadata: Metadata = { title: "Reposición — Kioscos IDEIA" };

function fmtQty(qty: number, unit: string) {
  if (unit === "kg") return `${formatKg(qty)} kg`;
  return `${qty} ${unit === "unidad" ? "u." : unit}`;
}

function labelCiclo(diaPedido: string | null) {
  if (diaPedido === "diario") return "Todos los días";
  if (diaPedido) return diaPedido[0].toUpperCase() + diaPedido.slice(1);
  return null;
}

export default async function ReposicionPage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string; categoria?: string; proveedor?: string; q?: string }>;
}) {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = user.app_metadata?.role as string | undefined;
  if (role !== "admin") redirect("/admin/dashboard");

  const sp = await searchParams;

  const [items, { data: sucursales }, { data: categories }, { data: proveedores }] = await Promise.all([
    obtenerItemsReposicion(admin),
    supabase.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre"),
    supabase.from("categories").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("proveedores").select("id, nombre").eq("is_active", true).order("nombre"),
  ]);

  const pasaFiltros = (f: ItemReposicion) => {
    if (sp.sucursal && f.sucursalId !== sp.sucursal) return false;
    if (sp.categoria && f.categoryId !== sp.categoria) return false;
    if (sp.proveedor && f.proveedorId !== sp.proveedor) return false;
    if (sp.q) {
      const q = sp.q.toLowerCase();
      if (!f.nombre.toLowerCase().includes(q) && !f.sku.toLowerCase().includes(q)) return false;
    }
    return true;
  };

  const bajoPedido = items
    .filter((f) => f.motivo === "punto_pedido")
    .filter(pasaFiltros)
    .sort((a, b) => a.sucursalNombre.localeCompare(b.sucursalNombre) || a.nombre.localeCompare(b.nombre));

  const pedidoHoy = items
    .filter((f) => f.motivo === "ciclo")
    .filter(pasaFiltros)
    .sort((a, b) => a.sucursalNombre.localeCompare(b.sucursalNombre) || a.nombre.localeCompare(b.nombre));

  function Tabla({ filas, vacio }: { filas: ItemReposicion[]; vacio: string }) {
    if (filas.length === 0) return <p className="px-4 py-8 text-center text-sm text-neutral-400">{vacio}</p>;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-200">
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Producto</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Proveedor</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Sucursal</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Stock actual</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Mínimo</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Punto de pedido</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Máximo</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">Cantidad sugerida</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filas.map((f) => {
              const ciclo = labelCiclo(f.diaPedido);
              return (
                <tr key={`${f.sucursalId}:${f.productId}`} className="hover:bg-neutral-50/80 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-neutral-800 leading-tight">{f.nombre}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[11px] text-neutral-400 font-mono">{f.sku}</span>
                      {f.diasEntrega != null && (
                        <>
                          <span className="text-[10px] text-neutral-300">·</span>
                          <span className="text-[10px] text-amber-600 font-medium">🕑 llega en {f.diasEntrega} {f.diasEntrega === 1 ? "día" : "días"}</span>
                        </>
                      )}
                      {ciclo && (
                        <>
                          <span className="text-[10px] text-neutral-300">·</span>
                          <span className="text-[10px] text-tierra-600 font-medium">🔁 {ciclo}</span>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {f.proveedorNombre ?? <span className="text-amber-600 text-xs">Sin asignar</span>}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">{f.sucursalNombre}</td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${f.stockActual <= 0 ? "text-red-600" : "text-neutral-900"}`}>
                    {fmtQty(f.stockActual, f.unit)}
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-400 tabular-nums">{f.puntoMinimo ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-neutral-400 tabular-nums">{f.puntoPedido ?? "—"}</td>
                  <td className="px-4 py-3 text-right text-neutral-400 tabular-nums">{f.puntoMaximo ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold text-tierra-700 tabular-nums">
                    {f.cantidadSugerida != null ? fmtQty(f.cantidadSugerida, f.unit) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <MarcarPedidoButton productId={f.productId} sucursalId={f.sucursalId} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-[1300px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Reposición</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Qué conviene pedir, según los puntos de stock configurados por producto</p>
      </div>

      {/* Filtros */}
      <form method="GET" className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Sucursal</label>
          <select name="sucursal" defaultValue={sp.sucursal ?? ""}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700">
            <option value="">Todas</option>
            {(sucursales ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Categoría</label>
          <select name="categoria" defaultValue={sp.categoria ?? ""}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700">
            <option value="">Todas</option>
            {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Proveedor</label>
          <select name="proveedor" defaultValue={sp.proveedor ?? ""}
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700">
            <option value="">Todos</option>
            {(proveedores ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-neutral-500 mb-1">Buscar</label>
          <input type="text" name="q" defaultValue={sp.q ?? ""} placeholder="SKU o nombre…"
            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700" />
        </div>
        <button type="submit" className="h-9 px-4 rounded-lg bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 transition-colors">
          Filtrar
        </button>
        {(sp.sucursal || sp.categoria || sp.proveedor || sp.q) && (
          <Link href="/admin/reposicion" className="h-9 px-3 rounded-lg border border-neutral-200 text-sm text-neutral-500 hover:bg-neutral-50 transition-colors flex items-center">
            Limpiar
          </Link>
        )}
      </form>

      {pedidoHoy.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-neutral-800 mb-1">
            Pedido de ciclo fijo — hoy
          </h2>
          <p className="text-xs text-neutral-400 mb-3">
            Productos diarios o con día fijo de pedido que coincide con hoy -- revisalos aunque el stock todavía esté bien, si no se piden hoy se pierde el ciclo.
          </p>
          <div className="rounded-xl border border-tierra-200 bg-white overflow-hidden">
            <Tabla filas={pedidoHoy} vacio="Nada para pedir hoy." />
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-neutral-800 mb-3">Por debajo del punto de pedido</h2>
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <Tabla filas={bajoPedido} vacio="Nada por debajo del punto de pedido en este momento." />
        </div>
      </div>

      <p className="text-xs text-neutral-400 mt-4">
        La cantidad sugerida es un punto de partida (máximo − stock actual) para armar el pedido -- todavía no genera un pedido real al proveedor. "Marcar pedido" saca el ítem de esta lista hasta que llegue una entrega nueva de ese producto en esa sucursal.
      </p>
    </div>
  );
}
