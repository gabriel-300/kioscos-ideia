"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { leerPedidosRecordados, type PedidoResumen } from "@/lib/pedidos/mis-pedidos";
import { leerPedidoReciente } from "@/lib/pedidos/pedido-reciente";
import { consultarMisPedidos } from "../actions";
import { fmt } from "../../_lib/tema";

// Lista de pedidos del cliente. Los de su cuenta llegan ya cargados desde el servidor; los que este navegador
// recuerda (pedidos hechos sin cuenta) se piden aparte. Se actualiza sola mientras alguno siga en curso.

const FECHA = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const CADA_MS = 20_000;

function chip(p: PedidoResumen): string {
  if (p.estado === "entregado") return "bg-pd-success/15 text-pd-success";
  if (p.estado === "cancelado" || p.estado === "expirado") return "bg-pd-warm text-pd-ink-600";
  if (p.estado === "pendiente_pago") return "bg-pd-warn text-pd-warn-ink";
  return "bg-pd-tint text-pd-ember";
}

export function ListaMisPedidos({ sucursalId, iniciales }: { sucursalId: string; iniciales: PedidoResumen[] }) {
  const router = useRouter();
  const [locales, setLocales] = useState<PedidoResumen[]>([]);
  const [cargado, setCargado] = useState(false);

  const cargarLocales = useCallback(async () => {
    const delServidor = new Set(iniciales.map((p) => p.id));
    const recordados = leerPedidosRecordados(localStorage).map((p) => p.pedidoId);
    const reciente = leerPedidoReciente(localStorage)?.pedidoId; // pedidos de antes de "Mis pedidos"
    const ids = [...new Set([...recordados, ...(reciente ? [reciente] : [])])].filter((id) => !delServidor.has(id));
    setLocales(ids.length > 0 ? await consultarMisPedidos(ids) : []);
    setCargado(true);
  }, [iniciales]);

  useEffect(() => { void cargarLocales(); }, [cargarLocales]);

  const pedidos = [...iniciales, ...locales].sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  const enCurso = pedidos.some((p) => !p.final);

  useEffect(() => {
    if (!enCurso) return;
    const actualizar = () => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      void cargarLocales();
    };
    const timer = setInterval(actualizar, CADA_MS);
    return () => clearInterval(timer);
  }, [enCurso, router, cargarLocales]);

  if (pedidos.length === 0) {
    return (
      <div className="rounded-3xl border border-pd-line bg-white p-8 text-center">
        <p className="pd-display text-[18px] font-bold text-pd-ink-900">{cargado ? "Todavía no hiciste pedidos" : "Buscando tus pedidos…"}</p>
        {cargado && (
          <>
            <p className="mt-1.5 text-[14px] text-pd-ink-600">Cuando pidas, lo vas a ver acá y podés seguirlo paso a paso.</p>
            <Link href={`/pedir/${sucursalId}`} style={{ color: "#fff" }} className="pd-display mt-4 inline-flex h-11 items-center rounded-full bg-pd-ember px-6 text-[14px] font-bold">Ver el menú</Link>
          </>
        )}
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {pedidos.map((p) => (
        <li key={p.id}>
          <Link
            href={`/pedir/${p.sucursalId}/pedido/${p.id}`}
            style={{ color: "var(--color-pd-ink)" }}
            className="block rounded-3xl border border-pd-line bg-white p-4 active:bg-pd-warm md:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="pd-display text-[16px] font-bold">Pedido #{p.numero}{p.sucursal ? ` · ${p.sucursal}` : ""}</p>
                <p className="mt-0.5 text-[12.5px] text-pd-ink-600">{FECHA.format(new Date(p.creadoEn))} · {p.delivery ? "Envío" : "Retiro"}</p>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-bold ${chip(p)}`}>{p.titulo}</span>
            </div>
            {p.resumen && <p className="mt-2.5 text-[13.5px] leading-snug text-pd-ink-600">{p.resumen}</p>}
            <div className="mt-3 flex items-center justify-between">
              <span className="pd-display text-[16px] font-extrabold tabular-nums">{fmt(p.total)}</span>
              <span className="text-[13px] font-semibold text-pd-ember">{p.final ? "Ver detalle →" : "Seguir pedido →"}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
