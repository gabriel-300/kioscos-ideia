"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CLASIFICACIONES, etiquetaClasificacion, type CruceCobros, type FilaDia, type TotalesCobros } from "@/lib/tesoreria/mp-cobros";
import type { CobroLista, ImportacionMp } from "@/lib/tesoreria/mp-consultas";
import { clasificarCobroMp } from "../mp-actions";
import { ImportarMp } from "./importar-mp";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const ETIQUETA_TIPO: Record<string, string> = {
  account_fund: "Ingreso de dinero a la cuenta", partition_transfer: "Movimiento entre reservas de MP",
  regular_payment: "Cobro", money_transfer: "Transferencia",
};

export interface MercadoPagoData {
  total:        TotalesCobros;
  porLocal:     { sucursalId: string; nombre: string; totales: TotalesCobros }[];
  sinClasificar: CobroLista[];
  clasificados: CobroLista[];            // del período, ya resueltos
  cruce:        CruceCobros;
  porDia:       FilaDia[];
  importaciones: ImportacionMp[];
  nombreLocal:  Record<string, string>;
}

function Tarjeta({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{titulo}</p>
      <p className="mt-1 text-xl font-semibold text-neutral-900">{valor}</p>
      {nota && <p className="mt-0.5 text-xs text-neutral-500">{nota}</p>}
    </div>
  );
}

