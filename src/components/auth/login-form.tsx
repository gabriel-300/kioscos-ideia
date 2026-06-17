"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { Button, Input } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError("Email o contraseña incorrectos.");
      setLoading(false);
      return;
    }

    // /auth/redirect es una página server-side que lee el rol real via admin API
    // y hace el redirect correspondiente, evitando el JWT modificado por el hook.
    router.push("/auth/redirect");
  }

  return (
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="size-12 rounded-full bg-tierra-700 text-white flex items-center justify-center mx-auto mb-4 font-display font-bold text-lg">
          EM
        </div>
        <h1 className="font-display text-2xl font-semibold text-neutral-900">
          Iniciar sesión
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Accedé a tu cuenta de En Minutas
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-neutral-200 p-6 flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-neutral-500">Contraseña</span>
            <Link href="/forgot-password" className="text-xs text-tierra-700 hover:underline">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <p className="text-sm text-danger text-center">{error}</p>
        )}

        <Button variant="primary" type="submit" loading={loading} className="w-full mt-1">
          Ingresar
        </Button>
      </form>

      <p className="text-center text-sm text-neutral-500 mt-4">
        ¿No tenés cuenta?{" "}
        <Link href="/registro" className="text-tierra-700 font-medium hover:underline">
          Registrate
        </Link>
      </p>
    </div>
  );
}
