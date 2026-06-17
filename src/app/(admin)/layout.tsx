import { createClient } from "@/lib/supabase/server";
import { AdminNav } from "@/components/admin/admin-nav";
import { redirect } from "next/navigation";

const STAFF_ROLES = ["admin", "vendedor", "produccion", "distribucion"];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const role  = (user.app_metadata?.role as string) ?? null;
  if (!role || !STAFF_ROLES.includes(role)) redirect("/b2b/catalogo");

  const email = user.email ?? null;
  const name  = (user.user_metadata?.full_name as string | null) ?? null;

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <AdminNav role={role} email={email} name={name} />
      <main className="flex-1 overflow-auto pt-14 md:pt-0">{children}</main>
    </div>
  );
}
