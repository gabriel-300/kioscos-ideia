import type { Metadata } from "next";
import Link from "next/link";
import { createClient, createAdminClient, getUser } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { normalizarHorario } from "@/lib/pedidos/horario";
import { BeneficioForm } from "./_components/beneficio-form";
import { leerConfigBeneficio } from "@/lib/pedidos/beneficio-servidor";
import { CoordenadasForm } from "./_components/coordenadas-form";
import { leerCoordenadasSucursal } from "@/lib/pedidos/locales";
import { ConfigSucursalForm } from "./_components/config-sucursal-form";
import { ZonasManager } from "./_components/zonas-manager";
import { CatalogoOnlineForm, type GrupoElegible } from "./_components/catalogo-online-form";
import { armarCatalogo } from "@/lib/pedidos/catalogo";
import { leerOcultosOnline } from "@/lib/pedidos/catalogo-online";
import { leerDestacadosOnline } from "@/lib/pedidos/destacado-online";
import { DestacadoForm } from "./_components/destacado-form";
import { HorarioEnviosForm } from "./_components/horario-envios-form";
import { leerDisponibilidadOnline } from "@/lib/pedidos/disponibilidad-online";
import { puertoKiosco } from "@/lib/tenteo/puerto-kiosco";

export const revalidate = 0;
export const metadata: Metadata = { title: "Configuración de pedidos online — Kioscos IDEIA" };

// Zonas de envío con su radio máximo (migración 128). Sin la columna se leen igual y el campo no se muestra.
async function leerZonasConRadio(admin: ReturnType<typeof createAdminClient>, sucursalId: string): Promise<{ filas: unknown[]; conRadio: boolean }> {
  const leer = (columnas: string) => (admin as any).from("zonas_entrega").select(columnas).eq("sucursal_id", sucursalId).order("orden").order("nombre");
  const conRadio = await leer("id, nombre, costo, eta_min, eta_max, is_active, radio_km");
  if (!conRadio.error) return { filas: conRadio.data ?? [], conRadio: true };
  const sinRadio = await leer("id, nombre, costo, eta_min, eta_max, is_active");
  return { filas: sinRadio.data ?? [], conRadio: false };
}

export default async function ConfiguracionPedidosOnlinePage({
  searchParams,
}: {
  searchParams: Promise<{ sucursal?: string }>;
}) {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const user = await getUser();
  if (!user) redirect("/login");
  if (user.app_metadata?.role !== "admin") redirect("/tenteo/pedidos");

  const { data: sucursales } = await admin.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre");
  const lista = (sucursales ?? []) as { id: string; nombre: string }[];
  if (lista.length === 0) redirect("/tenteo/pedidos");

  const sp = await searchParams;
  const seleccionada = lista.find((s) => s.id === sp.sucursal) ?? lista[0];

  const [{ data: cfg }, zonas, beneficio, coordenadas] = await Promise.all([
    (admin as any)
      .from("sucursales")
      .select("pedidos_online_habilitado, delivery_habilitado, retiro_habilitado, pedido_minimo_envio, retiro_eta_min, retiro_eta_max, whatsapp_pedidos, horario_pedidos")
      .eq("id", seleccionada.id)
      .single(),
    leerZonasConRadio(admin, seleccionada.id),
    leerConfigBeneficio(admin, seleccionada.id),
    leerCoordenadasSucursal(admin, seleccionada.id),
  ]);

  // Lo que se podría ofrecer (activo, con precio, categorías permitidas) aunque hoy no tenga stock,
  // marcando lo que hoy no tiene. Sirve para elegir qué se esconde.
  const kiosco = puertoKiosco(admin);
  const [restricciones, datosCatalogo, ocultos, destacados, disponibilidad] = await Promise.all([
    kiosco.restricciones(seleccionada.id),
    kiosco.datosCatalogo(seleccionada.id),
    leerOcultosOnline(admin, seleccionada.id),
    leerDestacadosOnline(admin, seleccionada.id),
    leerDisponibilidadOnline(admin, seleccionada.id),
  ]);
  const sinEsconder = { ...restricciones, productosOcultos: [], promosOcultas: [] };
  const hoyConStock = new Set(armarCatalogo(datosCatalogo, sinEsconder).items.map((i) => i.id));
  const elegibles = armarCatalogo({ ...datosCatalogo, stock: null }, sinEsconder);
  const grupos: GrupoElegible[] = elegibles.grupos.map((g) => ({
    id: g.id,
    nombre: g.name,
    items: g.items.map((i) => ({ id: i.id, esPromo: i.esPromo, nombre: i.name, precio: i.price, sinStock: !hoyConStock.has(i.id), conFoto: !!i.image })),
  }));
  const ocultosInicial = [...ocultos.productos.map((id) => `p:${id}`), ...ocultos.promos.map((id) => `m:${id}`)];

  return (
    <div className="p-4 md:p-8 max-w-[900px]">
      <div className="mb-5">
        <Link href="/tenteo/pedidos" className="text-xs text-neutral-400 hover:underline">← Pedidos online</Link>
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900 mt-1">Configuración de pedidos online</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Cada sucursal tiene sus propios envíos, precios y horarios.</p>
      </div>

      <div className="flex gap-2 flex-wrap mb-5">
        {lista.map((s) => (
          <Link
            key={s.id}
            href={`/tenteo/pedidos/configuracion?sucursal=${s.id}`}
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
        <HorarioEnviosForm sucursalId={seleccionada.id} inicial={disponibilidad.horarioEnvios} />
        <DestacadoForm sucursalId={seleccionada.id} grupos={grupos} inicial={destacados} />
        <CatalogoOnlineForm sucursalId={seleccionada.id} grupos={grupos} ocultosInicial={ocultosInicial} />
        <BeneficioForm sucursalId={seleccionada.id} inicial={beneficio} />
        <CoordenadasForm sucursalId={seleccionada.id} inicial={coordenadas} />
        <ZonasManager
          sucursalId={seleccionada.id}
          conRadio={zonas.conRadio}
          zonas={(zonas.filas as any[]).map((z) => ({ id: z.id, nombre: z.nombre, costo: Number(z.costo), eta_min: z.eta_min, eta_max: z.eta_max, is_active: z.is_active, radio_km: z.radio_km != null ? Number(z.radio_km) : null }))}
        />
      </div>
    </div>
  );
}
