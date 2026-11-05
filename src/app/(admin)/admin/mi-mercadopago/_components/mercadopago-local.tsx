"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Badge, Input } from "@/components/ui";
import type { CajaMp } from "@/lib/mercadopago/pos";
import {
  conectarMercadoPago, desconectarMercadoPago, buscarCajasMercadoPago, asignarIdCajaMercadoPago, elegirCajaMercadoPago,
  type EstadoMercadoPago,
} from "../actions";

export function MercadoPagoLocal({ estado, sucursalId }: { estado: EstadoMercadoPago; sucursalId?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [cajas, setCajas] = useState<CajaMp[] | null>(null);

  function ejecutar(accion: () => Promise<{ error?: string }>, alTerminar?: () => void) {
    setError(null);
    start(async () => {
      const r = await accion();
      if (r.error) { setError(r.error); return; }
      alTerminar?.();
      router.refresh();
    });
  }

  function desconectar() {
    if (!window.confirm("¿Desconectar tu cuenta de Mercado Pago? Dejás de poder cobrar con QR hasta volver a conectarla.")) return;
    ejecutar(() => desconectarMercadoPago(sucursalId), () => setCajas(null));
  }

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</div>}

      <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-neutral-800">1. Cuenta de Mercado Pago</p>
          {estado.conectado ? <Badge>Conectada</Badge> : <Badge>Sin conectar</Badge>}
        </div>

        {estado.conectado ? (
          <>
            <p className="text-sm text-neutral-600">
              Conectada como <span className="font-medium">{estado.cuenta ?? "tu cuenta"}</span>. El token está guardado cifrado y no se vuelve a mostrar.
            </p>
            <Button size="sm" variant="ghost" onClick={desconectar} loading={pending}>Desconectar</Button>
          </>
        ) : (
          <>
            <p className="text-xs text-neutral-500">
              En Mercado Pago entrá a <span className="font-medium">Tu negocio → Configuración → Credenciales</span> (o a
              developers.mercadopago.com → Tus integraciones), creá una aplicación para pagos presenciales / QR y copiá el
              <span className="font-medium"> Access Token de producción</span> (empieza con <span className="font-mono">APP_USR-</span>).
            </p>
            <Input
              label="Access Token de producción *"
              type="password"
              autoComplete="off"
              placeholder="APP_USR-…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Button
              size="sm"
              loading={pending}
              disabled={!token.trim()}
              onClick={() => ejecutar(() => conectarMercadoPago(token, sucursalId), () => setToken(""))}
            >
              Conectar cuenta
            </Button>
          </>
        )}
      </div>

      {estado.conectado && (
        <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-neutral-800">2. Caja del QR</p>
            {estado.posId ? <Badge>Elegida</Badge> : <Badge>Sin elegir</Badge>}
          </div>
          <p className="text-xs text-neutral-500">
            La Caja es el punto de cobro que creaste en Mercado Pago (<span className="font-medium">Cobrar en tu local</span>).
            {estado.posId && <> Caja actual: <span className="font-mono">{estado.posId}</span>.</>}
          </p>
          <Button
            size="sm"
            variant="ghost"
            loading={pending}
            onClick={() => {
              setError(null);
              start(async () => {
                const r = await buscarCajasMercadoPago(sucursalId);
                if (r.error) { setError(r.error); setCajas(null); return; }
                setCajas(r.cajas ?? []);
              });
            }}
          >
            Buscar mis Cajas
          </Button>

          {cajas && cajas.length > 0 && (
            <div className="rounded-lg border border-neutral-200 divide-y divide-neutral-100 overflow-hidden">
              {cajas.map((c) =>
                c.externalId ? (
                  <button
                    key={c.internalId}
                    type="button"
                    disabled={pending}
                    onClick={() => ejecutar(() => elegirCajaMercadoPago(c.externalId!, sucursalId), () => setCajas(null))}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-neutral-50 transition-colors text-left disabled:opacity-50"
                  >
                    <span className="font-medium text-neutral-700">{c.name}</span>
                    <span className="text-neutral-400 font-mono">{c.externalId}</span>
                  </button>
                ) : (
                  <div key={c.internalId} className="w-full flex items-center justify-between px-3 py-2 text-xs">
                    <span className="font-medium text-neutral-700">{c.name}</span>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        ejecutar(async () => {
                          const a = await asignarIdCajaMercadoPago(c.internalId, c.name, sucursalId);
                          if (a.error || !a.externalId) return { error: a.error ?? "No se pudo asignar el ID" };
                          return elegirCajaMercadoPago(a.externalId, sucursalId);
                        }, () => setCajas(null))
                      }
                      className="text-tierra-700 hover:underline font-medium disabled:opacity-50"
                    >
                      Usar esta Caja
                    </button>
                  </div>
                ),
              )}
            </div>
          )}
          <p className="text-xs text-neutral-400">
            Con la Caja elegida aparece el botón "Generar QR" en tu venta rápida, y el cobro entra directo a tu cuenta.
          </p>
        </div>
      )}
    </div>
  );
}
