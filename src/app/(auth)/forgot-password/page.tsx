"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { Mail, ArrowLeft, CheckCircle } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState("");
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/auth/callback?next=/auth/set-password`,
    });

    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  return (
    <div className="min-h-screen bg-crema-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-2.5 justify-center mb-8">
          <span className="size-9 rounded-xl bg-tierra-700 text-white flex items-center justify-center font-bold text-sm tracking-tight">
            EM
          </span>
          <span className="font-display font-semibold text-xl text-neutral-900">En Minutas</span>
        </div>

        <div className="bg-white rounded-2xl border border-neutral-200 p-8 shadow-sm">
          {sent ? (
            <div className="text-center">
              <div className="size-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="size-6 text-green-600" />
              </div>
              <h1 className="font-semibold text-neutral-900 mb-2">Revisá tu email</h1>
              <p className="text-sm text-neutral-500 leading-relaxed">
                Si existe una cuenta con <strong>{email}</strong>, vas a recibir un link para
                restablecer tu contraseña en los próximos minutos.
              </p>
              <Link
                href="/login"
                className="mt-6 inline-flex items-center gap-1.5 text-sm text-tierra-700 hover:underline"
              >
                <ArrowLeft className="size-3.5" /> Volver al login
              </Link>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-6">
                <div className="size-10 rounded-xl bg-tierra-100 flex items-center justify-center">
                  <Mail className="size-5 text-tierra-700" />
                </div>
                <div>
                  <h1 className="font-semibold text-neutral-900">Recuperar contraseña</h1>
                  <p className="text-sm text-neutral-400">Te enviamos un link por email</p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 mb-1.5">
                    Email de tu cuenta
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    required
                    autoFocus
                    className="w-full px-3 py-2.5 text-sm border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-tierra-700/20"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-tierra-700 text-white text-sm font-medium hover:bg-tierra-800 disabled:opacity-50 transition-colors"
                >
                  {loading ? "Enviando…" : "Enviar link de recuperación"}
                </button>
              </form>

              <Link
                href="/login"
                className="mt-5 flex items-center justify-center gap-1.5 text-sm text-neutral-400 hover:text-neutral-700 transition-colors"
              >
                <ArrowLeft className="size-3.5" /> Volver al login
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
