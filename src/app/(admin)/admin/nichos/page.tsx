import type { Metadata } from "next";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { NichosBoard, type Contacto, type Nicho, type SucursalOpt } from "./_components/nichos-board";

export const revalidate = 0;
export const metadata: Metadata = { title: "Nichos — Kioscos IDEIA" };

export default async function NichosPage() {
  const supabase = await createClient();
  const admin    = createAdminClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role as string) ?? null;
  // El vendedor de turno no gestiona el CRM -- lo carga el encargado del local
  // (pedido explícito), o el admin.
  if (role !== "admin" && role !== "encargado") redirect("/admin/dashboard");

  let sucursales: SucursalOpt[] = [];
  let sucursalFija: string | null = null;

  if (role === "admin") {
    const { data } = await admin.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre");
    sucursales = (data ?? []) as SucursalOpt[];
  } else {
    const { data: suc } = await admin
      .from("sucursales").select("id, nombre").eq("encargado_user_id", user.id).single();
    if (suc) { sucursales = [suc as SucursalOpt]; sucursalFija = suc.id; }
  }

  const nichosRes = await (admin as any)
    .from("nichos").select("id, nombre, descripcion, horario_pico, color_tag")
    .eq("is_active", true).order("nombre");
  const nichos = (nichosRes.data ?? []) as Nicho[];

  let contactosQuery = (admin as any)
    .from("contactos_crm")
    .select("id, fecha_hora, sucursal_id, nicho_id, canal, nombre_contacto, consulta_mensaje, estado, convertido_pedido, monto, notas, created_at")
    .order("created_at", { ascending: false });
  if (role === "encargado") {
    contactosQuery = sucursalFija ? contactosQuery.eq("sucursal_id", sucursalFija) : contactosQuery.eq("sucursal_id", "00000000-0000-0000-0000-000000000000");
  }
  const contactosRes = await contactosQuery;
  const contactos = (contactosRes.data ?? []) as Contacto[];

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold font-display text-neutral-900">Nichos</h1>
        <p className="text-sm text-neutral-400 mt-0.5">Contactos por nicho de mercado — Costanera Posadas</p>
      </div>
      {sucursales.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
          No hay ninguna sucursal asociada a tu usuario.
        </div>
      ) : (
        <NichosBoard
          role={role}
          nichos={nichos}
          contactos={contactos}
          sucursales={sucursales}
          sucursalFija={sucursalFija}
        />
      )}
    </div>
  );
}
