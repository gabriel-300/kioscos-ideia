import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/paginar";
import { resumirClientes, totalesClientes, type ClienteFila, type PedidoDeCliente } from "@/lib/pedidos/clientes-resumen";
import { ClientesTabla } from "./_components/clientes-tabla";

export const revalidate = 0;
export const metadata: Metadata = { title: "Clientes — Tenteo" };

const PESOS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

// Clientes registrados de la tienda (los que ingresaron con Google): cuánto compraron y cómo
// contactarlos. Son datos personales: solo el administrador.
export default async function ClientesPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  if (user.app_metadata?.role !== "admin") redirect("/tenteo/pedidos");

  const admin = createAdminClient();

  const [clientes, pedidos, emails] = await Promise.all([
    fetchAll<ClienteFila>((d, h) =>
      (admin as any).from("clientes").select("id, nombre, telefono, created_at", { count: "exact" }).order("id").range(d, h)),
    fetchAll<PedidoDeCliente>((d, h) =>
      (admin as any).from("pedidos").select("id, cliente_id, total, estado, created_at", { count: "exact" }).not("cliente_id", "is", null).order("id").range(d, h)),
    mailsDeUsuarios(admin),
  ]);

  const resumen = resumirClientes(clientes, pedidos, emails);
  const t = totalesClientes(resumen);

  const tarjetas = [
    { titulo: "Registrados", valor: String(t.registrados), ayuda: "ingresaron con Google" },
    { titulo: "Ya compraron", valor: String(t.conPedidos), ayuda: t.registrados ? `${Math.round((t.conPedidos / t.registrados) * 100)}% de los registrados` : "" },
    { titulo: "Volvieron a comprar", valor: String(t.recurrentes), ayuda: "2 pedidos o más" },
    { titulo: "Vendido a registrados", valor: PESOS.format(t.gastado), ayuda: `${t.pedidos} pedidos` },
  ];

  return (
    <div className="p-4 md:p-8 max-w-[1100px]">
      <div className="mb-5">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Clientes</h1>
        <p className="text-sm text-neutral-400 mt-0.5">
          Los clientes que se registraron en la tienda con Google. Los que piden sin cuenta no figuran acá: de ellos solo queda el dato de cada pedido.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tarjetas.map((c) => (
          <div key={c.titulo} className="rounded-xl border border-neutral-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{c.titulo}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-neutral-900">{c.valor}</p>
            {c.ayuda && <p className="mt-0.5 text-xs text-neutral-400">{c.ayuda}</p>}
          </div>
        ))}
      </div>

      <ClientesTabla clientes={resumen} />

      <p className="mt-3 text-xs text-neutral-400">
        El gasto cuenta los pedidos pagados o aceptados; no incluye los cancelados, vencidos ni los que esperan un pago. Estos datos son personales: usalos solo para atender y comunicarte con tus clientes.
      </p>
    </div>
  );
}

// Los mails viven en el registro de usuarios de Supabase (no en la tabla de clientes). Se leen por páginas.
async function mailsDeUsuarios(admin: ReturnType<typeof createAdminClient>): Promise<Map<string, string>> {
  const mails = new Map<string, string>();
  const porPagina = 200;
  for (let pagina = 1; pagina <= 50; pagina++) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: porPagina });
    if (error) break;
    for (const u of data.users) if (u.email) mails.set(u.id, u.email);
    if (data.users.length < porPagina) break;
  }
  return mails;
}
