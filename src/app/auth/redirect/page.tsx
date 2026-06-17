import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Esta página actúa como intermediario post-login.
// Lee el rol real desde raw_app_meta_data via admin API (no desde el JWT,
// que el custom_access_token_hook sobreescribe con profiles.role).
export default async function AuthRedirectPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(user.id);
  const role = data?.user?.app_metadata?.role as string | undefined;
  const b2bStatus = data?.user?.app_metadata?.b2b_status as string | undefined;

  if (role === "admin" || role === "vendedor" || role === "admin_enminutas" || role === "admin_ideaia") {
    redirect("/admin/pedidos");
  } else if (role === "produccion") {
    redirect("/admin/produccion");
  } else if (role === "distribucion") {
    redirect("/admin/distribucion");
  } else if (role === "repartidor") {
    redirect("/repartidor/activos");
  } else if (role === "customer_b2b") {
    redirect(b2bStatus === "activo" ? "/b2b/catalogo" : "/pendiente");
  } else {
    redirect("/tienda");
  }
}
