import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { TermosPanel, type Termo, type Prestamo, type SucursalOpt } from "./_components/termos-panel";

export const revalidate = 0;
export const metadata: Metadata = { title: "Termos — Kioscos IDEIA" };

export default async function TermosPage() {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = (user.app_metadata?.role as string) ?? "";
  const isStaff = role === "encargado" || role === "vendedor";

  let staffSucursalId: string | null = null;
  if (role === "encargado") {
    const { data } = await admin.from("sucursales").select("id").eq("encargado_user_id", user.id).single();
    staffSucursalId = data?.id ?? null;
  } else if (role === "vendedor") {
    const res = await (admin as any).from("profiles").select("sucursal_id").eq("id", user.id).single();
    staffSucursalId = (res.data as { sucursal_id: string | null } | null)?.sucursal_id ?? null;
  }

  if (role !== "admin" && !(isStaff && staffSucursalId)) {
    redirect("/admin/dashboard");
  }

  let sucursales: SucursalOpt[] = [];
  if (role === "admin") {
    const { data } = await admin.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre");
    sucursales = (data ?? []) as SucursalOpt[];
  } else {
    const { data } = await admin.from("sucursales").select("id, nombre").eq("id", staffSucursalId!).single();
    if (data) sucursales = [data as SucursalOpt];
  }

  let termosQuery = (admin as any)
    .from("termos")
    .select("id, sucursal_id, numero, estado")
    .order("numero");
  if (isStaff && staffSucursalId) termosQuery = termosQuery.eq("sucursal_id", staffSucursalId);
  const { data: termosData } = await termosQuery;
  const termos = (termosData ?? []) as Termo[];

  // Préstamos abiertos (todavía afuera) -- lo que importa para "controlar
  // esporádicamente" quién tiene cada termo ahora mismo.
  let prestamosQuery = (admin as any)
    .from("prestamos_termo")
    .select("id, termo_id, sucursal_id, dni, nombre, fecha_prestamo, fecha_devolucion")
    .is("fecha_devolucion", null)
    .order("fecha_prestamo", { ascending: false });
  if (isStaff && staffSucursalId) prestamosQuery = prestamosQuery.eq("sucursal_id", staffSucursalId);
  const { data: prestamosData } = await prestamosQuery;
  const prestamosAbiertos = (prestamosData ?? []) as Prestamo[];

  // Historial reciente de devoluciones -- solo para tener contexto, no hace
  // falta paginar en serio para un puñado de termos por kiosco.
  let historialQuery = (admin as any)
    .from("prestamos_termo")
    .select("id, termo_id, sucursal_id, dni, nombre, fecha_prestamo, fecha_devolucion")
    .not("fecha_devolucion", "is", null)
    .order("fecha_devolucion", { ascending: false })
    .limit(30);
  if (isStaff && staffSucursalId) historialQuery = historialQuery.eq("sucursal_id", staffSucursalId);
  const { data: historialData } = await historialQuery;
  const historial = (historialData ?? []) as Prestamo[];

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Termos</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Alquiler de termos con DNI en garantía — mate y bombilla viajan con el termo</p>
      </div>
      {sucursales.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
          No hay ninguna sucursal asociada a tu usuario.
        </div>
      ) : (
        <TermosPanel
          role={role}
          sucursales={sucursales}
          sucursalFija={isStaff ? staffSucursalId : null}
          termos={termos}
          prestamosAbiertos={prestamosAbiertos}
          historial={historial}
        />
      )}
    </div>
  );
}
