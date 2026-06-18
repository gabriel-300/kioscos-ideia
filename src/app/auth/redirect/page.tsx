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
  } else {
    redirect("/login");
  }
}
