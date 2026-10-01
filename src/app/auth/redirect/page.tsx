import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { COOKIE_SISTEMA, destinoDeSistema, rolDe, sistemaValido, sistemasDe } from "@/lib/auth/acceso";

// Destino tras el login (y tras cambiar de sistema). Lee el rol y los sistemas
// FRESCOS con la admin API. Un solo sistema: entra directo. Los dos: usa el
// pedido (?sistema=) o la última elección guardada; si no hay ninguna, pregunta.
export default async function AuthRedirectPage({ searchParams }: { searchParams: Promise<{ sistema?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(user.id);
  const role = rolDe(data?.user) ?? undefined;

  const sistemas = sistemasDe(data?.user);
  if (!role || sistemas.length === 0) redirect("/login");

  const pedido = sistemaValido((await searchParams).sistema);
  const guardado = sistemaValido((await cookies()).get(COOKIE_SISTEMA)?.value);
  const elegido =
    (pedido && sistemas.includes(pedido) ? pedido : null) ??
    (sistemas.length === 1 ? sistemas[0] : null) ??
    (guardado && sistemas.includes(guardado) ? guardado : null);

  if (!elegido) redirect("/elegir-sistema");
  // Personal de Tenteo (incluido el repartidor): directo a su sistema.
  if (elegido === "tenteo") redirect(destinoDeSistema("tenteo", role));

  if (role === "admin") {
    redirect("/admin/dashboard");
  } else if (role === "encargado" || role === "concesionario") {
    const { data: sucursal } = await admin
      .from("sucursales")
      .select("id")
      .eq("encargado_user_id", user.id)
      .single();
    redirect(sucursal ? `/admin/sucursales/${sucursal.id}` : "/admin/dashboard");
  } else if (role === "vendedor") {
    // Un vendedor puede estar habilitado en más de una sucursal
    // (profile_sucursales) -- con 0 va al dashboard como siempre, con 1
    // entra directo (mismo comportamiento de siempre, sin fricción extra
    // para el caso común), con 2+ va al picker de sucursales.
    const { data: asignadas } = await (admin as any)
      .from("profile_sucursales")
      .select("sucursal_id")
      .eq("profile_id", user.id) as { data: { sucursal_id: string }[] | null };
    const lista = asignadas ?? [];
    if (lista.length === 0) redirect("/admin/dashboard");
    else if (lista.length === 1) redirect(`/admin/sucursales/${lista[0].sucursal_id}`);
    else redirect("/admin/sucursales");
  } else {
    redirect("/login");
  }
}
