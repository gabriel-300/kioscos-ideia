"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { registrarEgreso, crearUrlSubidaComprobante } from "../actions";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { reducirImagen, formatearPeso } from "@/lib/imagen";
import { friendlyError } from "@/lib/utils";
import { fechaHoyAR } from "@/lib/fecha";
import { CATEGORIAS, ORIGENES, type EgresoEntrada } from "@/lib/tesoreria/tipos";

// Un solo formulario para todo egreso (con o sin factura, pagado o por pagar). Lo usan "Para registrar", "Egresos"
// y "Gastos fijos": cada uno lo abre con distintos datos ya cargados (el borrador), el administrativo corrige lo que
// haga falta con la factura o el remito real en la mano.

export type Borrador = Partial<Omit<EgresoEntrada, "monto">> & { monto?: number };
type Opcion = { id: string; nombre: string };

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
  onClose:     () => void;
};

// Cerrado no renderiza nada, y abierto monta el formulario de cero: así arranca siempre con los datos del borrador
// (o en blanco) sin sincronizar el estado a mano con un efecto.
export function EgresoForm({ open, ...resto }: Props) {
  if (!open) return null;
  return <Formulario {...resto} />;
}

function Formulario({ titulo, borrador, sucursales, proveedores, onClose }: Omit<Props, "open">) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const b = borrador ?? {};
  const retiros = b.retiros_caja_ids ?? [];
  const esRetiro = retiros.length > 0;   // plata que ya salió del cajón de un kiosco: siempre pagada

  const [pagado, setPagado]           = useState<boolean | null>(esRetiro ? true : (b.pagado ?? null));
  const [monto, setMonto]             = useState(b.monto ? String(b.monto) : "");
  const [fecha, setFecha]             = useState(b.fecha ?? fechaHoyAR());
  const [categoria, setCategoria]     = useState(b.categoria ?? "mercaderia");
  const [proveedorId, setProveedorId] = useState(b.proveedor_id ?? "");
  const [descripcion, setDescripcion] = useState(b.descripcion ?? "");
  const [comprobante, setComprobante] = useState<"con" | "sin" | null>((b.comprobante as "con" | "sin" | undefined) ?? null);
  const [numero, setNumero]           = useState(b.comprobante_numero ?? "");
  const [sucursalId, setSucursalId]   = useState(b.sucursal_id ?? "");
  const [origen, setOrigen]           = useState(esRetiro ? "retiro_caja" : (b.origen ?? ""));
  const [nota, setNota]               = useState(b.nota ?? "");
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
    const montoNum = parseFloat(monto);
    if (!montoNum || montoNum <= 0) { setError("Ingresá un monto válido"); return; }
    if (pagado === null)            { setError("Indicá si ya se pagó o todavía se debe"); return; }
    if (comprobante === null)       { setError("Indicá si tiene factura o no"); return; }
    if (pagado && !origen)          { setError("Indicá de dónde salió la plata"); return; }
    const nombreProveedor = proveedores.find((p) => p.id === proveedorId)?.nombre ?? "";
    const desc = descripcion.trim() || nombreProveedor;
    if (!desc)                      { setError("Escribí a quién o qué se pagó"); return; }

    startTransition(async () => {
      try {
        const path = archivo ? await subirArchivo(archivo) : (b.comprobante_path ?? null);
        const r = await registrarEgreso({
          fecha, monto: montoNum, sucursal_id: sucursalId || null, categoria,
          proveedor_id: proveedorId || null, descripcion: desc, comprobante,
          comprobante_numero: comprobante === "con" ? (numero.trim() || null) : null,
          comprobante_path: path, pagado, origen: pagado ? origen : null,
          gasto_fijo_id: b.gasto_fijo_id ?? null, nota: nota.trim() || null,
          retiros_caja_ids: retiros, entregas_ids: b.entregas_ids ?? [],
        });
        if (r.error) { setError(r.error); return; }
        onClose();
        router.refresh();
      } catch (e) { setError(friendlyError(e)); }
    });
  }

  const origenes = ORIGENES.filter((o) => o.valor !== "retiro_caja");

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
            <div>
              <label className={etiqueta}>¿Ya se pagó? *</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setPagado(true)}  className={opcionBoton(pagado === true)}>Ya se pagó</button>
                <button type="button" onClick={() => setPagado(false)} className={opcionBoton(pagado === false)}>Todavía se debe</button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
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

          <div>
            <label className={etiqueta}>Proveedor (si está en la lista)</label>
            <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className={campo}>
              <option value="">— Ninguno —</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>

          <div>
            <label className={etiqueta}>A quién / qué se pagó *</label>
            <input type="text" maxLength={200} placeholder="Ej: Lo de Mario - fiambre, Alquiler octubre" value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)} className={campo} />
          </div>

          <div>
            <label className={etiqueta}>¿Tiene factura? *</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setComprobante("con")} className={opcionBoton(comprobante === "con")}>Con factura</button>
              <button type="button" onClick={() => setComprobante("sin")} className={opcionBoton(comprobante === "sin")}>Sin factura</button>
            </div>
            {comprobante === "con" && (
              <input type="text" maxLength={40} placeholder="Número de factura (opcional)" value={numero}
                onChange={(e) => setNumero(e.target.value)} className={`${campo} mt-2`} />
            )}
          </div>

          <div>
            <label className={etiqueta}>Kiosco</label>
            <select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} className={campo}>
              <option value="">General (no es de un kiosco puntual)</option>
              {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>

          {pagado === true && !esRetiro && (
            <div>
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

          {error && <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 flex gap-3 shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button variant="primary" size="sm" loading={pending} onClick={guardar} className="flex-1">Guardar</Button>
        </div>
      </aside>
    </>
  );
}
