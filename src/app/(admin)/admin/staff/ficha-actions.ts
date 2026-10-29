"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { permisosTesoreria } from "@/lib/tesoreria/permisos";
import { registrarHistorial } from "@/lib/tesoreria/historial";
import { cambiosDeFicha, validarFichaPersonal, type FichaEntrada } from "@/lib/personal/ficha";
import { cargarFichaPersonal, esTablaFichaFaltante } from "@/lib/personal/ficha-consultas";

// Ficha del personal (migración 130). Mismas convenciones que Tesorería: devuelve { error } en vez de lanzar (Next oculta el mensaje de un
// throw en producción), escribe solo el servidor (service_role) y verifica el permiso acá: cargar = administrativo de Tesorería, porque
// la ficha trae sueldo, CUIL y CBU.
type Resultado = { error?: string };

const SIN_PERMISO = "Solo el administrativo de Tesorería puede cargar la ficha del personal";
const SIN_MIGRACION = "Falta aplicar la migración 130 de la base de datos";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function guardarFichaPersonal(personaId: string, entrada: FichaEntrada): Promise<Resultado> {
  try {
    const permisos = await permisosTesoreria();
    if (!permisos?.puedeCargar) return { error: SIN_PERMISO };
    if (!UUID_RE.test(personaId)) return { error: "No se encontró a esa persona" };

    const validado = validarFichaPersonal(entrada);
    if ("error" in validado) return { error: validado.error };
    const v = validado.valor;

    const admin = createAdminClient();
    const { data: persona } = await admin.from("profiles").select("id, full_name").eq("id", personaId).maybeSingle();
    if (!persona) return { error: "No se encontró a esa persona" };

    let previo;
    try {
      previo = await cargarFichaPersonal(admin, personaId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: esTablaFichaFaltante(msg) ? SIN_MIGRACION : msg };
    }
    const cambios = cambiosDeFicha(previo.existe ? previo.ficha : null, v);
    if (previo.existe && Object.keys(cambios).length === 0) return {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).from("personal_ficha").upsert(
      previo.existe
        ? { persona_id: personaId, ...v, updated_by: permisos.userId, updated_at: new Date().toISOString() }
        : { persona_id: personaId, ...v, created_by: permisos.userId },
      { onConflict: "persona_id" },
    );
    if (error) {
      const msg: string = error.message ?? "";
      if (esTablaFichaFaltante(msg)) return { error: SIN_MIGRACION };
      if (/personal_ficha_cuil_uni/.test(msg)) return { error: "Ya hay otra persona con ese CUIL" };
      if (/personal_ficha_legajo_uni/.test(msg)) return { error: "Ya hay otra persona con ese número de legajo" };
      return { error: msg || "No se pudo guardar la ficha" };
    }

    const historial = await registrarHistorial(admin, {
      usuario_id: permisos.userId, accion: "persona_ficha", entidad_id: personaId,
      // Sueldo, CUIL y CBU son sensibles: el historial guarda qué campos cambiaron, no sus valores.
      detalle: { persona: (persona.full_name ?? "").trim() || "Sin nombre", alta: !previo.existe, campos: Object.keys(cambios) },
    });
    revalidatePath(`/admin/staff/${personaId}`);
    revalidatePath("/admin/tesoreria");
    if (historial.error) {
      console.error("[personal] no se pudo anotar en el historial:", historial.error);
      return { error: "Se guardó, pero no quedó anotado en el historial. Avisale al administrador del sistema." };
    }
    return {};
  } catch (e) {
    console.error("[personal] guardarFichaPersonal falló:", e);
    return { error: `No se pudo guardar: ${e instanceof Error ? e.message : String(e)}` };
  }
}
