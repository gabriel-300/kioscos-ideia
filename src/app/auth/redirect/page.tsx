import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export default async function AuthRedirectPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(user.id);
  const role = data?.user?.app_metadata?.role as string | undefined;

  if (role === "admin") {
    redirect("/admin/dashboard");
  } else if (role === "encargado") {
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
