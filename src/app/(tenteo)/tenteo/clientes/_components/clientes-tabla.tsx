"use client";

import { useMemo, useState } from "react";
import { filtrarYOrdenar, type OrdenClientes, type ResumenCliente } from "@/lib/pedidos/clientes-resumen";

const PESOS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const FECHA = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const fecha = (iso: string | null) => (iso ? FECHA.format(new Date(iso)) : "—");

const ORDENES: { valor: OrdenClientes; texto: string }[] = [
  { valor: "gastado",  texto: "Los que más gastaron" },
  { valor: "pedidos",  texto: "Los que más pidieron" },
  { valor: "reciente", texto: "Compraron hace menos" },
  { valor: "nuevos",   texto: "Recién registrados" },
];

// Para escribirle por WhatsApp: solo dígitos, con el 54 de Argentina si falta.
function enlaceWhatsApp(tel: string): string {
  const d = tel.replace(/\D/g, "");
  return `https://wa.me/${d.startsWith("54") ? d : `54${d.replace(/^0+/, "")}`}`;
}

export function ClientesTabla({ clientes }: { clientes: ResumenCliente[] }) {
  const [busqueda, setBusqueda] = useState("");
  const [orden, setOrden] = useState<OrdenClientes>("gastado");
  const filas = useMemo(() => filtrarYOrdenar(clientes, busqueda, orden), [clientes, busqueda, orden]);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex flex-wrap gap-2 border-b border-neutral-100 p-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, mail o teléfono…"
          className="h-10 min-w-[220px] flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:border-tierra-700 focus:outline-none focus:ring-2 focus:ring-tierra-700/20"
        />
        <select value={orden} onChange={(e) => setOrden(e.target.value as OrdenClientes)} className="h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm" aria-label="Ordenar">
          {ORDENES.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
        </select>
      </div>

      {filas.length === 0 ? (
        <p className="p-8 text-center text-sm text-neutral-400">
          {clientes.length === 0 ? "Todavía no hay clientes registrados. Aparecen cuando alguien ingresa con Google en la tienda." : "Ningún cliente coincide con la búsqueda."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-2.5 font-medium">Cliente</th>
                <th className="px-3 py-2.5 font-medium">Teléfono</th>
                <th className="px-3 py-2.5 text-right font-medium">Pedidos</th>
                <th className="px-3 py-2.5 text-right font-medium">Gastó</th>
                <th className="px-3 py-2.5 font-medium">Último pedido</th>
                <th className="px-4 py-2.5 font-medium">Se registró</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => (
                <tr key={c.id} className="border-b border-neutral-50 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-neutral-900">{c.nombre ?? <span className="text-neutral-400">Sin nombre</span>}</p>
                    {c.email && <p className="text-xs text-neutral-500">{c.email}</p>}
                  </td>
                  <td className="px-3 py-3">
                    {c.telefono ? (
                      <a href={enlaceWhatsApp(c.telefono)} target="_blank" rel="noopener noreferrer" style={{ color: "#15803d" }} className="font-medium underline">{c.telefono}</a>
                    ) : <span className="text-neutral-400">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{c.pedidos}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-neutral-900">{c.pedidos > 0 ? PESOS.format(c.gastado) : "—"}</td>
                  <td className="px-3 py-3 tabular-nums text-neutral-600">{fecha(c.ultimoPedido)}</td>
                  <td className="px-4 py-3 tabular-nums text-neutral-500">{fecha(c.alta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
