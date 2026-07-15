"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { crearAuditoria } from "../auditoria-actions";
import type { Database } from "@/types/database";

type Product = Database["public"]["Tables"]["products"]["Row"];

export type AuditoriaHoyItem = {
  productName: string;
  sku:         string;
  stockSistema: number;
  stockContado: number;
  diferencia:  number;
  observacion: string | null;
  revisado:    boolean;
  ajusteAplicado: boolean;
};

export type AuditoriaHoy = {
  items: AuditoriaHoyItem[];
};

const NUM = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

export function AuditoriaButton({
  sucursalId,
  products,
  stockMap,
  auditoriaHoy,
}: {
  sucursalId:   string;
  products:     Product[];
  stockMap:     Record<string, number>;
  auditoriaHoy: AuditoriaHoy | null;
}) {
  const [open, setOpen] = useState(false);
  const diferenciasHoy = auditoriaHoy?.items.filter((i) => i.diferencia !== 0).length ?? 0;

  return (
    <>
      <Button
        size="sm"
        variant={auditoriaHoy ? "ghost" : "primary"}
        onClick={() => setOpen(true)}
      >
        {auditoriaHoy ? (
          <>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Auditoría de hoy{diferenciasHoy > 0 ? ` (${diferenciasHoy})` : ""}
          </>
        ) : (
          <>
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Auditoría de hoy
          </>
        )}
      </Button>

      {open && (
        auditoriaHoy
          ? <AuditoriaResumen auditoriaHoy={auditoriaHoy} onClose={() => setOpen(false)} />
          : <AuditoriaForm sucursalId={sucursalId} products={products} stockMap={stockMap} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function AuditoriaResumen({ auditoriaHoy, onClose }: { auditoriaHoy: AuditoriaHoy; onClose: () => void }) {
  const diferencias = auditoriaHoy.items.filter((i) => i.diferencia !== 0);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
          <h2 className="text-base font-semibold font-display text-neutral-900">Auditoría de hoy</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <p className="text-sm text-neutral-500">
            {auditoriaHoy.items.length} productos contados · {diferencias.length} {diferencias.length === 1 ? "diferencia" : "diferencias"}
          </p>
          {diferencias.length === 0 ? (
            <p className="text-sm text-selva-700 bg-selva-50 border border-selva-200 rounded-lg px-3 py-2">
              Todo coincidía con el stock del sistema.
            </p>
          ) : (
            <div className="rounded-xl border border-neutral-200 divide-y divide-neutral-100">
              {diferencias.map((i, idx) => (
                <div key={idx} className="px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-neutral-900">{i.productName}</span>
                    <span className={`tabular-nums font-semibold text-sm ${i.diferencia > 0 ? "text-blue-600" : "text-danger"}`}>
                      {i.diferencia > 0 ? "+" : ""}{NUM.format(i.diferencia)}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Sistema: {NUM.format(i.stockSistema)} · Contado: {NUM.format(i.stockContado)}
                  </p>
                  {i.observacion && <p className="text-xs text-neutral-600 mt-1">{i.observacion}</p>}
                  <p className="text-xs mt-1.5">
                    {i.revisado
                      ? i.ajusteAplicado
                        ? <span className="text-selva-700">✓ Ajuste aprobado por admin</span>
                        : <span className="text-neutral-400">Revisado sin ajustar</span>
                      : <span className="text-amber-600">Pendiente de revisión del admin</span>}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function AuditoriaForm({
  sucursalId, products, stockMap, onClose,
}: {
  sucursalId: string;
  products:   Product[];
  stockMap:   Record<string, number>;
  onClose:    () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch]         = useState("");
  const [counts, setCounts]         = useState<Record<string, string>>({});
  const [observaciones, setObs]     = useState<Record<string, string>>({});
  const [error, setError]           = useState<string | null>(null);

  const sorted = useMemo(
    () => [...products].sort((a, b) => a.name.localeCompare(b.name)),
    [products]
  );
  const filtered = useMemo(() => {
    if (!search.trim()) return sorted;
    const q = search.trim().toLowerCase();
    return sorted.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [sorted, search]);

  function stockSistema(id: string) { return stockMap[id] ?? 0; }
  function contadoDe(id: string) {
    const raw = counts[id];
    if (raw === undefined) return stockSistema(id);
    const v = parseFloat(raw);
    return isNaN(v) ? stockSistema(id) : v;
  }
  function difiere(id: string) { return contadoDe(id) !== stockSistema(id); }

  const pendientesDeObservacion = products.filter((p) => difiere(p.id) && !observaciones[p.id]?.trim());
  const totalDiferencias = products.filter((p) => difiere(p.id)).length;

  function handleSubmit() {
    setError(null);
    if (pendientesDeObservacion.length > 0) {
      setError(`Faltan ${pendientesDeObservacion.length} observaciones en productos con diferencia`);
      return;
    }
    const items = products.map((p) => ({
      product_id:    p.id,
      stock_sistema: stockSistema(p.id),
      stock_contado: contadoDe(p.id),
      observacion:   observaciones[p.id]?.trim() || null,
    }));
    startTransition(async () => {
      const res = await crearAuditoria(sucursalId, items);
      if (res.error) { setError(res.error); return; }
      router.refresh();
      onClose();
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 shrink-0">
          <div>
            <h2 className="text-base font-semibold font-display text-neutral-900">Auditoría de hoy</h2>
            <p className="text-xs text-neutral-400 mt-0.5">Contá lo que hay — el sistema ya viene con su número, solo corregí lo que esté mal.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors shrink-0">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-3 border-b border-neutral-100 shrink-0">
          <input
            type="search"
            placeholder="Buscar por nombre o SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
          />
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-neutral-100">
          {filtered.map((p) => {
            const diff = difiere(p.id);
            const faltaObs = diff && !observaciones[p.id]?.trim();
            return (
              <div key={p.id} className="px-6 py-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-neutral-900 truncate">{p.name}</p>
                    <p className="text-xs text-neutral-400 font-mono">{p.sku} · sistema: {NUM.format(stockSistema(p.id))}</p>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    value={counts[p.id] ?? String(stockSistema(p.id))}
                    onChange={(e) => setCounts((c) => ({ ...c, [p.id]: e.target.value }))}
                    className={`h-10 w-24 rounded-lg border bg-white px-2 text-sm text-right tabular-nums focus:outline-none focus:ring-2 ${
                      diff ? "border-amber-400 focus:border-amber-500 focus:ring-amber-500/20" : "border-neutral-300 focus:border-tierra-700 focus:ring-tierra-700/20"
                    }`}
                  />
                </div>
                {diff && (
                  <input
                    type="text"
                    placeholder="Observación (por qué no coincide) *"
                    value={observaciones[p.id] ?? ""}
                    onChange={(e) => setObs((o) => ({ ...o, [p.id]: e.target.value }))}
                    className={`mt-2 h-9 w-full rounded-lg border bg-white px-3 text-sm focus:outline-none focus:ring-2 ${
                      faltaObs ? "border-danger focus:border-danger focus:ring-danger/20" : "border-neutral-300 focus:border-tierra-700 focus:ring-tierra-700/20"
                    }`}
                  />
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-6 py-10 text-center text-sm text-neutral-400">Sin resultados para "{search}".</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 shrink-0 space-y-2">
          {error && <p className="text-sm text-danger bg-danger/5 border border-danger/20 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span>{totalDiferencias > 0 ? `${totalDiferencias} con diferencia` : "Todo coincide por ahora"}</span>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" size="sm" onClick={onClose} type="button" className="flex-1">Cancelar</Button>
            <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit} className="flex-1">
              Enviar auditoría
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
