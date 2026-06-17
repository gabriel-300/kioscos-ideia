"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Input } from "@/components/ui";

type Zone = { id: string; name: string; flete_kg: number | null };

const CANAL_OPTIONS = [
  { value: "dist",   label: "Distribuidor / Franquicia" },
  { value: "gastro", label: "Gastronomía / Supermercado" },
  { value: "min",    label: "Minorista" },
];

export function RegisterForm({ zones }: { zones: Zone[] }) {
  const router = useRouter();
  const [empresa, setEmpresa]   = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [canal, setCanal]       = useState("");
  const [zonaId, setZonaId]     = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (!canal) {
      setError("Seleccioná el tipo de cliente.");
      return;
    }
    if (!zonaId) {
      setError("Seleccioná tu zona de entrega.");
      return;
    }

    setLoading(true);

    const zonaNombre = zones.find((z) => z.id === zonaId)?.name ?? zonaId;

    const res = await fetch("/api/auth/registro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, empresa, canal, zonaId, zonaNombre }),
    });

    const json = await res.json();

    if (!res.ok) {
      setError(json.error ?? "Error al crear la cuenta. Intentá de nuevo.");
      setLoading(false);
      return;
    }

    router.push("/pendiente");
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="size-12 rounded-full bg-tierra-700 text-white flex items-center justify-center mx-auto mb-4 font-display font-bold text-lg">
          EM
        </div>
        <h1 className="font-display text-2xl font-semibold text-neutral-900">
          Solicitar acceso
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Tu cuenta será revisada por el equipo antes de activarse
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-neutral-200 p-6 flex flex-col gap-4">
        <Input
          label="Nombre de la empresa"
          value={empresa}
          onChange={(e) => setEmpresa(e.target.value)}
          autoComplete="organization"
          required
        />
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <Input
          label="Contraseña"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          hint="Mínimo 8 caracteres"
          required
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
            Tipo de cliente
          </label>
          <select
            value={canal}
            onChange={(e) => setCanal(e.target.value)}
            required
            className="w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm text-neutral-800 bg-white focus:outline-none focus:ring-2 focus:ring-tierra-700/20 focus:border-tierra-700"
          >
            <option value="">Seleccioná...</option>
            {CANAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
            Zona de entrega
          </label>
          <select
            value={zonaId}
            onChange={(e) => setZonaId(e.target.value)}
            required
            className="w-full border border-neutral-200 rounded-xl px-3 py-2.5 text-sm text-neutral-800 bg-white focus:outline-none focus:ring-2 focus:ring-tierra-700/20 focus:border-tierra-700"
          >
            <option value="">Seleccioná...</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </select>
        </div>

        {error && (
          <p className="text-sm text-danger text-center">{error}</p>
        )}

        <Button variant="primary" type="submit" loading={loading} className="w-full mt-1">
          Solicitar acceso
        </Button>
      </form>

      <p className="text-center text-sm text-neutral-500 mt-4">
        ¿Ya tenés cuenta?{" "}
        <Link href="/login" className="text-tierra-700 font-medium hover:underline">
          Iniciá sesión
        </Link>
      </p>
    </div>
  );
}
