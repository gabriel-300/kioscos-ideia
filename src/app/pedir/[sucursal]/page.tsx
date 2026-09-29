import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizarHorario } from "@/lib/pedidos/horario";
import { cargarCatalogoSucursal } from "@/lib/pedidos/catalogo";
import { Tienda } from "./_components/tienda";
import type { CategoriaCatalogo, ConfigTienda } from "./_lib/tipos";

// Catálogo público de pedidos online. Nadie necesita sesión para entrar acá
// (ver la exclusión en src/lib/supabase/middleware.ts).
//
// Usa createAdminClient() (service role) igual que el resto del admin --
// acá no hay ninguna sesión de la que depender. Nunca se lee/muestra costo ni
// margen. La carga de datos y el filtrado (categorias_habilitadas/
// promos_habilitadas/vendible_pos) son 100% server-side: el Client Component
// solo recibe el catálogo ya resuelto y NUNCA manda precios de vuelta (el
// servidor los vuelve a resolver al confirmar el pedido).

export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ sucursal: string }> }): Promise<Metadata> {
  const { sucursal } = await params;
  const admin = createAdminClient();
  const { data } = await admin.from("sucursales").select("nombre").eq("id", sucursal).single();
  return { title: data ? `Pedí en ${data.nombre}` : "Pedí online" };
}

export default async function PedirPage({ params }: { params: Promise<{ sucursal: string }> }) {
  const { sucursal: sucursalId } = await params;
  const admin = createAdminClient();

  // (admin as any): las columnas de config de pedidos online (migración 094)
  // y categorias_habilitadas/promos_habilitadas (088/089) todavía no están en
  // los tipos generados -- mismo patrón que el resto del proyecto.
  const { data: sucursal } = await (admin as any)
    .from("sucursales")
    .select("id, nombre, direccion, localidad, is_active, categorias_habilitadas, promos_habilitadas, pedidos_online_habilitado, delivery_habilitado, retiro_habilitado, pedido_minimo_envio, retiro_eta_min, retiro_eta_max, whatsapp_pedidos, horario_pedidos")
    .eq("id", sucursalId)
    .single();

  if (!sucursal || !sucursal.is_active) notFound();

  const [catalogoSucursal, { data: zonasRaw }] = await Promise.all([
    cargarCatalogoSucursal(admin, sucursalId, {
      categoriasHabilitadas: sucursal.categorias_habilitadas ?? null,
      promosHabilitadas: sucursal.promos_habilitadas ?? true,
    }),
    (admin as any)
      .from("zonas_entrega")
      .select("id, nombre, costo, eta_min, eta_max")
      .eq("sucursal_id", sucursalId)
      .eq("is_active", true)
      .order("orden")
      .order("costo"),
  ]);

  const catalogo: CategoriaCatalogo[] = catalogoSucursal.grupos.map((g) => ({
    id: g.id,
    name: g.name,
    items: g.items.map((i) => ({
      id: i.id, esPromo: i.esPromo, name: i.name, price: i.price, image: i.image,
      badge: i.etiqueta, unit: i.unidad,
      categoriaId: g.id, categoriaNombre: g.name,
    })),
  }));

  const config: ConfigTienda = {
    sucursalId,
    nombre: sucursal.nombre,
    direccion: sucursal.direccion ?? null,
    localidad: sucursal.localidad ?? null,
    habilitado: !!sucursal.pedidos_online_habilitado,
    retiroHabilitado: sucursal.retiro_habilitado ?? true,
    deliveryHabilitado: !!sucursal.delivery_habilitado,
    minimoEnvio: Number(sucursal.pedido_minimo_envio ?? 0),
    retiroEtaMin: sucursal.retiro_eta_min ?? 15,
    retiroEtaMax: sucursal.retiro_eta_max ?? 20,
    whatsapp: sucursal.whatsapp_pedidos ?? null,
    horario: normalizarHorario(sucursal.horario_pedidos),
    zonas: ((zonasRaw ?? []) as any[]).map((z) => ({
      id: z.id, nombre: z.nombre, costo: Number(z.costo), etaMin: z.eta_min, etaMax: z.eta_max,
    })),
  };

  return <Tienda config={config} catalogo={catalogo} />;
}
