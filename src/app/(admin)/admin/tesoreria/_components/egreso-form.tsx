"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { registrarEgreso, crearUrlSubidaComprobante, completarCostosEntrega } from "../actions";
import { CostosTabla, costosAEnviar, costosIniciales, costosValidos, hayCostosCargados, type ValoresCosto } from "./costos-entrega";
import { sumarDias } from "@/lib/tesoreria/deuda-vencimientos";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { reducirImagen, formatearPeso } from "@/lib/imagen";
import { friendlyError } from "@/lib/utils";
import { fechaHoyAR } from "@/lib/fecha";
import { CATEGORIAS, ORIGENES, type EgresoEntrada } from "@/lib/tesoreria/tipos";
import { diferenciaConKiosco } from "@/lib/tesoreria/calculos";
import type { EntregaPendiente } from "@/lib/tesoreria/consultas";

// Un solo formulario para todo egreso (con o sin factura, pagado o por pagar). Lo usan "Para registrar", "Egresos"
// y "Gastos fijos": cada uno lo abre con distintos datos ya cargados (el borrador), el administrativo corrige lo que
// haga falta con la factura o el remito real en la mano.

export type Borrador = Partial<Omit<EgresoEntrada, "monto">> & { monto?: number };
type Opcion = { id: string; nombre: string; plazo_pago_dias?: number | null };

// Tickets y facturas tienen que poder leerse: más grandes que las fotos de productos (1000 px).
const LADO_COMPROBANTE_PX = 1600;
const CALIDAD_COMPROBANTE = 0.75;
const PESO_MAX_BYTES = 1024 * 1024;   // el mismo tope que impone la base en el bucket

const etiqueta = "text-xs font-medium tracking-wide uppercase text-neutral-500 block mb-1.5";
const campo = "h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700";
const opcionBoton = (activa: boolean) =>
  `text-sm rounded-lg border-2 px-2 py-2 transition-colors ${activa ? "border-tierra-700 bg-tierra-50 font-semibold text-tierra-900" : "border-neutral-200 text-neutral-600 hover:border-neutral-300"}`;

type Props = {
  open:        boolean;
  titulo:      string;
  borrador:    Borrador | null;
  sucursales:  Opcion[];
  proveedores: Opcion[];
  // Ingresos de mercadería del kiosco todavía sin compra: se pueden vincular a una compra de mercadería (opcional).
  entregasDisponibles?: EntregaPendiente[];
  onClose:     () => void;
};

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const fechaCorta = (f: string) => new Date(f + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });

// Cerrado no renderiza nada, y abierto monta el formulario de cero: así arranca siempre con los datos del borrador
// (o en blanco) sin sincronizar el estado a mano con un efecto.
export function EgresoForm({ open, ...resto }: Props) {
  if (!open) return null;
  return <Formulario {...resto} />;
}

