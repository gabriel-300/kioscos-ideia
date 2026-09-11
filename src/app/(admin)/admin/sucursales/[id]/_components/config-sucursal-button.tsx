"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actualizarCategoriasHabilitadas, actualizarCanalesHabilitados } from "../../actions";

type Categoria = { id: string; name: string };
type Canal = { id: string; label: string };

const TODOS_LOS_CANALES: Canal[] = [
  { id: "consumidor_final",     label: "Consumidor Final" },
  { id: "pedido_ya_efectivo",   label: "Pedido Ya Efectivo" },
  { id: "pedido_ya_plataforma", label: "Pedido Ya Plataforma" },
  { id: "cuenta_corriente",     label: "Cta. Corriente" },
  { id: "ambulante",            label: "Ambulante" },
  { id: "ronda_comunidad",      label: "Ronda comunidad" },
];

// Admin-only: qué categorías de producto y qué canales de venta puede usar
// esta sucursal (migración 088). Vacío/todo tildado = sin restricción (el
// comportamiento de siempre para cualquier sucursal que no toque esto).
export function ConfigSucursalButton({
  sucursalId, categorias, categoriasHabilitadas, canalesHabilitadas,
}: {
  sucursalId: string;
  categorias: Categoria[];
  categoriasHabilitadas: string[] | null;
  canalesHabilitadas: string[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState<string[]>(categoriasHabilitadas ?? categorias.map((c) => c.id));
  const [canales, setCanales] = useState<string[]>(canalesHabilitadas ?? TODOS_LOS_CANALES.map((c) => c.id));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function toggle(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  function guardar() {
    setError(null);
    startTransition(async () => {
      // Todo tildado equivale a "sin restricción" -- se guarda vacío, no la
      // lista completa (así una categoría nueva que se cree después no queda
      // bloqueada por default).
      const catsAGuardar    = cats.length === categorias.length ? [] : cats;
      const canalesAGuardar = canales.length === TODOS_LOS_CANALES.length ? [] : canales;
      const [r1, r2] = await Promise.all([
        actualizarCategoriasHabilitadas(sucursalId, catsAGuardar),
        actualizarCanalesHabilitados(sucursalId, canalesAGuardar),
      ]);
      if (r1.error || r2.error) { setError(r1.error ?? r2.error ?? "Error"); return; }
      router.refresh();
      setOpen(false);
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-neutral-200 bg-white hover:border-tierra-300 hover:bg-tierra-50 transition-colors text-sm font-medium text-neutral-700 hover:text-tierra-700"
      >
        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Configuración
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative z-10 bg-white rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold font-display text-neutral-900">Configuración de la sucursal</h3>
            <p className="text-xs text-neutral-400 -mt-2">Restringe qué categorías y canales de venta usa este local. Sin nada desmarcado = sin restricción.</p>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">Categorías habilitadas</p>
              <div className="space-y-1.5">
                {categorias.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={cats.includes(c.id)} onChange={() => toggle(cats, setCats, c.id)} className="rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700" />
                    <span className="text-sm text-neutral-700">{c.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-2">Canales de venta habilitados</p>
              <div className="space-y-1.5">
                {TODOS_LOS_CANALES.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={canales.includes(c.id)} onChange={() => toggle(canales, setCanales, c.id)} className="rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700" />
                    <span className="text-sm text-neutral-700">{c.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={() => setOpen(false)} className="flex-1 h-10 rounded-lg border border-neutral-300 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 transition-colors">
                Cancelar
              </button>
              <button onClick={guardar} disabled={pending} className="flex-1 h-10 rounded-lg bg-tierra-700 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity">
                {pending ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
