import { etiquetaCategoria } from "@/lib/tesoreria/tipos";
import type { Deuda, ObligacionMes, ResumenEgresos } from "@/lib/tesoreria/calculos";
import type { ACobrarPeya } from "@/lib/tesoreria/peya";
import type { AlertaTesoreria } from "@/lib/tesoreria/alertas";
import Link from "next/link";
import { EfectivoInicialForm } from "./efectivo-inicial-form";
import { describirHistorial } from "@/lib/tesoreria/historial";
import type { CambiosEfectivoInicial } from "@/lib/tesoreria/consultas";

const AR = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export interface ResumenData {
  entro:            number;            // ventas cobradas del mes (turnos cerrados)
  gasto:            ResumenEgresos;    // egresos del mes por fecha de compra, pagados o no
  deuda:            { items: Deuda[]; total: number };
  obligaciones:     { items: ObligacionMes[]; pendiente: number; sinRegistrar: number; registrado: number; estimadoTotal: number };
  mp:               { configurada: boolean; disponible: number };   // cuenta de Mercado Pago (migración 107)
  alertas:          AlertaTesoreria[]; // «Para revisar»: lo que no cierra o no coincide y alguien tiene que mirar
  peya:             ACobrarPeya;       // lo que PedidosYa todavía no pagó (informativo, fuera de «tengo menos debo»)
  tengoMenosDebo:   number | null;     // efectivo en mano − lo que se debe a proveedores − obligaciones sin registrar (solo mes en curso)
  efectivo:         { efectivo: number; sobres: number; salidas: number; inicial: number };
  sobresSinRetirar: number;
  cambiosEfectivoInicial: CambiosEfectivoInicial;   // cuántas veces se tocó y el último cambio (del historial)
}