function Formulario({ titulo, borrador, sucursales, proveedores, entregasDisponibles = [], onClose }: Omit<Props, "open">) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Qué dato falta: se marca en rojo y se trae a la vista (el formulario es más alto que la pantalla y, si no, el aviso quedaba afuera).
  const [faltante, setFaltante] = useState<string | null>(null);
  function fallar(campo: string, mensaje: string) {
    setError(mensaje);
    setFaltante(campo);
    document.getElementById(`campo-${campo}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const aviso = (campo: string) => (faltante === campo ? "rounded-lg ring-2 ring-danger/50 p-2 -m-2" : "");

  const b = borrador ?? {};
  const retiros = b.retiros_caja_ids ?? [];
  const esRetiro = retiros.length > 0;   // plata que ya salió del cajón de un kiosco: siempre pagada

  // Una compra de un proveedor de la lista siempre se carga «todavía se debe»: el pago se registra en Proveedores.
  const [pagado, setPagado]           = useState<boolean | null>(esRetiro ? true : b.proveedor_id ? false : (b.pagado ?? null));
  const [monto, setMonto]             = useState(b.monto ? String(b.monto) : "");
  const [fecha, setFecha]             = useState(b.fecha ?? fechaHoyAR());
  const [categoria, setCategoria]     = useState(b.categoria ?? "mercaderia");
  const [proveedorId, setProveedorId] = useState(b.proveedor_id ?? "");
  const [descripcion, setDescripcion] = useState(b.descripcion ?? "");
  const [comprobante, setComprobante] = useState<"con" | "sin" | null>((b.comprobante as "con" | "sin" | undefined) ?? null);
  const [numero, setNumero]           = useState(b.comprobante_numero ?? "");
  // Vencimiento: si quien carga no lo tocó, se propone fecha de la compra + plazo de pago del proveedor (Catálogo → Proveedores).
  const [venceManual, setVenceManual] = useState<string | null>(b.fecha_vencimiento ?? null);
  const [sucursalId, setSucursalId]   = useState(b.sucursal_id ?? "");
  const [origen, setOrigen]           = useState(esRetiro ? "retiro_caja" : (b.origen ?? ""));
  const [nota, setNota]               = useState(b.nota ?? "");
  // Costo unitario de lo que ingresó al kiosco (el personal solo carga el stock): se completa acá mirando la factura.
  const [costos, setCostos] = useState<Record<string, ValoresCosto>>({});
  const [entregasElegidas, setEntregasElegidas] = useState<Set<string>>(new Set(b.entregas_ids ?? []));
  const conProveedor = !esRetiro && proveedorId !== "";
  const plazo = proveedores.find((p) => p.id === proveedorId)?.plazo_pago_dias ?? null;
  const venceSugerido = plazo !== null && fecha ? sumarDias(fecha, plazo) : "";
  const venceFinal = venceManual ?? venceSugerido;
  const [archivo, setArchivo]         = useState<File | null>(null);
  const [subido, setSubido]           = useState<{ nombre: string; path: string } | null>(null);

  async function subirArchivo(file: File): Promise<string> {
    if (subido && subido.nombre === file.name) return subido.path;   // reintento: no volver a subirlo
    const listo = file.type.startsWith("image/") ? await reducirImagen(file, LADO_COMPROBANTE_PX, CALIDAD_COMPROBANTE) : file;
    if (listo.size > PESO_MAX_BYTES) {
      throw new Error(`El archivo pesa ${formatearPeso(listo.size)} y el máximo es ${formatearPeso(PESO_MAX_BYTES)}. ` +
        (listo.type === "application/pdf" ? "Probá con una foto de la factura en vez del PDF." : "Sacale una foto más chica."));
    }
    const firma = await crearUrlSubidaComprobante(listo.type);
    if ("error" in firma) throw new Error(firma.error);
    const { error: errSubida } = await createBrowserClient().storage
      .from("tesoreria").uploadToSignedUrl(firma.path, firma.token, listo, { contentType: listo.type });
    if (errSubida) throw new Error(`No se pudo subir el archivo: ${errSubida.message}`);
    setSubido({ nombre: file.name, path: firma.path });
    return firma.path;
  }

  function guardar() {
    setError(null);
    setFaltante(null);
    const montoNum = parseFloat(monto);
    if (!montoNum || montoNum <= 0) { fallar("monto", "Ingresá el monto"); return; }
    if (pagado === null)            { fallar("pagado", "Indicá si ya se pagó o todavía se debe"); return; }
    if (comprobante === null)       { fallar("comprobante", "Indicá si tiene factura o no"); return; }
    if (pagado && !origen)          { fallar("origen", "Indicá de dónde salió la plata"); return; }
    const nombreProveedor = proveedores.find((p) => p.id === proveedorId)?.nombre ?? "";
    const vence = venceFinal;
    const desc = descripcion.trim() || nombreProveedor;
    if (!desc)                      { fallar("descripcion", "Escribí a quién o qué se pagó (o elegí un proveedor)"); return; }
    if (conProveedor && !sucursalId) { fallar("sucursal", "Elegí el kiosco de la compra"); return; }

    // Los costos de los ingresos elegidos se guardan ANTES que la compra: una vez vinculado, el ingreso sale de la lista y ya no se
    // podría completar desde acá. Si algo falla, no se registra la compra y se puede reintentar sin duplicar nada.
    const conCostos = esRetiro || categoria !== "mercaderia" ? [] : entregasDisponibles.filter((e) => entregasElegidas.has(e.id) && costos[e.id] && hayCostosCargados(costos[e.id]));
    if (conCostos.some((e) => !costosValidos(costos[e.id]))) { fallar("costos", "Cada costo tiene que ser un número mayor o igual a cero"); return; }

    startTransition(async () => {
      try {
        for (const e of conCostos) {
          const rc = await completarCostosEntrega(e.id, costosAEnviar(e, costos[e.id]));
          if (rc.error) { setError(`No se pudieron guardar los costos de «${e.proveedor || "Sin proveedor"}» del ${fechaCorta(e.fecha)}: ${rc.error} La compra todavía no se registró.`); return; }
        }
        const path = archivo ? await subirArchivo(archivo) : (b.comprobante_path ?? null);
        const r = await registrarEgreso({
          fecha, monto: montoNum, sucursal_id: sucursalId || null, categoria,
          proveedor_id: esRetiro ? null : (proveedorId || null), descripcion: desc, comprobante,
          comprobante_numero: numero.trim() || null,
          fecha_vencimiento: pagado ? null : (vence || null),
          comprobante_path: path, pagado, origen: pagado ? origen : null,
          gasto_fijo_id: b.gasto_fijo_id ?? null, nota: nota.trim() || null,
          retiros_caja_ids: retiros, entregas_ids: esRetiro || categoria !== "mercaderia" ? [] : [...entregasElegidas],
        });
        if (r.error) { setError(r.error); return; }
        onClose();
        router.refresh();
      } catch (e) { setError(friendlyError(e)); }
    });
  }

  const origenes = ORIGENES.filter((o) => o.valor !== "retiro_caja");

  // Ingresos del kiosco que se pueden vincular a esta compra: los del kiosco elegido (o todos si es general).
  const vinculables = esRetiro || categoria !== "mercaderia"
    ? []
    : entregasDisponibles.filter((e) => !sucursalId || e.sucursal_id === sucursalId);
  const elegidas = entregasDisponibles.filter((e) => entregasElegidas.has(e.id));
  const totalKiosco = elegidas.reduce((sum, e) => sum + e.total, 0);
  const diferencia = diferenciaConKiosco(parseFloat(monto), totalKiosco);
  function alternarEntrega(id: string) {
    setEntregasElegidas((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
          <h2 className="text-base font-semibold font-display text-neutral-900">{titulo}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {esRetiro ? (
            <p className="text-sm text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2">
              Esta plata ya salió del cajón del kiosco: se registra como pagada con origen «Retiro de caja».
            </p>
          ) : (
            <div id="campo-pagado" className={aviso("pagado")}>
              <label className={etiqueta}>¿Ya se pagó? *</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setPagado(true)} disabled={conProveedor}
                  className={`${opcionBoton(pagado === true)} disabled:opacity-40 disabled:cursor-not-allowed`}>Ya se pagó</button>
                <button type="button" onClick={() => setPagado(false)} className={opcionBoton(pagado === false)}>Todavía se debe</button>
              </div>
              {conProveedor && (
                <p className="text-xs text-neutral-500 mt-1.5">Las compras de un proveedor de la lista se cargan «todavía se debe»: el pago se registra en Proveedores.</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div id="campo-monto" className={aviso("monto")}>
              <label className={etiqueta}>Monto *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-neutral-400">$</span>
                <input type="number" min="0" step="0.01" placeholder="0.00" value={monto} onChange={(e) => setMonto(e.target.value)}
                  className={`${campo} pl-6 tabular-nums`} />
              </div>
            </div>
            <div>
              <label className={etiqueta}>{pagado === false ? "Fecha de la compra *" : "Fecha *"}</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={campo} />
            </div>
          </div>

          <div>
            <label className={etiqueta}>Categoría *</label>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIAS.map((c) => (
                <button key={c.valor} type="button" onClick={() => setCategoria(c.valor)} className={opcionBoton(categoria === c.valor)}>
                  {c.etiqueta}
                </button>
              ))}
            </div>
          </div>

          {!esRetiro && (
            <div>
              <label className={etiqueta}>Proveedor (si está en la lista)</label>
              <select value={proveedorId} onChange={(e) => { setProveedorId(e.target.value); if (e.target.value) setPagado(false); }} className={campo}>
                <option value="">— Ninguno —</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
          )}

          <div id="campo-descripcion" className={aviso("descripcion")}>
            <label className={etiqueta}>A quién / qué se pagó *</label>
            <input type="text" maxLength={200} placeholder="Ej: Lo de Mario - fiambre, Alquiler octubre" value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)} className={campo} />
          </div>

          <div id="campo-comprobante" className={aviso("comprobante")}>
            <label className={etiqueta}>¿Tiene factura? *</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setComprobante("con")} className={opcionBoton(comprobante === "con")}>Con factura</button>
              <button type="button" onClick={() => setComprobante("sin")} className={opcionBoton(comprobante === "sin")}>Sin factura</button>
            </div>
            <input type="text" maxLength={40} value={numero} onChange={(e) => setNumero(e.target.value)} className={`${campo} mt-2`}
              aria-label="Número de remito o de factura"
              placeholder={comprobante === "con" ? "N° de factura (y de remito, si lo tiene) — opcional" : comprobante === "sin" ? "N° de remito — opcional" : "N° de factura o de remito — opcional"} />
          </div>

          {pagado === false && (
            <div>
              <label className={etiqueta}>Vence el (opcional)</label>
              <input type="date" value={venceFinal} min={fecha} onChange={(e) => setVenceManual(e.target.value)} className={campo} />
              <p className="mt-1 text-xs text-neutral-400">
                {venceManual === null && venceSugerido ? `Propuesto: la fecha de la compra + ${plazo} ${plazo === 1 ? "día" : "días"} de plazo de este proveedor. Cambialo si hace falta. ` : ""}
                Si lo cargás, esta compra figura en el listado de deuda vencida y a vencer.
              </p>
            </div>
          )}

          <div id="campo-sucursal" className={aviso("sucursal")}>
            <label className={etiqueta}>{conProveedor ? "Kiosco *" : "Kiosco"}</label>
            <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className={campo}>
              {conProveedor ? <option value="">— Elegí —</option> : <option value="">General (no es de un kiosco puntual)</option>}
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>

          {vinculables.length > 0 && (
            <div>
              <label className={etiqueta}>Ingresos del kiosco de esta compra (opcional)</label>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200 divide-y divide-neutral-100">
                {vinculables.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-neutral-50">
                    <input type="checkbox" checked={entregasElegidas.has(e.id)} onChange={() => alternarEntrega(e.id)}
                      className="size-4 rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700/20" />
                    <span className="min-w-0 flex-1 truncate text-neutral-700">
                      {e.proveedor || "Sin proveedor"} <span className="text-xs text-neutral-400">· {fechaCorta(e.fecha)} · {e.lineas.length} {e.lineas.length === 1 ? "producto" : "productos"}</span>
                    </span>
                    <span className="text-xs tabular-nums text-neutral-500 shrink-0">{e.total > 0 ? AR.format(e.total) : "sin importe"}</span>
                  </label>
                ))}
              </div>
              {elegidas.length > 0 && (
                <p className="text-xs mt-1.5 text-neutral-500">
                  {totalKiosco > 0 ? `Los costos cargados suman ${AR.format(totalKiosco)}` : "Todavía no hay costos cargados"} en {elegidas.length} {elegidas.length === 1 ? "ingreso" : "ingresos"}.
                  {diferencia !== null && diferencia !== 0 && (
                    <span className="font-semibold text-amber-700"> Tu importe difiere en {diferencia > 0 ? "+" : ""}{AR.format(diferencia)}: revisá que estén bien los dos.</span>
                  )}
                  {diferencia === 0 && <span className="font-semibold text-selva-700"> Coincide con tu importe.</span>}
                </p>
              )}
              {elegidas.length > 0 && !esRetiro && categoria === "mercaderia" && (
                <div id="campo-costos" className={`mt-3 space-y-3 ${aviso("costos")}`}>
                  <p className="text-xs font-medium tracking-wide uppercase text-neutral-500">Costo de cada producto (opcional, de la factura)</p>
                  {elegidas.map((e) => (
                    <div key={e.id} className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                      <p className="text-xs font-semibold text-neutral-700">{e.proveedor || "Sin proveedor"} · {fechaCorta(e.fecha)}</p>
                      <CostosTabla entrega={e} valores={costos[e.id] ?? costosIniciales(e)} onChange={(v) => setCostos((c) => ({ ...c, [e.id]: v }))} />
                    </div>
                  ))}
                  <p className="text-xs text-neutral-400">El kiosco solo carga la cantidad. Si el costo cambió respecto del actual, queda un aviso en Alertas de precio.</p>
                </div>
              )}
            </div>
          )}

          {pagado === true && !esRetiro && (
            <div id="campo-origen" className={aviso("origen")}>
              <label className={etiqueta}>¿De dónde salió la plata? *</label>
              <select value={origen} onChange={(e) => setOrigen(e.target.value)} className={campo}>
                <option value="">— Elegí —</option>
                {origenes.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className={etiqueta}>Foto o PDF de la factura (opcional)</label>
            <input type="file" accept="image/*,application/pdf"
              onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setSubido(null); }}
              className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-neutral-700 hover:file:bg-neutral-200" />
            <p className="text-xs text-neutral-400 mt-1">Las fotos se achican solas. Un PDF puede pesar hasta 1 MB.</p>
          </div>

          <div>
            <label className={etiqueta}>Nota (opcional)</label>
            <textarea rows={2} maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:outline-none focus:border-tierra-700 resize-none" />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 space-y-3 shrink-0">
          {error && <p role="alert" className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3">
            <Button variant="ghost" size="sm" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button variant="primary" size="sm" loading={pending} onClick={guardar} className="flex-1">Guardar</Button>
          </div>
        </div>
      </aside>
    </>
  );
}
