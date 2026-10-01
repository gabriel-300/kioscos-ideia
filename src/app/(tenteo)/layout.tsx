import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { TenteoNav } from "@/components/tenteo/tenteo-nav";
import { NumberInputWheelGuard } from "@/components/admin/number-input-wheel-guard";
import { destinoPorDefecto, esPersonal, puedeEntrar } from "@/lib/auth/acceso";

// Zona de Tenteo (pedidos online del personal). Igual que (admin), este layout
// NO es la barrera de seguridad -- eso es el middleware (por ruta) y cada
// página/acción (requireStaffTenteo, requireRepartidor). Acá solo se evita
// mostrar la zona a quien no corresponde.
export default async function TenteoLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();

  if (!user || !esPersonal(user)) redirect("/login");
  if (!puedeEntrar(user, "tenteo")) redirect(destinoPorDefecto(user) ?? "/login");

  return (
    <div className="h-screen flex flex-col bg-neutral-50">
      <NumberInputWheelGuard />
      <TenteoNav
        role={(user.app_metadata?.role as string) ?? null}
        email={user.email ?? null}
        name={(user.user_metadata?.full_name as string | null) ?? null}
        puedeKiosco={puedeEntrar(user, "kiosco")}
      />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
