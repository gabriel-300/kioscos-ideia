import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { clienteDeLaSesion } from "@/lib/pedidos/beneficio-servidor";
import { personalDeSucursal } from "@/lib/pedidos/personal-sesion";
import { cargarTienda } from "@/lib/pedidos/tienda-servidor";
import { cargarLocalesParaPedir } from "@/lib/pedidos/locales";
import { Tienda } from "./_components/tienda";
import { JsonLd } from "@/components/json-ld";
import { cargarLocalesSeo, resolverSucursalId } from "@/lib/pedidos/seo-servidor";
import { descripcionLocal, IMAGEN_COMPARTIR, jsonLdLocal, nombreLimpio, rutaLocal } from "@/lib/pedidos/seo";

// Catálogo público de pedidos online. Nadie necesita sesión para entrar acá
// (ver la exclusión en src/lib/supabase/middleware.ts). La carga de datos y el
// filtrado viven en cargarTienda (100% server-side).

export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ sucursal: string }> }): Promise<Metadata> {
  const { sucursal: parametro } = await params;
  const admin = createAdminClient();
  const sucursal = await resolverSucursalId(admin, parametro);
  const { data } = sucursal ? await (admin as any).from("sucursales").select("nombre, direccion, is_active, pedidos_online_habilitado").eq("id", sucursal).single() : { data: null };
  // Una sucursal apagada (o que no existe) no debe aparecer en Google: queda solo para quien tenga el enlace.
  if (!data?.is_active || !data.pedidos_online_habilitado) {
    return { title: data ? `Pedí en ${nombreLimpio(data.nombre)}` : "Pedí online", robots: { index: false, follow: false } };
  }
  // Una sola dirección para Google (angirufood.com.ar/unam), llegue por la corta o por la del id.
  const titulo = `${nombreLimpio(data.nombre)} · Panadería, confitería y delicatessen en Posadas`;
  const descripcion = descripcionLocal(data);
  const ruta = rutaLocal(data.nombre);
  return {
    title: { absolute: titulo },
    description: descripcion,
    alternates: { canonical: ruta },
    openGraph: { type: "website", locale: "es_AR", siteName: "Angiru Food", title: titulo, description: descripcion, url: ruta, images: [{ url: IMAGEN_COMPARTIR, width: 1200, height: 630, alt: "Angiru Food" }] },
    twitter: { card: "summary_large_image", title: titulo, description: descripcion, images: [IMAGEN_COMPARTIR] },
  };
}

export default async function PedirPage({ params }: { params: Promise<{ sucursal: string }> }) {
  const { sucursal: parametro } = await params;
  const admin = createAdminClient();

  // Llega por el id (los enlaces de siempre) o por la dirección corta del local (angirufood.com.ar/unam).
  const sucursalId = await resolverSucursalId(admin, parametro);
  if (!sucursalId) notFound();

  // Cliente registrado (si ingresó con Google) y beneficios de la sucursal.
  const user = await getUser();
  const cliente = await clienteDeLaSesion(admin, user?.id);

  const tienda = await cargarTienda(admin, sucursalId, cliente);
  if (!tienda) notFound();

  // Si esta sucursal todavía no recibe pedidos online (un QR o enlace viejo), se le muestra al cliente dónde sí puede pedir.
  // No se lo manda solo a otro local: tendría que retirar en un lugar distinto al que creía.
  const otrosLocales = tienda.config.habilitado ? [] : (await cargarLocalesParaPedir(admin)).filter((l) => l.id !== sucursalId).map((l) => ({ id: l.id, nombre: l.nombre.trim() }));

  const localesSeo = await cargarLocalesSeo(admin);
  const datosLocal = localesSeo.find((l) => l.id === sucursalId);

  return <><Tienda config={{ ...tienda.config, sesionActiva: !!user, puedeEfectivo: !!cliente || (await personalDeSucursal(admin, user, sucursalId)),
    ubicacionLocal: datosLocal && datosLocal.latitud !== null && datosLocal.longitud !== null ? { lat: datosLocal.latitud, lng: datosLocal.longitud } : null,
    localesCercania: localesSeo.map((l) => ({ id: l.id, slug: l.slug, nombre: l.nombre.trim(), latitud: l.latitud, longitud: l.longitud })) }} catalogo={tienda.catalogo} masPedidos={tienda.masPedidos} destacados={tienda.destacados} disponibilidad={tienda.disponibilidad} otrosLocales={otrosLocales} />{datosLocal && <JsonLd datos={jsonLdLocal(datosLocal)} />}</>;
}