function Tarjeta({ titulo, valor, pie, tono = "neutro" }: { titulo: string; valor: string; pie?: string; tono?: "neutro" | "rojo" | "verde" | "ambar" }) {
  const clases = {
    neutro: "border-neutral-200 bg-white text-neutral-900",
    rojo:   "border-red-200 bg-red-50 text-red-700",
    verde:  "border-selva-200 bg-selva-50 text-selva-700",
    ambar:  "border-amber-200 bg-amber-50 text-amber-700",
  }[tono];
  return (
    <div className={`rounded-xl border p-4 ${clases}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-1">{titulo}</p>
      <p className="text-2xl font-bold font-display tabular-nums">{valor}</p>
      {pie && <p className="text-xs text-neutral-400 mt-0.5">{pie}</p>}
    </div>
  );
}

export function ResumenView({ data, mesLabel, puedeCargar }: { data: ResumenData; mesLabel: string; puedeCargar: boolean }) {
  const diferencia = data.entro - data.gasto.operativos;
  return (
    <div className="space-y-8">
      {data.alertas.length > 0 && (
        <section aria-label="Para revisar">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-3">Para revisar ({data.alertas.length})</p>
          <ul className="space-y-2">
            {data.alertas.map((a) => (
              <li key={a.id} className={`rounded-xl border p-3 ${a.nivel === "rojo" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                <p className={`text-sm font-semibold ${a.nivel === "rojo" ? "text-red-800" : "text-amber-900"}`}>{a.titulo}</p>
                <p className="text-xs text-neutral-600 mt-0.5">{a.detalle}</p>
                <Link href={a.href} className="text-xs font-semibold underline text-neutral-800 mt-1 inline-block">Revisar</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-3 capitalize">{mesLabel}</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Tarjeta titulo="Entró" valor={AR.format(data.entro)} pie="Ventas cobradas de los turnos cerrados" />
          <Tarjeta titulo="Salió" valor={AR.format(data.gasto.operativos)} pie="Gastos y compras del mes, pagados o no" tono="rojo" />
          <Tarjeta titulo="Entró menos salió" valor={`${diferencia >= 0 ? "+" : ""}${AR.format(diferencia)}`}
            pie="No es la ganancia: faltan el costo de lo vendido y lo que aún no se cargó" tono={diferencia >= 0 ? "verde" : "rojo"} />
        </div>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 mb-3">Hoy</p>
        {data.tengoMenosDebo !== null && <div className="mb-4">
          <Tarjeta titulo="Tengo menos debo" valor={`${data.tengoMenosDebo >= 0 ? "" : "−"}${AR.format(Math.abs(data.tengoMenosDebo))}`}
            pie={`Efectivo en mano ${AR.format(data.efectivo.efectivo)}${data.mp.configurada ? ` + Mercado Pago disponible ${AR.format(data.mp.disponible)}` : ""} − proveedores ${AR.format(data.deuda.total)} − obligaciones del mes sin registrar ${AR.format(data.obligaciones.pendiente)}. ${data.mp.configurada ? "No incluye bancos." : "Falta cargar el saldo de Mercado Pago (solapa Cuentas): hoy solo cuenta el efectivo."}`}
            tono={data.tengoMenosDebo >= 0 ? "verde" : "rojo"} />
        </div>}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Tarjeta titulo="Se debe" valor={AR.format(data.deuda.total)} pie="A proveedores: compras que se deben menos pagos" tono={data.deuda.total > 0 ? "ambar" : "neutro"} />
          <Tarjeta titulo="Obligaciones sin registrar" valor={AR.format(data.obligaciones.pendiente)}
            pie={data.obligaciones.sinRegistrar === 0 ? "Todo lo del mes está registrado" : `${data.obligaciones.sinRegistrar} de ${data.obligaciones.items.length} del mes (sueldos, alquiler, cuotas…)`}
            tono={data.obligaciones.pendiente > 0 ? "ambar" : "neutro"} />
          <Tarjeta titulo="Efectivo en mano" valor={AR.format(data.efectivo.efectivo)} pie="Lo de Tesorería, sin contar los kioscos" />
          <Tarjeta titulo="Sobres en los kioscos" valor={AR.format(data.sobresSinRetirar)} pie="Cerrados desde el arranque, todavía sin retirar" />
        </div>
        {data.peya.cantidad > 0 && (
          <p className="text-xs text-neutral-500 mt-3">
            A cobrar de PedidosYa: <b>{AR.format(data.peya.confirmado)}</b> confirmado
            {data.peya.estimado > 0 ? ` + ${AR.format(data.peya.estimado)} estimado` : ""}
            {data.peya.proxima ? ` · próximo cobro el ${data.peya.proxima.fecha.split("-").reverse().join("/")}${data.peya.proxima.confirmada ? "" : " (estimado)"}` : ""}.
            Es informativo: no suma a «Tengo menos debo» hasta que la plata llega a Mercado Pago.{" "}
            <Link href="/admin/tesoreria?vista=pedidosya" className="font-semibold underline">Ver las liquidaciones</Link>
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900 mb-3">En qué se gastó</h2>
          {data.gasto.porCategoria.length === 0 ? (
            <p className="text-sm text-neutral-400">Todavía no hay egresos cargados este mes.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.gasto.porCategoria.map((c) => (
                <li key={c.categoria} className="flex justify-between text-sm">
                  <span className="text-neutral-600">{etiquetaCategoria(c.categoria)}</span>
                  <span className="tabular-nums font-medium text-neutral-800">{AR.format(c.monto)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 pt-3 border-t border-neutral-100 space-y-1 text-xs text-neutral-500">
            <p className="flex justify-between"><span>Con factura</span><span className="tabular-nums">{AR.format(data.gasto.conFactura)}</span></p>
            <p className="flex justify-between"><span>Sin factura</span><span className="tabular-nums">{AR.format(data.gasto.sinFactura)}</span></p>
            <p className="flex justify-between"><span>Retiros de socios (aparte)</span><span className="tabular-nums">{AR.format(data.gasto.retirosSocio)}</span></p>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900 mb-3">Obligaciones del mes</h2>
          {data.obligaciones.items.length === 0 ? (
            <p className="text-sm text-neutral-400">No hay gastos fijos cargados. Se editan en la solapa Obligaciones.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.obligaciones.items.map((o) => (
                <li key={o.id} className="flex justify-between gap-3 text-sm">
                  <span className="text-neutral-600">
                    {o.descripcion} <span className="text-xs text-neutral-400">· día {Number(o.vencimiento.slice(8))}</span>
                    {o.vencida && <span className="ml-1.5 text-xs font-medium text-red-600">vencida</span>}
                  </span>
                  <span className={`tabular-nums font-medium ${o.registrada ? "text-selva-700" : "text-neutral-800"}`}>
                    {o.registrada ? `${AR.format(o.pagado)} pagado` : `~${AR.format(o.estimado)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900 mb-3">A quién se le debe</h2>
          {data.deuda.items.length === 0 ? (
            <p className="text-sm text-neutral-400">No hay compras pendientes de pago.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.deuda.items.map((d) => (
                <li key={d.clave} className="flex justify-between text-sm">
                  <span className="text-neutral-600">{d.nombre} <span className="text-xs text-neutral-400">({d.cantidad})</span></span>
                  <span className="tabular-nums font-medium text-neutral-800">{AR.format(d.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900 mb-3">Cómo se arma el efectivo en mano</h2>
        <ul className="space-y-1.5 text-sm">
          <li className="flex justify-between"><span className="text-neutral-600">Efectivo con el que arrancó Tesorería</span><span className="tabular-nums">{AR.format(data.efectivo.inicial)}</span></li>
          <li className="flex justify-between"><span className="text-neutral-600">+ Sobres retirados de los kioscos</span><span className="tabular-nums">{AR.format(data.efectivo.sobres)}</span></li>
          <li className="flex justify-between"><span className="text-neutral-600">− Pagado en efectivo de Tesorería</span><span className="tabular-nums">{AR.format(data.efectivo.salidas)}</span></li>
          <li className="flex justify-between pt-1.5 border-t border-neutral-100 font-semibold"><span>= Efectivo en mano</span><span className="tabular-nums">{AR.format(data.efectivo.efectivo)}</span></li>
        </ul>
        <p className="text-xs text-neutral-400 mt-3">Lo que se pagó con plata del cajón de un kiosco (retiro de caja), con transferencia o con Mercado Pago no resta acá.</p>
        {data.cambiosEfectivoInicial.ultimo ? (
          <p className="text-xs text-neutral-500 mt-3">
            El efectivo inicial se cambió {data.cambiosEfectivoInicial.total} {data.cambiosEfectivoInicial.total === 1 ? "vez" : "veces"}. Último cambio:{" "}
            {new Date(data.cambiosEfectivoInicial.ultimo.creado_en).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            {" "}por {data.cambiosEfectivoInicial.ultimo.usuario ?? "un usuario desconocido"} — {describirHistorial(data.cambiosEfectivoInicial.ultimo).toLowerCase()}
            {data.cambiosEfectivoInicial.ultimo.motivo && <> («{data.cambiosEfectivoInicial.ultimo.motivo}»)</>}. Todo el detalle está en la solapa Historial.
          </p>
        ) : (
          <p className="text-xs text-amber-700 mt-3">Todavía no se cargó el efectivo inicial.</p>
        )}
        {puedeCargar && <div className="mt-3"><EfectivoInicialForm valorActual={data.efectivo.inicial} requiereMotivo={data.cambiosEfectivoInicial.total > 0} /></div>}
      </section>
    </div>
  );
}
