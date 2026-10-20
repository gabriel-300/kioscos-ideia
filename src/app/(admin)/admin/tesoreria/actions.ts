"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { permisosTesoreria } from "@/lib/tesoreria/permisos";
import { cargarConfig } from "@/lib/tesoreria/consultas";
import { cargarCuentaDe } from "@/lib/tesoreria/proveedores-consultas";
import { MONTO_MAX, fechaValida, validarEgreso, validarPago } from "@/lib/tesoreria/validaciones";
import type { EgresoEntrada } from "@/lib/tesoreria/tipos";
import { registrarHistorial, type EntradaHistorial } from "@/lib/tesoreria/historial";
import { fechaHoyAR } from "@/lib/fecha";
import { redondearMoneda } from "@/lib/pedidos/pricing";

// Convención del módulo (architecture.md §2 y §9): las acciones devuelven { error } en vez de lanzar, porque
// Next.js oculta el mensaje de un throw en producción. Escribe solo el servidor (service_role), por eso cada acción
// verifica el permiso acá: cargar = admin con es_administrativo (lib/tesoreria/permisos.ts).

type Resultado = { error?: string };

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const dma = (f: string) => f.split("-").reverse().join("/");

const SIN_PERMISO = "Solo el administrativo de Tesorería puede cargar movimientos";
const SIN_MIGRACION = "Falta aplicar la migración 101 de la base de datos";
const SIN_MIGRACION_113 = "Falta aplicar la migración 113 de la base de datos (vencimiento de remitos)";
const falta113 = (m: string | undefined) => !!m && m.includes("fecha_vencimiento");

async function exigirCargar() {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeCargar) return null;
  return permisos;
}

function refrescar() {
  revalidatePath("/admin/tesoreria");
}

// Anota en el historial (migración 104) lo que se acaba de hacer. Cada acción lo llama DESPUÉS de guardar el cambio: si no se
// pudo anotar, el cambio ya está hecho, así que se avisa con claridad para que no pase desapercibido.
async function anotar(admin: ReturnType<typeof createAdminClient>, e: EntradaHistorial): Promise<Resultado> {
  const r = await registrarHistorial(admin, e);
  if (r.error) {
    console.error("[tesoreria] no se pudo anotar en el historial:", r.error);
    return { error: "El cambio se guardó, pero no quedó anotado en el historial. Avisale al administrador del sistema." };
  }
  return {};
}

