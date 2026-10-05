// Validación de un egreso en el servidor. Pura (sin base) para poder probarla: la acción la llama antes de
// escribir, porque nada de lo que manda el navegador se confía (architecture.md §3, punto 5).

import { redondearMoneda } from "@/lib/pedidos/pricing";
import { CATEGORIAS, COMPROBANTES, ORIGENES, type EgresoEntrada, type Categoria, type Comprobante, type Origen } from "./tipos";

export const MONTO_MAX = 1_000_000_000;
const MAX_VINCULOS = 50;

export type EgresoValidado = Omit<EgresoEntrada, "categoria" | "comprobante" | "origen" | "retiros_caja_ids" | "entregas_ids"> & {
  categoria:        Categoria;
  comprobante:      Comprobante;
  origen:           Origen | null;
  fecha_pago:       string | null;   // = fecha cuando está pagado
  retiros_caja_ids: string[];
  entregas_ids:     string[];
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
// Ruta de un archivo en el bucket `tesoreria`, con la forma exacta que genera crearUrlSubidaComprobante: AAAA-MM/uuid.ext
const PATH_RE  = /^\d{4}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/;

export function fechaValida(f: string): boolean {
  if (!FECHA_RE.test(f)) return false;
  const [a, m, d] = f.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function textoOpcional(v: string | null | undefined, max: number): string | null | "demasiado-largo" {
  const t = (v ?? "").trim();
  if (!t) return null;
  return t.length > max ? "demasiado-largo" : t;
}

function listaDeIds(v: unknown): string[] | null {
  if (!Array.isArray(v)) return [];
  if (v.length > MAX_VINCULOS || v.some((x) => typeof x !== "string" || !x)) return null;
  return [...new Set(v as string[])];
}

// Marcar como pagada una compra que estaba pendiente. El origen «retiro de caja» no vale acá: ese origen solo se
// da al registrar un retiro ya hecho (validarEgreso).
export function validarPago(p: { origen: string; fecha_pago: string }, hoy: string): { error: string } | { valor: { origen: Origen; fecha_pago: string } } {
  const origen = ORIGENES.find((o) => o.valor === p.origen)?.valor;
  if (!origen || origen === "retiro_caja") return { error: "Indicá cómo se pagó" };
  if (!fechaValida(p.fecha_pago)) return { error: "La fecha de pago no es válida" };
  if (p.fecha_pago > hoy)         return { error: "La fecha de pago no puede ser futura" };
  return { valor: { origen, fecha_pago: p.fecha_pago } };
}

// `hoy` entra como parámetro (YYYY-MM-DD, calendario argentino): no se permite cargar un egreso en una fecha futura.
export function validarEgreso(e: EgresoEntrada, hoy: string): { error: string } | { valor: EgresoValidado } {
  if (typeof e.monto !== "number" || !Number.isFinite(e.monto)) return { error: "Ingresá un monto válido" };
  const monto = redondearMoneda(e.monto);
  if (monto <= 0)          return { error: "El monto tiene que ser mayor a cero" };
  if (monto > MONTO_MAX)   return { error: "El monto es demasiado grande" };

  if (!fechaValida(e.fecha)) return { error: "La fecha no es válida" };
  if (e.fecha > hoy)         return { error: "La fecha no puede ser futura" };

  const categoria = CATEGORIAS.find((c) => c.valor === e.categoria)?.valor;
  if (!categoria) return { error: "Elegí una categoría" };

  const comprobante = COMPROBANTES.find((c) => c.valor === e.comprobante)?.valor;
  if (!comprobante) return { error: "Indicá si tiene factura o no" };

  if (typeof e.pagado !== "boolean") return { error: "Indicá si ya se pagó o todavía se debe" };
  // Una compra pendiente todavía no tiene de dónde salió la plata: se completa al marcarla pagada.
  const origen = e.pagado ? ORIGENES.find((o) => o.valor === e.origen)?.valor ?? null : null;
  if (e.pagado && !origen) return { error: "Indicá de dónde salió la plata" };

  const descripcion = (e.descripcion ?? "").trim();
  if (!descripcion)             return { error: "Escribí a quién o qué se pagó" };
  if (descripcion.length > 200) return { error: "La descripción es demasiado larga (máximo 200 caracteres)" };

  const numero = textoOpcional(e.comprobante_numero, 40);
  if (numero === "demasiado-largo") return { error: "El número de comprobante es demasiado largo" };

  const nota = textoOpcional(e.nota, 500);
  if (nota === "demasiado-largo") return { error: "La nota es demasiado larga (máximo 500 caracteres)" };

  const path = (e.comprobante_path ?? "").trim() || null;
  if (path && !PATH_RE.test(path)) return { error: "El archivo adjunto no es válido" };

  const retiros = listaDeIds(e.retiros_caja_ids);
  const entregas = listaDeIds(e.entregas_ids);
  if (!retiros || !entregas) return { error: "La lista de movimientos a registrar no es válida" };

  // Un retiro de caja es plata que ya salió del cajón: no puede quedar "pendiente".
  if (retiros.length > 0 && !e.pagado) return { error: "Un retiro de caja ya está pagado" };
  // Un egreso que viene de un retiro de caja sale, por definición, del cajón del kiosco.
  if (retiros.length > 0 && origen !== "retiro_caja") return { error: "Un retiro de caja se registra con origen «Retiro de caja»" };
  if (origen === "retiro_caja" && retiros.length === 0) return { error: "Elegí qué retiro de caja se está registrando" };

  return {
    valor: {
      fecha:              e.fecha,
      monto,
      sucursal_id:        e.sucursal_id || null,
      categoria,
      proveedor_id:       e.proveedor_id || null,
      descripcion,
      comprobante,
      // El número solo tiene sentido con factura (la base lo exige con un CHECK).
      comprobante_numero: comprobante === "con" ? numero : null,
      comprobante_path:   path,
      pagado:             e.pagado,
      origen,
      fecha_pago:         e.pagado ? e.fecha : null,
      gasto_fijo_id:      e.gasto_fijo_id || null,
      nota,
      retiros_caja_ids:   retiros,
      entregas_ids:       entregas,
    },
  };
}
