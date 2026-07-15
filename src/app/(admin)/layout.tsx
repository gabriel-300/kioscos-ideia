import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/admin/admin-nav";
import { NumberInputWheelGuard } from "@/components/admin/number-input-wheel-guard";
import { redirect } from "next/navigation";

const STAFF_ROLES = ["admin", "encargado", "vendedor"];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const role = (user.app_metadata?.role as string) ?? null;
  if (!role || !STAFF_ROLES.includes(role)) redirect("/login");

  const email = user.email ?? null;
  const name  = (user.user_metadata?.full_name as string | null) ?? null;

  let sucursalId: string | null = null;
  if (role === "encargado") {
    const { data } = await supabase
      .from("sucursales")
      .select("id")
      .eq("encargado_user_id", user.id)
      .single();
    sucursalId = data?.id ?? null;
  } else if (role === "vendedor") {
    const res = await (supabase as any).from("profiles").select("sucursal_id").eq("id", user.id).single();
    sucursalId = (res.data as { sucursal_id: string | null } | null)?.sucursal_id ?? null;
  }

  let auditoriaPendientes = 0;
  if (role === "admin") {
    const { count } = await (supabase as any)
      .from("auditoria_stock_items")
      .select("id", { count: "exact", head: true })
      .neq("diferencia", 0)
      .is("revisado_por", null);
    auditoriaPendientes = count ?? 0;
  }

  return (
    <div className="h-screen flex flex-col bg-neutral-50">
      <NumberInputWheelGuard />
      <AdminNav role={role} email={email} name={name} sucursalId={sucursalId} auditoriaPendientes={auditoriaPendientes} />
      <main className="flex-1 overflow-auto pt-14 md:pt-0">{children}</main>
    </div>
  );
}
