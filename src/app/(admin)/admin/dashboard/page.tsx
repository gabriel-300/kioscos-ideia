import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Dashboard — Kioscos IDEIA" };
export const revalidate = 0;

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = user.app_metadata?.role as string | undefined;
  const now  = new Date().toLocaleDateString("es-AR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="p-4 md:p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Dashboard</h1>
        <p className="text-sm text-neutral-400 mt-0.5 capitalize">{now}</p>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center">
        <div className="size-16 rounded-2xl bg-tierra-50 flex items-center justify-center mx-auto mb-4">
          <svg className="size-8 text-tierra-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-neutral-900 font-display mb-2">Sistema en construcción</h2>
        <p className="text-sm text-neutral-500 max-w-sm mx-auto">
          Usá el menú lateral para navegar. Las sucursales y el control de stock estarán disponibles en breve.
        </p>
      </div>
    </div>
  );
}
