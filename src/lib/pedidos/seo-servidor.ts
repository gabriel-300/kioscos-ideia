import type { createAdminClient } from "@/lib/supabase/server";
import { normalizarHorario, type TramoHorario } from "./horario";
import { slugDeSucursal, type DatosLocalSeo } from "./seo";

// Datos de los locales para el posicionamiento (sitemap, portada, páginas de cada local). Sin "use server".
// Tolerante a que la migración 100 (coordenadas) no esté aplicada, igual que locales.ts.

type Admin = ReturnType<typeof createAdminClient>;

export type LocalSeo = DatosLocalSeo & { id: string; slug: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNAS = "id, nombre, direccion, localidad, whatsapp_pedidos, horario_pedidos";

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Locales donde hoy se puede pedir online (los únicos que tienen que figurar en Google).
export async function cargarLocalesSeo(admin: Admin): Promise<LocalSeo[]> {
  const leer = (columnas: string) =>
    (admin as any).from("sucursales").select(columnas).eq("is_active", true).eq("pedidos_online_habilitado", true).order("nombre");
  let { data, error } = await leer(`${COLUMNAS}, latitud, longitud`);
  if (error) ({ data } = await leer(COLUMNAS));
  return ((data ?? []) as any[]).map((f) => ({
    id: f.id,
    slug: slugDeSucursal(f.nombre),
    nombre: f.nombre,
    direccion: f.direccion ?? null,
    localidad: f.localidad ?? null,
    telefono: f.whatsapp_pedidos ?? null,
    horario: normalizarHorario(f.horario_pedidos),
    latitud: numero(f.latitud),
    longitud: numero(f.longitud),
  }));
}

// /pedir/<uuid> (los enlaces de siempre) o /pedir/<dirección corta> (angirufood.com.ar/unam): devuelve el id del
// local, o null si no existe o hoy no recibe pedidos.
export async function resolverSucursalId(admin: Admin, parametro: string): Promise<string | null> {
  if (UUID.test(parametro)) return parametro;
  const locales = await cargarLocalesSeo(admin);
  return locales.find((l) => l.slug === parametro.toLowerCase())?.id ?? null;
}

export type LocalProximo = { nombre: string; direccion: string | null; localidad: string | null; horario: TramoHorario[] | null };

// Locales de Angiru Food activos que todavía NO reciben pedidos online: la portada los muestra como "Próximamente",
// sin menú. Solo los que se llaman "Angiru Food ..." (los otros locales activos son de otras marcas del grupo).
export async function cargarLocalesProximos(admin: Admin): Promise<LocalProximo[]> {
  const { data } = await (admin as any)
    .from("sucursales").select("nombre, direccion, localidad, horario_pedidos")
    .eq("is_active", true).eq("pedidos_online_habilitado", false).ilike("nombre", "angiru food%").order("nombre");
  return ((data ?? []) as { nombre: string; direccion: string | null; localidad: string | null; horario_pedidos: unknown }[]).map((f) => ({
    nombre: f.nombre, direccion: f.direccion ?? null, localidad: f.localidad ?? null, horario: normalizarHorario(f.horario_pedidos),
  }));
}
