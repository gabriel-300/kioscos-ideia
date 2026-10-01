import type { createAdminClient } from "@/lib/supabase/server";
import { estadoHorario, normalizarHorario } from "./horario";

// Locales donde un cliente puede pedir online. Alimenta la pantalla /pedir ("¿Dónde
// querés pedir?"), a la que lleva la raíz del dominio de clientes.

type Admin = ReturnType<typeof createAdminClient>;

export type LocalParaPedir = {
  id:             string;
  nombre:         string;
  direccion:      string | null;
  localidad:      string | null;
  abierto:        boolean;
  proximaApertura: string | null;
  conEnvio:       boolean;
  conRetiro:      boolean;
  latitud:        number | null;
  longitud:       number | null;
};

type Fila = {
  id: string; nombre: string; direccion: string | null; localidad: string | null;
  horario_pedidos: unknown; delivery_habilitado: boolean | null; retiro_habilitado: boolean | null;
  latitud?: number | string | null; longitud?: number | string | null; // migración 100
};

// numeric llega como número o texto según el cliente; cualquier cosa rara = sin coordenadas.
function coordenada(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Puro: de las filas de la base al formato de la pantalla. Sin horario cargado el
// local figura siempre abierto (igual que en el catálogo y al confirmar el pedido).
export function armarLocales(filas: Fila[], ahora = new Date()): LocalParaPedir[] {
  return filas.map((f) => {
    const horario = estadoHorario(normalizarHorario(f.horario_pedidos), ahora);
    return {
      id: f.id,
      nombre: f.nombre,
      direccion: f.direccion ?? null,
      localidad: f.localidad ?? null,
      abierto: horario.abierto,
      proximaApertura: horario.proximaApertura ?? null,
      conEnvio: !!f.delivery_habilitado,
      conRetiro: f.retiro_habilitado ?? true,
      latitud: coordenada(f.latitud),
      longitud: coordenada(f.longitud),
    };
  });
}

const COLUMNAS = "id, nombre, direccion, localidad, horario_pedidos, delivery_habilitado, retiro_habilitado";

// Tolerante a que la migración 100 no esté aplicada (mismo criterio que
// beneficio-servidor.ts): si pedir latitud/longitud falla, se vuelve a leer sin
// ellas y los locales salen "sin coordenadas" en vez de romper la pantalla.
export async function cargarLocalesParaPedir(admin: Admin): Promise<LocalParaPedir[]> {
  const leer = (columnas: string) =>
    (admin as any)
      .from("sucursales")
      .select(columnas)
      .eq("is_active", true)
      .eq("pedidos_online_habilitado", true)
      .order("nombre");
  let { data, error } = await leer(`${COLUMNAS}, latitud, longitud`);
  if (error) ({ data } = await leer(COLUMNAS));
  return armarLocales((data ?? []) as Fila[]);
}

// Coordenadas de una sucursal para el formulario de Tenteo; null si no hay o la
// migración 100 todavía no está aplicada.
export async function leerCoordenadasSucursal(admin: Admin, sucursalId: string): Promise<{ lat: number; lng: number } | null> {
  const { data } = await (admin as any).from("sucursales").select("latitud, longitud").eq("id", sucursalId).maybeSingle();
  const lat = coordenada(data?.latitud);
  const lng = coordenada(data?.longitud);
  return lat !== null && lng !== null ? { lat, lng } : null;
}