function FilaClasificar({ c, puedeCargar }: { c: CobroLista; puedeCargar: boolean }) {
  const router = useRouter();
  const [clasif, setClasif] = useState("");
  const [nota, setNota] = useState("");
  const [error, setError] = useState("");
  const [pendiente, empezar] = useTransition();

  function guardar() {
    setError("");
    empezar(async () => {
      const r = await clasificarCobroMp(c.operation_id, clasif, nota);
      if (r.error) { setError(r.error); return; }
      router.refresh();
    });
  }

  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-sm text-neutral-900">
          <span className="font-semibold">{AR.format(c.monto_neto)}</span>{" "}
          <span className="text-neutral-500">· {ETIQUETA_TIPO[c.tipo_operacion] ?? c.tipo_operacion}</span>
          {c.medio_pago && <span className="text-neutral-400"> · {c.medio_pago}</span>}
        </p>
        <p className="text-xs text-neutral-400">{fechaHora(c.fecha_cobro)} · op. {c.operation_id}</p>
      </div>
      {c.descripcion && <p className="text-xs text-neutral-500">«{c.descripcion}»</p>}
      {puedeCargar && (
        <div className="flex gap-2 flex-wrap items-center">
          <select value={clasif} onChange={(e) => setClasif(e.target.value)}
            className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm bg-white">
            <option value="">¿Qué es?</option>
            {CLASIFICACIONES.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
          </select>
          <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (obligatoria en «Otro ingreso»)" maxLength={300}
            className="flex-1 min-w-48 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm" />
          <button type="button" onClick={guardar} disabled={!clasif || pendiente}
            className="rounded-lg bg-tierra-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-tierra-800 disabled:opacity-50">
            {pendiente ? "Guardando…" : "Guardar"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </li>
  );
}

function Bloque({ titulo, ayuda, vacio, children, cantidad }: { titulo: string; ayuda: string; vacio: string; children: React.ReactNode; cantidad: number }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">{titulo}{cantidad > 0 && <span className="ml-2 text-amber-700">({cantidad})</span>}</h2>
        <p className="text-xs text-neutral-500">{ayuda}</p>
      </div>
      {cantidad === 0
        ? <p className="rounded-xl border border-neutral-200 bg-white px-4 py-6 text-center text-sm text-neutral-400">{vacio}</p>
        : <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">{children}</div>}
    </section>
  );
}

export function MercadoPagoView({ data, puedeCargar, mesLabel }: { data: MercadoPagoData; puedeCargar: boolean; mesLabel: string }) {
  const { total, porLocal, sinClasificar, clasificados, cruce, porDia, importaciones, nombreLocal } = data;
  const nombre = (id: string | null) => (id ? nombreLocal[id] ?? "—" : "Sin local");
  // Cobros sin orden en el sistema, agrupados por local: pueden ser muchos y no son un error por sí solos.
  const qrFijoPorLocal = new Map<string, { n: number; monto: number }>();
  for (const c of cruce.mpSinSistema) {
    const k = c.sucursal_id ?? "";
    const a = qrFijoPorLocal.get(k) ?? { n: 0, monto: 0 };
    a.n += 1;
    a.monto += c.monto_bruto;
    qrFijoPorLocal.set(k, a);
  }

  return (
    <div className="space-y-6">
      <ImportarMp puedeCargar={puedeCargar} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900 capitalize">Cobros por Mercado Pago · {mesLabel}</h2>
        {total.cobros === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-white px-4 py-6 text-center text-sm text-neutral-400">
            No hay cobros importados en este mes.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Tarjeta titulo="Cobrado" valor={AR.format(total.bruto)} nota={`${total.cobros} cobros`} />
              <Tarjeta titulo="Comisión de MP" valor={AR.format(total.tarifa)} nota={total.bruto > 0 ? `${((total.tarifa / total.bruto) * 100).toFixed(2)} % de lo cobrado` : undefined} />
              <Tarjeta titulo="Neto recibido" valor={AR.format(total.neto)} />
              <Tarjeta titulo="A liberar" valor={AR.format(total.aLiberar)} nota="todavía no disponible en MP" />
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                    <th className="px-4 py-2 font-semibold">Local</th>
                    <th className="px-4 py-2 font-semibold text-right">Cobros</th>
                    <th className="px-4 py-2 font-semibold text-right">Cobrado</th>
                    <th className="px-4 py-2 font-semibold text-right">Comisión</th>
                    <th className="px-4 py-2 font-semibold text-right">Neto</th>
                  </tr>
                </thead>
                <tbody>
                  {porLocal.map((l) => (
                    <tr key={l.sucursalId} className="border-b border-neutral-50 last:border-0">
                      <td className="px-4 py-2 text-neutral-900">{l.nombre}</td>
                      <td className="px-4 py-2 text-right">{l.totales.cobros}</td>
                      <td className="px-4 py-2 text-right">{AR.format(l.totales.bruto)}</td>
                      <td className="px-4 py-2 text-right text-neutral-500">{AR.format(l.totales.tarifa)}</td>
                      <td className="px-4 py-2 text-right font-medium">{AR.format(l.totales.neto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <Bloque
        titulo="Para clasificar"
        ayuda="Movimientos de Mercado Pago que no son una venta de caja (por ejemplo un ingreso por transferencia bancaria). No se asume qué son: lo decide quien carga."
        vacio="No hay movimientos sin clasificar."
        cantidad={sinClasificar.length}
      >
        <ul className="divide-y divide-neutral-100">
          {sinClasificar.map((c) => <FilaClasificar key={c.operation_id} c={c} puedeCargar={puedeCargar} />)}
        </ul>
      </Bloque>

      {porDia.length > 0 && (
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">Por día y local: lo que cobró Mercado Pago contra lo que registró el sistema</h2>
            <p className="text-xs text-neutral-500">
              «Sistema» es lo que las ventas dicen que se cobró por billetera o transferencia. Una diferencia positiva es plata que entró a
              Mercado Pago y no figura como cobrada así en las ventas. «Sin orden» son cobros de Mercado Pago que no salieron de una orden creada
              por la pantalla de venta del sistema. Solo se muestran los días de los archivos importados.
            </p>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-400 border-b border-neutral-100">
                  <th className="px-3 py-2 font-semibold">Día</th>
                  <th className="px-3 py-2 font-semibold">Local</th>
                  <th className="px-3 py-2 font-semibold text-right">MP cobró</th>
                  <th className="px-3 py-2 font-semibold text-right">QR del sistema</th>
                  <th className="px-3 py-2 font-semibold text-right">Sin orden</th>
                  <th className="px-3 py-2 font-semibold text-right">Sistema</th>
                  <th className="px-3 py-2 font-semibold text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {porDia.map((f) => (
                  <tr key={`${f.dia}|${f.sucursal_id}`} className="border-b border-neutral-50 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">{f.dia.split("-").reverse().join("/")}</td>
                    <td className="px-3 py-2">{nombre(f.sucursal_id)}</td>
                    <td className="px-3 py-2 text-right">{AR.format(f.mp)}</td>
                    <td className="px-3 py-2 text-right text-neutral-500">{AR.format(f.viaSistema)}</td>
                    <td className="px-3 py-2 text-right text-neutral-500">{f.qrFijo > 0 ? `${AR.format(f.qrFijo)} (${f.qrFijoCobros})` : "—"}</td>
                    <td className="px-3 py-2 text-right">{AR.format(f.sistema)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${Math.abs(f.diferencia) < 1 ? "text-neutral-400" : f.diferencia > 0 ? "text-amber-700" : "text-danger"}`}>
                      {Math.abs(f.diferencia) < 1 ? "—" : AR.format(f.diferencia)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Control contra las ventas del sistema</h2>
          <p className="text-xs text-neutral-500">
            Cada cobro de Mercado Pago se busca entre las órdenes de QR del sistema (por número de operación o referencia).
          </p>
        </div>
        <Bloque titulo="Cobros de Mercado Pago sin orden en el sistema"
          ayuda="Plata que entró a la cuenta de Mercado Pago sin que el sistema haya creado la orden. No es un error por sí solo: hay que ver quién la cobró y si la venta se cargó, y cómo."
          vacio="Todo lo que cobró Mercado Pago pasó por una orden del sistema." cantidad={cruce.mpSinSistema.length}>
          <ul className="divide-y divide-neutral-100">
            {[...qrFijoPorLocal.entries()].map(([id, a]) => (
              <li key={id} className="px-4 py-2 text-sm flex justify-between gap-3">
                <span>{nombre(id || null)}</span>
                <span><b>{a.n}</b> cobros · {AR.format(a.monto)}</span>
              </li>
            ))}
          </ul>
          <details className="border-t border-neutral-100">
            <summary className="px-4 py-2 text-xs text-neutral-500 cursor-pointer">Ver el detalle (los últimos 50)</summary>
            <ul className="divide-y divide-neutral-100">
              {cruce.mpSinSistema.slice(0, 50).map((c) => (
                <li key={c.operation_id} className="px-4 py-2 text-sm flex justify-between gap-3">
                  <span>{AR.format(c.monto_bruto)} · {nombre(c.sucursal_id)}</span>
                  <span className="text-xs text-neutral-400">{fechaHora(c.fecha_cobro)} · op. {c.operation_id}</span>
                </li>
              ))}
            </ul>
          </details>
        </Bloque>
        <Bloque titulo="Cobrado pero sin venta registrada"
          ayuda="El pago llegó y la orden figura pagada, pero no quedó atada a una venta (típico de cuando se cobra y no se cierra la venta)."
          vacio="Todos los cobros tienen su venta." cantidad={cruce.mpSinVenta.length}>
          <ul className="divide-y divide-neutral-100">
            {cruce.mpSinVenta.slice(0, 50).map(({ cobro }) => (
              <li key={cobro.operation_id} className="px-4 py-2 text-sm flex justify-between gap-3">
                <span>{AR.format(cobro.monto_bruto)} · {nombre(cobro.sucursal_id)}</span>
                <span className="text-xs text-neutral-400">{fechaHora(cobro.fecha_cobro)} · op. {cobro.operation_id}</span>
              </li>
            ))}
          </ul>
        </Bloque>
        <Bloque titulo="El sistema dice pagado y Mercado Pago no lo informa"
          ayuda="Solo se miran los días cubiertos por los archivos importados."
          vacio="Nada que no figure en los archivos importados." cantidad={cruce.sistemaSinMp.length}>
          <ul className="divide-y divide-neutral-100">
            {cruce.sistemaSinMp.slice(0, 50).map((o) => (
              <li key={o.external_reference} className="px-4 py-2 text-sm flex justify-between gap-3">
                <span>{AR.format(o.monto)} · {nombre(o.sucursal_id)}</span>
                <span className="text-xs text-neutral-400">{o.paid_at ? fechaHora(o.paid_at) : ""}</span>
              </li>
            ))}
          </ul>
        </Bloque>
        {cruce.distintoMonto.length > 0 && (
          <Bloque titulo="El importe no coincide" ayuda="El cobro y la orden del sistema tienen montos distintos." vacio="" cantidad={cruce.distintoMonto.length}>
            <ul className="divide-y divide-neutral-100">
              {cruce.distintoMonto.slice(0, 50).map(({ cobro, orden }) => (
                <li key={cobro.operation_id} className="px-4 py-2 text-sm flex justify-between gap-3">
                  <span>MP {AR.format(cobro.monto_bruto)} · sistema {AR.format(orden.monto)}</span>
                  <span className="text-xs text-neutral-400">op. {cobro.operation_id}</span>
                </li>
              ))}
            </ul>
          </Bloque>
        )}
      </section>

      {clasificados.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-900">Ya clasificados en este mes</h2>
          <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
            {clasificados.map((c) => (
              <div key={c.operation_id} className="px-4 py-2 text-sm flex justify-between gap-3 flex-wrap">
                <span>{AR.format(c.monto_neto)} · <b>{etiquetaClasificacion(c.clasificacion)}</b>{c.clasificacion_nota && <span className="text-neutral-500"> — {c.clasificacion_nota}</span>}</span>
                <span className="text-xs text-neutral-400">{fechaHora(c.fecha_cobro)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {importaciones.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-900">Archivos importados</h2>
          <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
            {importaciones.map((i) => (
              <div key={i.id} className="px-4 py-2 text-sm flex justify-between gap-3 flex-wrap">
                <span>{i.desde} al {i.hasta} · {i.filas} cobros ({i.nuevas} nuevos)</span>
                <span className="text-xs text-neutral-400">{fechaHora(i.creado_en)}{i.archivo ? ` · ${i.archivo}` : ""}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
