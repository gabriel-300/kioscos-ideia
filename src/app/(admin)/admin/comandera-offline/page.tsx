import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { cargarCatalogoComandera } from "@/lib/comandera-offline/catalogo";
import { EventoForm, type OpcionSucursal } from "./_components/evento-form";

export const revalidate = 0;
export const metadata: Metadata = { title: "Comandera offline — Kioscos IDEIA" };

// Página de descarga de la comandera offline (ver src/lib/comandera-offline/): se elige el nombre del evento, de
// qué sucursal salen los precios y qué productos lleva. Solo se ofrecen las sucursales a las que el usuario tiene acceso.
export default async function ComanderaOfflinePage() {
  const user = await getUser();
  if (!user) redirect("/login");
  const role = (user.app_metadata?.role as string | undefined) ?? "";
  if (!["admin", "encargado", "vendedor", "concesionario"].includes(role)) redirect("/admin/dashboard");

  const admin = createAdminClient();
  let sucursales: { id: string; nombre: string }[] = [];
  if (role === "admin") {
    const { data } = await admin.from("sucursales").select("id, nombre").eq("is_active", true).order("nombre");
    sucursales = (data ?? []) as typeof sucursales;
  } else if (role === "vendedor") {
    const { data } = await (admin as any)
      .from("profile_sucursales")
      .select("sucursal:sucursales(id, nombre, is_active)")
      .eq("profile_id", user.id);
    sucursales = ((data ?? []) as { sucursal: { id: string; nombre: string; is_active: boolean } | null }[])
      .map((r) => r.sucursal)
      .filter((s): s is { id: string; nombre: string; is_active: boolean } => !!s && s.is_active);
  } else {
    const { data } = await admin.from("sucursales").select("id, nombre").eq("encargado_user_id", user.id).eq("is_active", true);
    sucursales = (data ?? []) as typeof sucursales;
  }

  const catalogos = await Promise.all(sucursales.map((s) => cargarCatalogoComandera(admin, s.id)));

  const opciones: OpcionSucursal[] = catalogos
    .filter((c): c is NonNullable<typeof c> => !!c && c.categorias.length > 0)
    .map((c) => ({ sucursalId: c.sucursalId, nombre: c.sucursalNombre, categorias: c.categorias, omitidosPorKg: c.omitidosPorKg }));

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold font-display text-neutral-900">Comandera offline</h1>
        <p className="text-sm text-neutral-600">
          Para vender en un evento sin internet: un archivo que se abre solo, arma el pedido, cobra en efectivo e imprime
          un ticket de retiro. Elegís qué productos lleva y de qué sucursal salen los precios; el evento no queda ligado a
          esa sucursal ni toca su caja o su stock.
        </p>
      </header>

      <EventoForm opciones={opciones} />

      <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5 text-sm leading-relaxed text-neutral-700">
        <h2 className="text-base font-semibold text-neutral-900">Cómo usarla el día del evento</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <b>Descargala con internet</b>, el día anterior o esa misma mañana: los precios quedan fijos en el archivo. Si
            cambia un precio o un producto, hay que descargarla de nuevo.
          </li>
          <li>Copiá el archivo a la notebook del evento (o dejalo en Descargas) y abrilo con Chrome o Edge. No necesita internet.</li>
          <li>Conectá la térmica por USB, dejala como impresora predeterminada y configurá el papel en 80 mm.</li>
          <li>
            Para que imprima directo, sin el cuadro de impresión, abrí Chrome con la opción <code>--kiosk-printing</code>:
            clic derecho en el acceso directo de Chrome → Propiedades → en <i>Destino</i> agregá <code>--kiosk-printing</code>
            al final, después de las comillas.
          </li>
          <li>Tocá los productos, revisá el total, <b>Cobrar e imprimir</b>. El cliente retira con el ticket.</li>
          <li>
            Al terminar, en <b>Ventas / Resumen</b> exportá el CSV: es el único registro de lo vendido, porque la comandera no
            se conecta al sistema.
          </li>
        </ol>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800">
          Las ventas se guardan en el navegador de esa compu. Usá siempre el mismo navegador, no borres los datos de
          navegación y, antes del evento, hacé una venta de prueba y después <b>Borrar todo</b> para que el primer ticket
          real sea el N.º 1. Si volvés a descargar la comandera con el mismo nombre de evento (por un precio nuevo), sigue la numeración; con otro nombre arranca en 1. No descuenta stock ni registra caja en el sistema.
        </p>
      </section>
    </div>
  );
}