// ── Registrar un egreso ──────────────────────────────────────────────────────
// Puede venir de un retiro de caja y/o de entregas que cargó el kiosco: en ese caso el egreso las "toma" (les
// pone egreso_id) y dejan de aparecer en "Para registrar".
export async function registrarEgreso(entrada: EgresoEntrada): Promise<Resultado> {
  // Next.js oculta el mensaje de un throw en producción: se atrapa para que el formulario muestre la causa real.
  try {
    return await guardarEgreso(entrada);
  } catch (e) {
    console.error("[tesoreria] registrarEgreso falló:", e);
    return { error: `No se pudo guardar: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function guardarEgreso(entrada: EgresoEntrada): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };

  const validado = validarEgreso(entrada, fechaHoyAR());
  if ("error" in validado) return { error: validado.error };
  const e = validado.valor;

  const admin = createAdminClient();
  const config = await cargarConfig(admin);
  if (!config) return { error: SIN_MIGRACION };

  const { data: sucursales } = await admin.from("sucursales").select("id").eq("entra_en_tesoreria", true);
  const idsValidos = new Set<string>((sucursales ?? []).map((s: { id: string }) => s.id));
  if (e.sucursal_id && !idsValidos.has(e.sucursal_id)) return { error: "Esa sucursal no entra en Tesorería" };

  // Cuenta corriente del proveedor: lo anterior al corte del saldo inicial ya está incluido en ese saldo (cargarlo lo contaría dos
  // veces) y el mismo remito no se carga dos veces. La validación pura ya exigió kiosco cuando hay proveedor.
  if (e.proveedor_id && e.sucursal_id) {
    const { fechaCorte } = await cargarCuentaDe(admin, e.proveedor_id, e.sucursal_id);
    if (fechaCorte && e.fecha <= fechaCorte) {
      return { error: `El saldo inicial de este proveedor en ese kiosco es del ${dma(fechaCorte)}: lo comprado hasta esa fecha ya está incluido en ese saldo. Cargá solo remitos posteriores.` };
    }
    if (e.comprobante_numero) {
      const { data: repetido } = await admin.from("egresos").select("id, fecha, monto")
        .eq("proveedor_id", e.proveedor_id).eq("sucursal_id", e.sucursal_id).eq("comprobante_numero", e.comprobante_numero)
        .is("anulado_en", null).limit(1);
      if (repetido && repetido.length > 0) {
        return { error: `Ya está cargado el remito o factura N° ${e.comprobante_numero} de este proveedor en ese kiosco (${dma(repetido[0].fecha)}, ${AR.format(Number(repetido[0].monto))}). Si es otro comprobante, anotalo con otro número.` };
      }
    }
  }

  // Lo que se va a tomar tiene que existir, ser de un local de Tesorería y no estar ya registrado.
  if (e.retiros_caja_ids.length > 0) {
    const { data } = await admin.from("retiros_caja").select("id, sucursal_id")
      .in("id", e.retiros_caja_ids).is("egreso_id", null).is("proveedor_cuenta_id", null);
    const ok = (data ?? []).filter((r: { sucursal_id: string }) => idsValidos.has(r.sucursal_id));
    if (ok.length !== e.retiros_caja_ids.length) return { error: "Algún retiro de caja ya fue registrado o no corresponde. Recargá la pantalla." };
  }
  if (e.entregas_ids.length > 0) {
    const { data } = await admin.from("movimientos").select("id, sucursal_id")
      .in("id", e.entregas_ids).eq("tipo", "entrega").is("anulado_en", null).is("egreso_id", null).is("tesoreria_descartado_en", null);
    const ok = (data ?? []).filter((r: { sucursal_id: string }) => idsValidos.has(r.sucursal_id));
    if (ok.length !== e.entregas_ids.length) return { error: "Alguna entrega ya fue registrada o no corresponde. Recargá la pantalla." };
  }

  const { retiros_caja_ids, entregas_ids, ...fila } = e;
  const { data: creado, error } = await admin.from("egresos")
    .insert({ ...fila, created_by: permisos.userId }).select("id").single();
  if (error?.message.includes("egresos_remito_unico")) {
    return { error: `Ya está cargado el remito o factura N° ${e.comprobante_numero ?? ""} de este proveedor en ese kiosco. Recargá la pantalla para verlo.` };
  }
  if (falta113(error?.message)) return { error: SIN_MIGRACION_113 };
  if (error || !creado) return { error: error?.message ?? "No se pudo guardar el egreso" };

  // Tomar lo del kiosco. El filtro `egreso_id is null` evita pisar a otro administrativo que lo tomó en el medio.
  const tomar = async (tabla: "retiros_caja" | "movimientos", ids: string[]) => {
    if (ids.length === 0) return true;
    const { data } = await admin.from(tabla).update({ egreso_id: creado.id }).in("id", ids).is("egreso_id", null).select("id");
    return (data ?? []).length === ids.length;
  };
  const tomoRetiros  = await tomar("retiros_caja", retiros_caja_ids);
  const tomoEntregas = await tomar("movimientos", entregas_ids);
  if (!tomoRetiros || !tomoEntregas) {
    // Compensación: este egreso recién creado nunca llegó a verse; se suelta lo que alcanzó a tomar y se borra.
    await admin.from("retiros_caja").update({ egreso_id: null }).eq("egreso_id", creado.id);
    await admin.from("movimientos").update({ egreso_id: null }).eq("egreso_id", creado.id);
    await admin.from("egresos").delete().eq("id", creado.id);
    return { error: "Alguien más registró alguno de esos movimientos mientras tanto. Recargá la pantalla." };
  }

  const historial = await anotar(admin, {
    usuario_id: permisos.userId, accion: "egreso_creado", entidad_id: creado.id,
    detalle: {
      monto: e.monto, categoria: e.categoria, descripcion: e.descripcion, comprobante: e.comprobante, pagado: e.pagado,
      origen: e.origen, sucursal_id: e.sucursal_id, proveedor_id: e.proveedor_id, vencimiento: e.fecha_vencimiento,
      retiros_de_caja: retiros_caja_ids.length, ingresos_del_kiosco: entregas_ids.length,
    },
  });
  refrescar();
  return historial;
}

// ── Marcar como pagada una compra que estaba pendiente ───────────────────────
export async function marcarEgresoPagado(id: string, pago: { origen: string; fecha_pago: string }): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };

  const validado = validarPago(pago, fechaHoyAR());
  if ("error" in validado) return { error: validado.error };

  const admin = createAdminClient();
  // Una compra de un proveedor de la lista se paga desde su cuenta (Proveedores → Registrar un pago): marcarla pagada acá y además
  // pagarla a cuenta la descontaría dos veces.
  const { data: previo } = await admin.from("egresos").select("proveedor_id").eq("id", id).maybeSingle();
  if (previo?.proveedor_id) {
    return { error: "Esta compra es de un proveedor de la lista: su pago se registra desde Proveedores («Registrar un pago»). Así no se descuenta dos veces." };
  }
  const { data, error } = await admin.from("egresos")
    .update({ pagado: true, origen: validado.valor.origen, fecha_pago: validado.valor.fecha_pago, updated_by: permisos.userId, updated_at: new Date().toISOString() })
    .eq("id", id).eq("pagado", false).is("anulado_en", null).select("id, monto, descripcion");
  if (error) return { error: error.message };
  if ((data ?? []).length === 0) return { error: "Esa compra ya estaba pagada o fue anulada. Recargá la pantalla." };

  const historial = await anotar(admin, {
    usuario_id: permisos.userId, accion: "egreso_pagado", entidad_id: id,
    detalle: { monto: Number(data![0].monto), descripcion: data![0].descripcion, origen: validado.valor.origen, fecha_pago: validado.valor.fecha_pago },
  });
  refrescar();
  return historial;
}

// ── Anular (nunca se borra una fila de plata) ────────────────────────────────
// Libera los retiros de caja y entregas que tenía: vuelven a "Para registrar".
export async function anularEgreso(id: string, motivo: string): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };

  const texto = (motivo ?? "").trim();
  if (texto.length < 3)   return { error: "Escribí el motivo de la anulación" };
  if (texto.length > 200) return { error: "El motivo es demasiado largo (máximo 200 caracteres)" };

  const admin = createAdminClient();
  const { data, error } = await admin.from("egresos")
    .update({ anulado_en: new Date().toISOString(), anulado_por: permisos.userId, anulado_motivo: texto })
    .eq("id", id).is("anulado_en", null).select("id, monto, descripcion");
  if (error) return { error: error.message };
  if ((data ?? []).length === 0) return { error: "Ese egreso ya estaba anulado. Recargá la pantalla." };

  await admin.from("retiros_caja").update({ egreso_id: null }).eq("egreso_id", id);
  await admin.from("movimientos").update({ egreso_id: null }).eq("egreso_id", id);

  const historial = await anotar(admin, {
    usuario_id: permisos.userId, accion: "egreso_anulado", entidad_id: id, motivo: texto,
    detalle: { monto: Number(data![0].monto), descripcion: data![0].descripcion },
  });
  refrescar();
  return historial;
}

// ── Vencimiento de un remito o factura (migración 113) ───────────────────────
// Cargarlo o corregirlo después de que el comprobante ya está en la cuenta. null = sacarlo (sin vencimiento).
export async function fijarVencimiento(egresoId: string, fecha: string | null): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };

  const nueva = (fecha ?? "").trim() || null;
  if (nueva && !fechaValida(nueva)) return { error: "La fecha de vencimiento no es válida" };

  const admin = createAdminClient();
  const { data: previo, error: errLeer } = await admin.from("egresos")
    .select("id, fecha, descripcion, pagado, anulado_en, fecha_vencimiento").eq("id", egresoId).maybeSingle();
  if (falta113(errLeer?.message)) return { error: SIN_MIGRACION_113 };
  if (!previo || previo.anulado_en) return { error: "Ese remito o factura no existe o fue anulado. Recargá la pantalla." };
  if (previo.pagado) return { error: "Ese remito o factura ya está pagado: el vencimiento no se cambia." };
  if (nueva && nueva < previo.fecha) return { error: "El vencimiento no puede ser anterior a la fecha de la compra" };
  if ((previo.fecha_vencimiento ?? null) === nueva) return {};

  const { error } = await admin.from("egresos")
    .update({ fecha_vencimiento: nueva, updated_by: permisos.userId, updated_at: new Date().toISOString() })
    .eq("id", egresoId).eq("pagado", false).is("anulado_en", null);
  if (error) return { error: falta113(error.message) ? SIN_MIGRACION_113 : error.message };

  const historial = await anotar(admin, {
    usuario_id: permisos.userId, accion: "egreso_vencimiento", entidad_id: egresoId,
    detalle: { descripcion: previo.descripcion, anterior: previo.fecha_vencimiento ?? null, nuevo: nueva },
  });
  refrescar();
  return historial;
}

// ── Costos de una mercadería que ingresó al kiosco ────────────────────────────
// El personal del kiosco registra la recepción solo para el stock (sin precios); el administrativo completa el costo unitario de
// cada producto mirando la factura o el remito. Es el mismo dato que antes cargaba el kiosco (movimiento_items.precio_unitario y
// subtotal) y mantiene el aviso de «el proveedor cambió el precio» (alertas_precio) si difiere del costo actual del producto.
export async function completarCostosEntrega(
  movimientoId: string,
  items: { id: string; precio_unitario: number | null }[],
): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };

  if (!Array.isArray(items) || items.length === 0) return { error: "No hay costos para guardar" };
  if (items.length > 200) return { error: "Demasiados productos en una sola carga" };
  const nuevos = new Map<string, number | null>();
  for (const i of items) {
    if (!i || typeof i.id !== "string" || nuevos.has(i.id)) return { error: "La lista de productos no es válida" };
    if (i.precio_unitario !== null && (typeof i.precio_unitario !== "number" || !Number.isFinite(i.precio_unitario) || i.precio_unitario < 0 || i.precio_unitario > MONTO_MAX)) {
      return { error: "El costo de cada producto tiene que ser un número mayor o igual a cero" };
    }
    nuevos.set(i.id, i.precio_unitario === null ? null : redondearMoneda(i.precio_unitario));
  }

  const admin = createAdminClient();
  const { data: mov } = await admin.from("movimientos")
    .select("id, tipo, sucursal_id, proveedor, anulado_en, movimiento_items(id, product_id, cantidad, precio_unitario)")
    .eq("id", movimientoId).maybeSingle();
  if (!mov || mov.tipo !== "entrega" || mov.anulado_en) return { error: "Ese ingreso no existe o fue anulado. Recargá la pantalla." };

  const { data: sucursales } = await admin.from("sucursales").select("id").eq("entra_en_tesoreria", true);
  if (!(sucursales ?? []).some((s: { id: string }) => s.id === mov.sucursal_id)) return { error: "Ese local no entra en Tesorería" };

  const lineas = new Map((mov.movimiento_items ?? []).map((l: { id: string; product_id: string; cantidad: number | string; precio_unitario: number | string | null }) => [l.id, l]));
  for (const id of nuevos.keys()) if (!lineas.has(id)) return { error: "Un producto no pertenece a este ingreso. Recargá la pantalla." };

  const cambios = [...nuevos.entries()].filter(([id, precio]) => {
    const actual = lineas.get(id)!.precio_unitario;
    return (actual == null ? null : Number(actual)) !== precio;
  });
  if (cambios.length === 0) return {};

  for (const [id, precio] of cambios) {
    const cantidad = Number(lineas.get(id)!.cantidad);
    const { error } = await admin.from("movimiento_items")
      .update({ precio_unitario: precio, subtotal: precio === null ? null : redondearMoneda(cantidad * precio) })
      .eq("id", id).eq("movimiento_id", movimientoId);
    if (error) return { error: error.message };
  }

  // Aviso de cambio de precio: contra el costo actual del producto en ese local. Si ya había un aviso sin resolver de esta misma
  // entrega y producto (se corrigió el costo), se reemplaza para no dejar uno viejo.
  const productos = [...new Set(cambios.map(([id]) => lineas.get(id)!.product_id))];
  const { data: precios } = await admin.from("product_prices").select("product_id, costo").eq("sucursal_id", mov.sucursal_id).in("product_id", productos);
  const costoActual = new Map((precios ?? []).map((p: { product_id: string; costo: number | string | null }) => [p.product_id, p.costo == null ? null : Number(p.costo)]));
  // alertas_precio todavía no está en src/types/database.ts: se castea como en el resto del repo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alertasTabla = () => (admin as any).from("alertas_precio");
  await alertasTabla().delete().eq("movimiento_id", movimientoId).in("product_id", productos).is("revisado_por", null);
  const alertas = cambios
    .map(([id, precio]) => {
      const anterior = costoActual.get(lineas.get(id)!.product_id) ?? null;
      if (precio === null || anterior === null || precio === anterior) return null;
      return { movimiento_id: movimientoId, product_id: lineas.get(id)!.product_id, proveedor: mov.proveedor ?? null, costo_anterior: anterior, costo_nuevo: precio };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);
  if (alertas.length > 0) await alertasTabla().insert(alertas);

  const total = cambios.reduce((s, [id, precio]) => s + (precio === null ? 0 : redondearMoneda(Number(lineas.get(id)!.cantidad) * precio)), 0);
  const historial = await anotar(admin, {
    usuario_id: permisos.userId, accion: "entrega_costos", entidad_id: movimientoId,
    detalle: { proveedor: mov.proveedor ?? null, productos: cambios.length, total: redondearMoneda(total), alertas: alertas.length },
  });
  refrescar();
  revalidatePath("/admin/alertas-precio");
  revalidatePath("/admin/movimientos");
  return historial;
}

// ── "No corresponde": una entrega del kiosco que no tiene compra que registrar ──
// (una carga duplicada, una prueba, una transferencia entre kioscos). Es solo una marca de Tesorería: no toca el stock.
export async function descartarEntrega(id: string, motivo: string): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };

  const texto = (motivo ?? "").trim();
  if (texto.length < 3)   return { error: "Escribí por qué no corresponde" };
  if (texto.length > 200) return { error: "El motivo es demasiado largo (máximo 200 caracteres)" };

  const admin = createAdminClient();
  const { data, error } = await admin.from("movimientos")
    .update({ tesoreria_descartado_en: new Date().toISOString(), tesoreria_descartado_por: permisos.userId, tesoreria_descartado_motivo: texto })
    .eq("id", id).eq("tipo", "entrega").is("egreso_id", null).is("tesoreria_descartado_en", null).select("id, proveedor");
  if (error) return { error: error.message };
  if ((data ?? []).length === 0) return { error: "Esa entrega ya fue registrada o descartada. Recargá la pantalla." };

  const historial = await anotar(admin, {
    usuario_id: permisos.userId, accion: "entrega_descartada", entidad_id: id, motivo: texto,
    detalle: { proveedor: data![0].proveedor },
  });
  refrescar();
  return historial;
}

export async function restaurarEntrega(id: string): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };

  const admin = createAdminClient();
  const { data, error } = await admin.from("movimientos")
    .update({ tesoreria_descartado_en: null, tesoreria_descartado_por: null, tesoreria_descartado_motivo: null })
    .eq("id", id).eq("tipo", "entrega").not("tesoreria_descartado_en", "is", null).select("id, proveedor");
  if (error) return { error: error.message };
  if ((data ?? []).length === 0) return { error: "Esa entrega no estaba descartada. Recargá la pantalla." };

  const historial = await anotar(admin, {
    usuario_id: permisos.userId, accion: "entrega_restaurada", entidad_id: id,
    detalle: { proveedor: data![0].proveedor },
  });
  refrescar();
  return historial;
}

// ── Efectivo con el que arranca Tesorería ────────────────────────────────────
// Es un número que mueve «efectivo en mano», así que cada cambio queda en el historial con el valor anterior y el nuevo.
// La primera carga es libre; desde la segunda el motivo es obligatorio.
export async function guardarEfectivoInicial(monto: number, motivo: string = ""): Promise<Resultado> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };
  if (typeof monto !== "number" || !Number.isFinite(monto) || monto < 0 || monto > 1_000_000_000) {
    return { error: "Ingresá un monto válido (cero o más)" };
  }
  const nuevo = redondearMoneda(monto);

  const admin = createAdminClient();
  const config = await cargarConfig(admin);
  if (!config) return { error: SIN_MIGRACION };
  if (nuevo === config.efectivo_inicial) return { error: "El efectivo inicial ya tiene ese valor" };

  // ¿Ya se cargó antes? Sin historial de cambios esta es la primera carga y el motivo es opcional.
  const { count, error: errCount } = await admin.from("tesoreria_historial")
    .select("id", { count: "exact", head: true }).eq("accion", "efectivo_inicial_cambiado");
  if (errCount) return { error: "Falta aplicar la migración 104 de la base de datos" };
  const esPrimera = (count ?? 0) === 0;

  const texto = (motivo ?? "").trim();
  if (!esPrimera && texto.length < 3) return { error: "Escribí por qué cambia el efectivo inicial (por ejemplo: «conté el efectivo y eran $X»)" };
  if (texto.length > 200)             return { error: "El motivo es demasiado largo (máximo 200 caracteres)" };

  const { error } = await admin.from("tesoreria_config")
    .update({ efectivo_inicial: nuevo, updated_by: permisos.userId, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) return { error: error.message };

  const historial = await anotar(admin, {
    usuario_id: permisos.userId, accion: "efectivo_inicial_cambiado", motivo: texto || null,
    detalle: { anterior: esPrimera ? null : config.efectivo_inicial, nuevo },
  });
  refrescar();
  return historial;
}

// ── Comprobantes (bucket privado `tesoreria`) ────────────────────────────────
// El navegador no puede subir ni leer directo (no hay policies en storage.objects): el servidor firma una URL de
// subida de un solo uso, y otra de lectura que vence en 2 minutos. El archivo ya viene reducido (lib/imagen.ts) y el
// bucket rechaza todo lo que pase de 1 MB.
const EXTENSIONES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
};

export async function crearUrlSubidaComprobante(tipo: string): Promise<{ error: string } | { path: string; token: string }> {
  const permisos = await exigirCargar();
  if (!permisos) return { error: SIN_PERMISO };
  const ext = EXTENSIONES[tipo];
  if (!ext) return { error: "Solo se aceptan fotos (JPG, PNG, WebP) o PDF" };

  const path = `${fechaHoyAR().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await createAdminClient().storage.from("tesoreria").createSignedUploadUrl(path);
  if (error || !data) return { error: error?.message ?? "No se pudo preparar la subida" };
  return { path, token: data.token };
}

export async function urlComprobante(egresoId: string): Promise<{ error: string } | { url: string }> {
  const permisos = await permisosTesoreria();
  if (!permisos?.puedeVer) return { error: "Sin permisos" };

  const admin = createAdminClient();
  const { data } = await admin.from("egresos").select("comprobante_path").eq("id", egresoId).single();
  if (!data?.comprobante_path) return { error: "Este egreso no tiene archivo adjunto" };

  const { data: firmada, error } = await admin.storage.from("tesoreria").createSignedUrl(data.comprobante_path, 120);
  if (error || !firmada) return { error: error?.message ?? "No se pudo abrir el archivo" };
  return { url: firmada.signedUrl };
}
