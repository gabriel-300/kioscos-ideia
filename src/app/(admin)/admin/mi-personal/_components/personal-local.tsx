"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Badge, Input } from "@/components/ui";
import { crearVendedor, suspenderVendedor, cambiarClaveVendedor } from "../actions";

export interface VendedorFila {
  id: string;
  nombre: string;
  email: string;
  suspendido: boolean;
}

export function PersonalLocal({ vendedores }: { vendedores: VendedorFila[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function ejecutar(accion: () => Promise<{ error?: string }>, alTerminar?: () => void) {
    setError(null);
    start(async () => {
      const r = await accion();
      if (r.error) { setError(r.error); return; }
      alTerminar?.();
      router.refresh();
    });
  }

  function cambiarClave(v: VendedorFila) {
    const nueva = window.prompt(`Nueva contraseña para ${v.nombre} (mínimo 8 caracteres):`);
    if (nueva) ejecutar(() => cambiarClaveVendedor(v.id, nueva));
  }

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">{error}</div>}

      <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
        <p className="text-sm font-semibold text-neutral-800">Nuevo vendedor</p>
        <Input label="Nombre *" placeholder="Nombre completo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <Input label="Email *" type="email" placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Contraseña *" type="password" placeholder="Mínimo 8 caracteres" value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button
          size="sm"
          loading={pending}
          onClick={() => ejecutar(() => crearVendedor({ nombre, email, password }), () => { setNombre(""); setEmail(""); setPassword(""); })}
        >
          Crear vendedor
        </Button>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white divide-y divide-neutral-100">
        {vendedores.length === 0 && <p className="p-4 text-sm text-neutral-400">Todavía no cargaste vendedores.</p>}
        {vendedores.map((v) => (
          <div key={v.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="mr-auto min-w-0">
              <p className="text-sm font-medium text-neutral-900 truncate">{v.nombre}</p>
              <p className="text-xs text-neutral-400 truncate">{v.email}</p>
            </div>
            {v.suspendido && <Badge variant="warning">Suspendido</Badge>}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => cambiarClave(v)}>Cambiar contraseña</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => ejecutar(() => suspenderVendedor(v.id, !v.suspendido))}>
              {v.suspendido ? "Reactivar" : "Suspender"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
