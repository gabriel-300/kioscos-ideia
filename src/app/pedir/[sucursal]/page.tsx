import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { clienteDeLaSesion } from "@/lib/pedidos/beneficio-servidor";
import { cargarTienda } from "@/lib/pedidos/tienda-servidor";
import { cargarLocalesParaPedir } from "@/lib/pedidos/locales";
import { Tienda } from "./_components/tienda";

// Catálogo público de pedidos online. Nadie necesita sesión para entrar acá
// (ver la exclusión en src/lib/supabase/middleware.ts). La carga de datos y el
// filtrado viven en cargarTienda (100% server-side).

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

  // Cliente registrado (si ingresó con Google) y beneficios de la sucursal.
  const user = await getUser();
  const cliente = await clienteDeLaSesion(admin, user?.id);

  const tienda = await cargarTienda(admin, sucursalId, cliente);
  if (!tienda) notFound();

  // Si esta sucursal todavía no recibe pedidos online (un QR o enlace viejo), se le muestra al cliente dónde sí puede pedir.
  // No se lo manda solo a otro local: tendría que retirar en un lugar distinto al que creía.
  const otrosLocales = tienda.config.habilitado ? [] : (await cargarLocalesParaPedir(admin)).filter((l) => l.id !== sucursalId).map((l) => ({ id: l.id, nombre: l.nombre.trim() }));

  return <Tienda config={{ ...tienda.config, sesionActiva: !!user }} catalogo={tienda.catalogo} masPedidos={tienda.masPedidos} destacados={tienda.destacados} otrosLocales={otrosLocales} />;
}
