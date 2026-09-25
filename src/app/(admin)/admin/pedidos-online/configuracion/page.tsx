import type { Metadata } from "next";
import Link from "next/link";
import { createClient, createAdminClient, getUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { normalizarHorario } from "@/lib/pedidos/horario";
import { ConfigSucursalForm } from "./_components/config-sucursal-form";
import { ZonasManager } from "./_components/zonas-manager";

export const revalidate = 0;
export const metadata: Metadata = { title: "Configuración de pedidos online — Kioscos IDEIA" };

export default async function ConfiguracionPedidosOnlinePage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const user = await getUser();
  if (!user) redirect("/login");
  if (user.app_metadata?.role !== "admin") redirect("/admin/pedidos-online");

  const { data: sucursales } = await admin.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre");
  const lista = (sucursales ?? []) as { id: string; nombre: string }[];
  if (lista.length === 0) redirect("/admin/pedidos-online");

  const sp = await searchParams;
  const seleccionada = lista.find((s) => s.id === sp.sucursal) ?? lista[0];

  const [{ data: cfg }, { data: zonas }] = await Promise.all([
    (admin as any)
      .from("sucursales")
      .select("pedidos_online_habilitado, delivery_habilitado, retiro_habilitado, pedido_minimo_envio, retiro_eta_min, retiro_eta_max, whatsapp_pedidos, horario_pedidos")
      .eq("id", seleccionada.id)
      .single(),
    (admin as any)
      .from("zonas_entrega")
      .select("id, nombre, costo, eta_min, eta_max, is_active")
      .eq("sucursal_id", seleccionada.id)
      .order("orden")
      .order("nombre"),
  ]);

  return (
    <div className="p-4 md:p-8 max-w-[900px]">
      <div className="mb-5">
        <Link href="/admin/pedidos-online" className="text-xs text-neutral-400 hover:underline">← Pedidos online</Link>
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900 mt-1">Configuración de pedidos online</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Cada sucursal tiene sus propios envíos, precios y horarios.</p>
      </div>

      <div className="flex gap-2 flex-wrap mb-5">
        {lista.map((s) => (
          <Link
            key={s.id}
            href={`/admin/pedidos-online/configuracion?sucursal=${s.id}`}
            className={`px-3.5 py-2 rounded-full text-sm font-semibold border transition-colors ${
              s.id === seleccionada.id ? "bg-tierra-700 text-white border-tierra-700" : "bg-white text-neutral-600 border-neutral-200 hover:border-tierra-300"
            }`}
          >
            {s.nombre}
          </Link>
        ))}
      </div>

      <div className="space-y-5" key={seleccionada.id}>
        <ConfigSucursalForm
          sucursalId={seleccionada.id}
          inicial={{
            pedidos_online_habilitado: !!cfg?.pedidos_online_habilitado,
            delivery_habilitado:       !!cfg?.delivery_habilitado,
            retiro_habilitado:         cfg?.retiro_habilitado ?? true,
            pedido_minimo_envio:       Number(cfg?.pedido_minimo_envio ?? 0),
            retiro_eta_min:            cfg?.retiro_eta_min ?? 15,
            retiro_eta_max:            cfg?.retiro_eta_max ?? 20,
            whatsapp_pedidos:          cfg?.whatsapp_pedidos ?? "",
            horario_pedidos:           normalizarHorario(cfg?.horario_pedidos),
          }}
        />
        <ZonasManager
          sucursalId={seleccionada.id}
          zonas={((zonas ?? []) as any[]).map((z) => ({ id: z.id, nombre: z.nombre, costo: Number(z.costo), eta_min: z.eta_min, eta_max: z.eta_max, is_active: z.is_active }))}
        />
      </div>
    </div>
  );
}
