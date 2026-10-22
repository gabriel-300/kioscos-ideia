import type { createAdminClient } from "@/lib/supabase/server";
import { normalizarHorario } from "@/lib/pedidos/horario";
import { cargarCatalogoSucursal } from "@/lib/pedidos/catalogo";
import { leerOcultosOnline } from "@/lib/pedidos/catalogo-online";
import { nombrePresentable } from "@/lib/pedidos/nombres-cliente";
import { nombreCategoriaCliente, ordenarCategoriasCliente } from "@/lib/pedidos/categorias-cliente";
import { elegirMasPedidos, leerMasPedidos } from "@/lib/pedidos/mas-pedidos";
import { leerDestacadoOnline, type DestacadoOnline } from "@/lib/pedidos/destacado-online";
import { clienteDeLaSesion, esPrimeraCompra, leerConfigBeneficio } from "@/lib/pedidos/beneficio-servidor";
import type { CategoriaCatalogo, ConfigTienda } from "@/app/pedir/[sucursal]/_lib/tipos";

// Carga todo lo que necesita el catálogo público de un local: su configuración y el menú
// ya resuelto (stock, categorías y promos habilitadas, precios de la sucursal). Lo usan la
// tienda (/pedir/[sucursal]) y el fondo de la pantalla "¿Dónde querés pedir?".
//
// Usa el cliente de servicio: acá no hay sesión de la que depender. Nunca se lee costo ni
// margen. El Client Component solo recibe el resultado y NUNCA manda precios de vuelta (el
// servidor los vuelve a resolver al confirmar el pedido).

type Admin = ReturnType<typeof createAdminClient>;
type ClienteSesion = Awaited<ReturnType<typeof clienteDeLaSesion>>;

export async function cargarTienda(
  admin: Admin,
  sucursalId: string,
  cliente: ClienteSesion = null,
): Promise<{ config: ConfigTienda; catalogo: CategoriaCatalogo[]; masPedidos: string[]; destacado: DestacadoOnline } | null> {
  // (admin as any): las columnas de config de pedidos online (migración 094)
  // y categorias_habilitadas/promos_habilitadas (088/089) todavía no están en
  // los tipos generados -- mismo patrón que el resto del proyecto.
  const { data: sucursal } = await (admin as any)
    .from("sucursales")
    .select("id, nombre, direccion, localidad, is_active, categorias_habilitadas, promos_habilitadas, pedidos_online_habilitado, delivery_habilitado, retiro_habilitado, pedido_minimo_envio, retiro_eta_min, retiro_eta_max, whatsapp_pedidos, horario_pedidos")
    .eq("id", sucursalId)
    .single();

  if (!sucursal || !sucursal.is_active) return null;

  const ocultos = await leerOcultosOnline(admin, sucursalId);
  const [catalogoSucursal, { data: zonasRaw }, beneficio, primeraCompra] = await Promise.all([
    cargarCatalogoSucursal(admin, sucursalId, {
      categoriasHabilitadas: sucursal.categorias_habilitadas ?? null,
      promosHabilitadas: sucursal.promos_habilitadas ?? true,
      productosOcultos: ocultos.productos,
      promosOcultas: ocultos.promos,
    }),
    (admin as any)
      .from("zonas_entrega")
      .select("id, nombre, costo, eta_min, eta_max")
      .eq("sucursal_id", sucursalId)
      .eq("is_active", true)
      .order("orden")
      .order("costo"),
    leerConfigBeneficio(admin, sucursalId),
    cliente ? esPrimeraCompra(admin, cliente.id) : Promise.resolve(false),
  ]);

  // Presentación para el cliente: categorías con nombre de comida y en el orden que apetece, y nombres
  // de producto escritos como frase (el nombre real no se toca).
  const catalogo: CategoriaCatalogo[] = ordenarCategoriasCliente(catalogoSucursal.grupos).map((g) => {
    const nombreCategoria = nombreCategoriaCliente(g.name);
    return {
      id: g.id,
      name: nombreCategoria,
      // Lo que tiene foto va primero: una vidriera arranca con lo que da ganas de pedir.
      items: g.items
        .map((i) => ({
          id: i.id, esPromo: i.esPromo, name: nombrePresentable(i.name), price: i.price, image: i.image,
          // "RECETA" es cosa del stock (cómo se descuentan los ingredientes): al cliente le es un producto más.
          badge: i.etiqueta === "RECETA" ? undefined : i.etiqueta, unit: i.unidad, descripcion: i.descripcion,
          categoriaId: g.id, categoriaNombre: nombreCategoria,
        }))
        .sort((x, y) => Number(!!y.image) - Number(!!x.image)),
    };
  });

  // "Lo más pedido": lo más vendido que hoy se puede pedir y tiene foto.
  const masPedidos = elegirMasPedidos(await leerMasPedidos(admin, sucursalId), catalogo.flatMap((g) => g.items));

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
    beneficio,
    cliente: cliente ? { nombre: cliente.nombre, telefono: cliente.telefono, primeraCompra } : null,
  };

  return { config, catalogo, masPedidos, destacado: await leerDestacadoOnline(admin, sucursalId) };
}
