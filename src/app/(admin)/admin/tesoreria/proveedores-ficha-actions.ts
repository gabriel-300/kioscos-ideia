"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { permisosTesoreria } from "@/lib/tesoreria/permisos";
import { registrarHistorial } from "@/lib/tesoreria/historial";
import { nombresParecidos, validarFicha, type FichaEntrada, type FichaValidada } from "@/lib/tesoreria/proveedores-ficha";

// Ficha contable del proveedor (migración 116). Mismas convenciones que el resto de Tesorería: devuelven { error } en vez de lanzar,
// escribe solo el servidor (service_role) y cada acción verifica el permiso acá (cargar = administrativo de Tesorería).
// `parecidos`: ya hay proveedores con un nombre parecido; la pantalla los muestra y, si es otro de verdad, reenvía con
// confirmarParecidos = true (los nombres idénticos nunca se aceptan: son el mismo proveedor).
type Resultado = { error?: string; id?: string; parecidos?: { id: string; nombre: string }[] };

const SIN_PERMISO = "Solo el administrativo de Tesorería puede cargar proveedores";
const SIN_MIGRACION = "Falta aplicar la migración 116 de la base de datos";
const faltaMigracion = (m: string) => /column .*(cuit|condicion_iva|da_factura|rubro|forma_pago|alias_cbu|razon_social|email|notas)/i.test(m) && /does not exist|schema cache/i.test(m);

const CAMPOS = ["nombre", "razon_social", "cuit", "condicion_iva", "da_factura", "rubro", "forma_pago", "plazo_pago_dias", "alias_cbu", "contacto", "email", "notas"] as const;

// Un error de índice único se traduce a un mensaje que diga con quién choca.
async function mensajeDeDuplicado(admin: ReturnType<typeof createAdminClient>, msg: string, v: FichaValidada, excluirId?: string): Promise<string | null> {
  if (/proveedores_cuit_uni/.test(msg) && v.cuit) {
    const { data } = await admin.from("proveedores").select("id, nombre").eq("cuit", v.cuit).limit(2);
    const otro = (data ?? []).find((p: { id: string }) => p.id !== excluirId);
    return `Ya hay un proveedor con ese CUIT${otro ? `: «${otro.nombre}»` : ""}. Si es el mismo, usá ese.`;
  }
  if (/proveedores_nombre_uni|duplicate key/i.test(msg)) return "Ya hay un proveedor con ese nombre. Si es el mismo, usá ese.";
  return null;
}

async function listarNombres(admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.from("proveedores").select("id, nombre");
  return (data ?? []) as { id: string; nombre: string }[];
}

