import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MarcarEntregadoButton } from "./_components/marcar-entregado-button";

export const revalidate = 0;
export const metadata: Metadata = { title: "Mis entregas — Kioscos IDEIA" };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

// Repartidor es un rol aparte, contenido en middleware.ts a solo esta
// ruta -- acá se repite el mismo chequeo a nivel de página (no se depende
// solo del middleware), mismo criterio de "defensa en profundidad" que el
// resto del proyecto. Admin puede entrar para supervisar.
export default async function RepartosPage() {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;
  if (role !== "repartidor" && role !== "admin") redirect("/admin/dashboard");

  let query = (admin as any)
    .from("pedidos")
    .select("id, cliente_nombre, cliente_telefono, direccion_entrega, total, created_at, sucursales(nombre)")
    .eq("estado", "en_reparto")
    .order("created_at", { ascending: true });
  if (role === "repartidor") query = query.eq("repartidor_id", user.id);

  const { data: pedidosRaw } = await query;
  const pedidos = (pedidosRaw ?? []) as any[];

  return (
    <div className="p-4 md:p-8 max-w-[900px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Mis entregas</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Pedidos en camino -- marcá cada uno como entregado cuando lo dejes.</p>
      </div>

      {pedidos.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-400">
          No tenés entregas asignadas en este momento.
        </div>
      ) : (
        <div className="space-y-3">
          {pedidos.map((p) => (
            <div key={p.id} className="rounded-xl border border-neutral-200 bg-white p-4 flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-neutral-900">{p.cliente_nombre ?? "Sin nombre"}</p>
                <p className="text-sm text-neutral-600 mt-0.5">{p.direccion_entrega}</p>
                <p className="text-xs text-neutral-400 mt-1">{p.cliente_telefono} · {p.sucursales?.nombre}</p>
                <p className="text-sm font-semibold text-tierra-700 mt-1.5">{AR.format(p.total)}</p>
              </div>
              <MarcarEntregadoButton pedidoId={p.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
