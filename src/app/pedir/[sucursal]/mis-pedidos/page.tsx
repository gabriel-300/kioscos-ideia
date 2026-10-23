import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import { clienteDeLaSesion } from "@/lib/pedidos/beneficio-servidor";
import { pedidosDelCliente } from "@/lib/pedidos/mis-pedidos-servidor";
import { LOGO_MARCA } from "../_lib/tema";
import { ListaMisPedidos } from "./_components/lista-mis-pedidos";

// "Mis pedidos" del cliente. Con cuenta de Google muestra todos sus pedidos; sin cuenta, los que este
// navegador recuerda (ver lista-mis-pedidos.tsx). No se indexa.

export const revalidate = 0;
export const metadata: Metadata = { title: "Mis pedidos", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MisPedidosPage({ params }: { params: Promise<{ sucursal: string }> }) {
  const { sucursal: sucursalId } = await params;
  if (!UUID.test(sucursalId)) notFound();

  const admin = createAdminClient();
  const user = await getUser();
  const cliente = await clienteDeLaSesion(admin, user?.id);
  const pedidos = cliente ? await pedidosDelCliente(admin, cliente.id) : [];
  const primerNombre = cliente?.nombre?.trim().split(/\s+/)[0];

  return (
    <div className="min-h-screen bg-pd-paper">
      <header className="border-b border-pd-line bg-white">
        <div className="mx-auto flex max-w-[700px] items-center gap-3 px-4 py-3">
          <Link href={`/pedir/${sucursalId}`} aria-label="Volver al menú" className="flex min-w-0 items-center gap-3" style={{ color: "var(--color-pd-ink)" }}>
            <span aria-hidden className="text-[22px] leading-none">←</span>
            {LOGO_MARCA && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={LOGO_MARCA.srcOscuro} alt={LOGO_MARCA.alt} width={LOGO_MARCA.ancho} height={LOGO_MARCA.alto} className="h-[30px] w-auto" />
            )}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[700px] px-4 pb-12 pt-5 md:pt-8">
        <h1 className="text-[28px] leading-tight md:text-[32px]">Mis pedidos</h1>
        <p className="mb-5 mt-1.5 text-[14px] text-pd-ink-600">
          {cliente
            ? `${primerNombre ? `${primerNombre}, estos` : "Estos"} son tus pedidos.`
            : "Acá ves los pedidos que hiciste desde este celular. Ingresá con Google para tenerlos en cualquier dispositivo."}
        </p>
        <ListaMisPedidos sucursalId={sucursalId} iniciales={pedidos} />
      </main>
    </div>
  );
}
