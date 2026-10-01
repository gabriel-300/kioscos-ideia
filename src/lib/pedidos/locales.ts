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
};

type Fila = {
  id: string; nombre: string; direccion: string | null; localidad: string | null;
  horario_pedidos: unknown; delivery_habilitado: boolean | null; retiro_habilitado: boolean | null;
};

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
    };
  });
}

export async function cargarLocalesParaPedir(admin: Admin): Promise<LocalParaPedir[]> {
  const { data } = await (admin as any)
    .from("sucursales")
    .select("id, nombre, direccion, localidad, horario_pedidos, delivery_habilitado, retiro_habilitado")
    .eq("is_active", true)
    .eq("pedidos_online_habilitado", true)
    .order("nombre");
  return armarLocales((data ?? []) as Fila[]);
}
