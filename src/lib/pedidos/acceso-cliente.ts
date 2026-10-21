import { createClient } from "@/lib/supabase/client";

// Ingreso y salida del cliente de la tienda (Google). Solo corre en el navegador. Lo usan el botón
// de la cabecera y la invitación del paso de pago, para que los dos hagan exactamente lo mismo.
// El carrito vive en el navegador (localStorage), así que sobrevive al ida y vuelta con Google.

export async function ingresarConGoogle(): Promise<{ error?: string }> {
  const volver = `${window.location.origin}/auth/cliente/callback?next=${encodeURIComponent(window.location.pathname)}`;
  const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: volver } });
  return error ? { error: "No pudimos abrir el ingreso con Google. Probá de nuevo en un rato." } : {};
}

export async function cerrarSesionCliente(): Promise<void> {
  await createClient().auth.signOut();
}