export async function crearProveedorFicha(entrada: FichaEntrada, confirmarParecidos = false): Promise<Resultado> {
  try {
    const permisos = await permisosTesoreria();
    if (!permisos?.puedeCargar) return { error: SIN_PERMISO };

    const validado = validarFicha(entrada);
    if ("error" in validado) return { error: validado.error };
    const v = validado.valor;

    const admin = createAdminClient();
    const { iguales, parecidos } = nombresParecidos(v.nombre, await listarNombres(admin));
    if (iguales.length > 0) return { error: `Ya existe el proveedor «${iguales[0].nombre}». Usá ese en lugar de crear otro.`, id: iguales[0].id };
    if (parecidos.length > 0 && !confirmarParecidos) {
      return { error: `Ya hay ${parecidos.length === 1 ? "un proveedor con un nombre parecido" : "proveedores con nombres parecidos"}: ${parecidos.map((p) => `«${p.nombre}»`).join(", ")}. Si es otro, confirmalo.`, parecidos };
    }

    const { data: creado, error } = await admin.from("proveedores")
      .insert({ ...v, modo_facturacion: "costo", created_by: permisos.userId }).select("id").single();
    if (error || !creado) {
      const msg = error?.message ?? "";
      if (faltaMigracion(msg)) return { error: SIN_MIGRACION };
      return { error: (await mensajeDeDuplicado(admin, msg, v)) ?? (msg || "No se pudo guardar el proveedor") };
    }

    const historial = await registrarHistorial(admin, {
      usuario_id: permisos.userId, accion: "proveedor_ficha", entidad_id: creado.id,
      detalle: { proveedor: v.nombre, alta: true, cuit: v.cuit },
    });
    revalidatePath("/admin/tesoreria");
    revalidatePath("/admin/proveedores");
    if (historial.error) {
      console.error("[tesoreria] no se pudo anotar en el historial:", historial.error);
      return { error: "Se guardó, pero no quedó anotado en el historial. Avisale al administrador del sistema.", id: creado.id };
    }
    return { id: creado.id };
  } catch (e) {
    console.error("[tesoreria] crearProveedorFicha falló:", e);
    return { error: `No se pudo guardar: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function actualizarProveedorFicha(id: string, entrada: FichaEntrada, confirmarParecidos = false): Promise<Resultado> {
  try {
    const permisos = await permisosTesoreria();
    if (!permisos?.puedeCargar) return { error: SIN_PERMISO };

    const validado = validarFicha(entrada);
    if ("error" in validado) return { error: validado.error };
    const v = validado.valor;

    const admin = createAdminClient();
    const { data: previo, error: errLeer } = await admin.from("proveedores")
      .select("id, nombre, razon_social, cuit, condicion_iva, da_factura, rubro, forma_pago, plazo_pago_dias, alias_cbu, contacto, email, notas")
      .eq("id", id).maybeSingle();
    if (errLeer && faltaMigracion(errLeer.message)) return { error: SIN_MIGRACION };
    if (!previo) return { error: "Ese proveedor no existe. Recargá la pantalla." };

    const { iguales, parecidos } = nombresParecidos(v.nombre, await listarNombres(admin), id);
    if (iguales.length > 0) return { error: `Ya existe otro proveedor llamado «${iguales[0].nombre}». Si es el mismo, usá ese.` };
    if (parecidos.length > 0 && !confirmarParecidos && v.nombre !== previo.nombre) {
      return { error: `Ya hay ${parecidos.length === 1 ? "un proveedor con un nombre parecido" : "proveedores con nombres parecidos"}: ${parecidos.map((p) => `«${p.nombre}»`).join(", ")}. Si es otro, confirmalo.`, parecidos };
    }

    const cambios: Record<string, { antes: string | number | null; despues: string | number | null }> = {};
    for (const c of CAMPOS) {
      const antes = (previo as Record<string, unknown>)[c] ?? null;
      const despues = v[c] ?? null;
      if (antes !== despues) cambios[c] = { antes: antes as string | number | null, despues: despues as string | number | null };
    }
    if (Object.keys(cambios).length === 0) return {};

    const { error } = await admin.from("proveedores").update({ ...v, updated_by: permisos.userId }).eq("id", id);
    if (error) {
      if (faltaMigracion(error.message)) return { error: SIN_MIGRACION };
      return { error: (await mensajeDeDuplicado(admin, error.message, v, id)) ?? error.message };
    }

    const historial = await registrarHistorial(admin, {
      usuario_id: permisos.userId, accion: "proveedor_ficha", entidad_id: id,
      detalle: { proveedor: v.nombre, cambios },
    });
    revalidatePath("/admin/tesoreria");
    revalidatePath("/admin/proveedores");
    if (historial.error) {
      console.error("[tesoreria] no se pudo anotar en el historial:", historial.error);
      return { error: "Se guardó, pero no quedó anotado en el historial. Avisale al administrador del sistema." };
    }
    return {};
  } catch (e) {
    console.error("[tesoreria] actualizarProveedorFicha falló:", e);
    return { error: `No se pudo guardar: ${e instanceof Error ? e.message : String(e)}` };
  }
}
