"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Eye, EyeOff, KeyRound } from "lucide-react";

export default function SetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden");
      return;
    }

    setLoading(true);
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    // Redirigir según rol
    const { data: { session } } = await supabase.auth.getSession();
    const jwt = session?.access_token ?? "";
    const payload = jwt ? JSON.parse(atob(jwt.split(".")[1])) : {};
    const role = payload.app_metadata?.role as string | undefined;

    if (role === "admin" || role === "vendedor") {
      router.push("/admin/pedidos");
    } else if (role === "produccion") {
      router.push("/admin/produccion");
    } else if (role === "customer_b2b") {
      router.push("/b2b/catalogo");
    } else {
      router.push("/tienda");
    }
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
          <div className="flex items-center gap-3 mb-6">
            <div className="size-10 rounded-xl bg-tierra-100 flex items-center justify-center">
              <KeyRound className="size-5 text-tierra-700" />
            </div>
            <div>
              <h1 className="font-semibold text-neutral-900">Crear contraseña</h1>
              <p className="text-sm text-neutral-400">Configurá tu acceso al panel</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1.5">
                Contraseña *
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  required
                  className="w-full px-3 py-2.5 pr-10 text-sm border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-tierra-700/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                >
                  {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-500 mb-1.5">
                Confirmar contraseña *
              </label>
              <input
                type={showPw ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repetí la contraseña"
                required
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
              {loading ? "Guardando…" : "Guardar contraseña e ingresar"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-neutral-400 mt-4">
          ¿Problemas para acceder? Contactá al administrador.
        </p>
      </div>
    </div>
  );
}
