import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const revalidate = 0;
export const metadata: Metadata = { title: "Pedido Ya — Kioscos IDEIA" };

type WebhookEvent = {
  id:                string;
  received_at:       string;
  raw_payload:        unknown;
  external_order_id:  string | null;
  external_store_id:  string | null;
  status:             string;
  error_message:      string | null;
  sucursal:           { nombre: string } | null;
};

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  received:  { label: "Recibido",   className: "bg-neutral-100 text-neutral-600" },
  processed: { label: "Procesado",  className: "bg-selva-100 text-selva-700" },
  error:     { label: "Error",      className: "bg-danger/10 text-danger" },
  ignored:   { label: "Ignorado",   className: "bg-amber-100 text-amber-700" },
};

export default async function PedidoYaPage() {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;
  if (role !== "admin") redirect("/admin/dashboard");

  const configurado = !!process.env.PEDIDOYA_WEBHOOK_TOKEN;

  const eventosRes = await (admin as any)
    .from("pedidoya_webhook_events")
    .select("id, received_at, raw_payload, external_order_id, external_store_id, status, error_message, sucursal:sucursales(nombre)")
    .order("received_at", { ascending: false })
    .limit(100);
  const eventos = (eventosRes.data ?? []) as WebhookEvent[];

  return (
    <div className="p-4 md:p-8 max-w-[1100px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Pedido Ya — integración</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Pedidos recibidos automáticamente por webhook (todavía no arma ventas solo)</p>
      </div>

      {!configurado && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-6 text-sm text-amber-800">
          <p className="font-semibold">La integración todavía no está configurada.</p>
          <p className="mt-1 text-amber-700">
            Falta el token del Vendor Portal de PedidosYa (variable <code className="bg-amber-100 px-1 rounded">PEDIDOYA_WEBHOOK_TOKEN</code>).
            El endpoint <code className="bg-amber-100 px-1 rounded">/api/webhooks/pedidoya</code> ya está listo para recibir pedidos apenas se
            gestione el acceso — ver el correo de solicitud a soporte de integraciones.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        {eventos.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-neutral-400">
            Todavía no llegó ningún pedido por webhook.
          </p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {eventos.map((e) => {
              const status = STATUS_LABEL[e.status] ?? { label: e.status, className: "bg-neutral-100 text-neutral-600" };
              return (
                <details key={e.id} className="group">
                  <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-neutral-50 transition-colors list-none">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${status.className}`}>
                      {status.label}
                    </span>
                    <span className="text-sm text-neutral-700 shrink-0">
                      {new Date(e.received_at).toLocaleString("es-AR")}
                    </span>
                    <span className="text-sm text-neutral-500 truncate">
                      Pedido {e.external_order_id ?? "—"} · Tienda {e.external_store_id ?? "—"}
                    </span>
                    <span className="text-sm font-medium text-neutral-700 shrink-0 ml-auto">
                      {e.sucursal?.nombre ?? "Sin mapear"}
                    </span>
                  </summary>
                  <div className="px-4 pb-4">
                    {e.error_message && (
                      <p className="text-sm text-danger mb-2">{e.error_message}</p>
                    )}
                    <pre className="text-xs bg-neutral-900 text-neutral-100 rounded-lg p-3 overflow-x-auto">
                      {JSON.stringify(e.raw_payload, null, 2)}
                    </pre>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
