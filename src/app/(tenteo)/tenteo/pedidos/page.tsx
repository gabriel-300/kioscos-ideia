import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { TarjetaPedido, type PedidoTarjeta } from "./_components/tarjeta-pedido";
import { cargarLineasDePedidos } from "@/lib/pedidos/lineas-servidor";
import { pagoPorLinkVigente, sucursalesVisibles } from "@/lib/pedidos/por-atender";
import { GRUPOS, agruparPedidos } from "@/lib/pedidos/presentacion";
import { ControlDisponibilidad, type ControlSucursal } from "./_components/control-disponibilidad";
import { leerDisponibilidadOnline } from "@/lib/pedidos/disponibilidad-online";
import { ROLES_CON_SUCURSAL, destinoPorDefecto, puedeEntrar, rolDe } from "@/lib/auth/acceso";

export const revalidate = 0;
export const metadata: Metadata = { title: "Pedidos online — Kioscos IDEIA" };

export default async function PedidosOnlinePage() {
  const admin = createAdminClient();

  const user = await getUser();
  if (!user) redirect("/login");

  // Personal con acceso a Tenteo (el repartidor tiene su propia pantalla: /tenteo/repartos).
  const role = rolDe(user);
  if (!role || !(ROLES_CON_SUCURSAL as readonly string[]).includes(role) || !puedeEntrar(user, "tenteo")) {
    redirect(destinoPorDefecto(user) ?? "/login");
  }

  // admin ve todas las sucursales; el resto, las suyas (un vendedor puede tener varias).
  const sucursales = await sucursalesVisibles(admin, user.id, role);
  const sinSucursales = !!sucursales && sucursales.length === 0;

  let query = (admin as any)
    .from("pedidos")
    .select("id, numero, origen, estado, tipo_entrega, cliente_nombre, cliente_telefono, direccion_entrega, direccion_referencia, entrega_latitud, entrega_longitud, zona_nombre, costo_envio, medio_pago, pago_con, notas, eta_min, eta_max, total, repartidor_id, movimiento_id, expira_en, created_at, sucursales(nombre)")
    .not("estado", "in", "(carrito,cancelado,expirado)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (sucursales) query = query.in("sucursal_id", sucursales);

  const { data: pedidosRaw } = sinSucursales ? { data: [] } : await query;

  // Cartel con QR para pegar en el local: una sucursal por enlace.
  let sucursalesQr = (admin as any).from("sucursales").select("id, nombre, delivery_habilitado").eq("is_active", true).eq("pedidos_online_habilitado", true).order("nombre");
  if (sucursales) sucursalesQr = sucursalesQr.in("id", sucursales);
  const { data: sucursalesConQr } = sinSucursales ? { data: [] } : await sucursalesQr as { data: { id: string; nombre: string; delivery_habilitado: boolean | null }[] | null };

  // Interruptores del personal: pausar los envíos o todos los pedidos online, con motivo (migración 122).
  const controles: ControlSucursal[] = await Promise.all((sucursalesConQr ?? []).map(async (s) => {
    const d = await leerDisponibilidadOnline(admin, s.id);
    return { id: s.id, nombre: s.nombre, conEnvio: !!s.delivery_habilitado, pausaEnvios: d.pausas.envios, pausaPedidos: d.pausas.pedidos };
  }));

  // Por urgencia: lo que espera al local arriba (el que más espera, primero) y lo ya
  // entregado al final. "pendiente_pago" solo interesa si es un pago por link vigente
  // que el local tiene que confirmar a mano -- el resto (QR abandonado) es ruido.
  const ahora = Date.now();
  const grupos = agruparPedidos((pedidosRaw ?? []) as PedidoTarjeta[], (p) => pagoPorLinkVigente(p, ahora));
  const todos = GRUPOS.flatMap((g) => grupos[g.clave]);

  // Qué pidió cada cliente (varios pedidos con pocas consultas; si falla, la lista sale igual sin el detalle).
  const lineasPorPedido = await cargarLineasDePedidos(admin, todos.map((p) => p.id));

  // Lista de repartidores para el selector de asignación -- no hay tabla
  // propia, el rol vive en auth.users.app_metadata (mismo criterio que el
  // resto de este proyecto para roles de staff). Solo hace falta si hay un envío.
  let repartidores: { id: string; nombre: string }[] = [];
  if (todos.some((p) => p.tipo_entrega === "delivery")) {
    const { data: usuarios } = await admin.auth.admin.listUsers({ perPage: 200 });
    repartidores = (usuarios?.users ?? [])
      .filter((u) => u.app_metadata?.role === "repartidor")
      .map((u) => ({ id: u.id, nombre: (u.user_metadata?.full_name as string | undefined) || u.email || "Repartidor" }));
  }

  const puedeConfirmarPago = role === "admin" || role === "encargado";
  const activos = GRUPOS.filter((g) => g.clave !== "entregados" && grupos[g.clave].length > 0);
  const entregados = grupos.entregados;

  const tarjetas = (clave: (typeof GRUPOS)[number]["clave"]) => (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {grupos[clave].map((p) => (
        <TarjetaPedido
          key={p.id}
          pedido={p}
          grupo={clave}
          lineas={lineasPorPedido.get(p.id) ?? []}
          repartidores={repartidores}
          puedeConfirmarPago={puedeConfirmarPago}
        />
      ))}
    </div>
  );

  return (
    <div className="p-4 md:p-8 max-w-[1300px]">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Pedidos online</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Pedidos del catálogo público o WhatsApp -- aceptá, prepará, asigná repartidor si es delivery, y marcá cuando esté entregado.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(sucursalesConQr ?? []).map((s) => (
            <Link
              key={s.id}
              href={`/pedir/${s.id}/qr`}
              target="_blank"
              className="h-9 px-4 rounded-lg border border-neutral-300 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 flex items-center"
            >
              Imprimir QR{(sucursalesConQr ?? []).length > 1 ? ` · ${s.nombre}` : ""}
            </Link>
          ))}
          {role === "admin" && (
            <Link
              href="/tenteo/pedidos/configuracion"
              className="h-9 px-4 rounded-lg border border-neutral-300 bg-white text-sm font-medium text-neutral-700 hover:bg-neutral-50 flex items-center"
            >
              Configuración de envíos y horarios
            </Link>
          )}
        </div>
      </div>

      <ControlDisponibilidad sucursales={controles} />

      {todos.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-400">
          {sinSucursales ? "No tenés una sucursal asignada: pedile al administrador que te asigne una." : "No hay pedidos online activos en este momento."}
        </div>
      ) : (
        <div className="space-y-8">
          {activos.length === 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center text-sm font-medium text-emerald-800">
              No hay pedidos para atender. Todo al día.
            </div>
          )}

          {activos.map((g) => (
            <section key={g.clave}>
              <div className="mb-3 flex flex-wrap items-baseline gap-2">
                <h2 className="text-base font-bold text-neutral-900">{g.titulo}</h2>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${g.clave === "atender" ? "bg-amber-500 text-white" : "bg-neutral-200 text-neutral-700"}`}>
                  {grupos[g.clave].length}
                </span>
                <span className="text-xs text-neutral-400">{g.ayuda}</span>
              </div>
              {tarjetas(g.clave)}
            </section>
          ))}

          {entregados.length > 0 && (
            <details className="rounded-xl border border-neutral-200 bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold text-neutral-700">
                Entregados ({entregados.length})
              </summary>
              <div className="mt-4">{tarjetas("entregados")}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
