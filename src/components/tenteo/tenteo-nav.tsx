"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { usePedidosPorAtender } from "./use-pedidos-por-atender";
import { RUTA_TENTEO_PEDIDOS, RUTA_TENTEO_REPARTOS } from "@/lib/auth/acceso";

// Menú de la zona de Tenteo (pedidos online). Es corto a propósito: tres
// pantallas. El del kiosco está en components/admin/admin-nav.tsx; el personal
// de un sistema no ve el otro (salvo el enlace de cambio, si tiene los dos).

const NAVY_BAR = "linear-gradient(180deg,#12312A 0%,#17493D 100%)";
const LIME = "#C9DE6A";

type Item = { href: string; label: string; roles: string[] };

const ITEMS: Item[] = [
  { href: RUTA_TENTEO_PEDIDOS,                  label: "Pedidos",       roles: ["admin", "encargado", "vendedor", "concesionario"] },
  { href: `${RUTA_TENTEO_PEDIDOS}/configuracion`, label: "Configuración", roles: ["admin"] },
  { href: RUTA_TENTEO_REPARTOS,                 label: "Mis entregas",  roles: ["admin", "repartidor"] },
];

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador", encargado: "Encargado", vendedor: "Vendedor",
  concesionario: "Encargado Concesionario", repartidor: "Repartidor",
};

export function TenteoNav({ role, email, name, puedeKiosco = false }: {
  role: string | null;
  email: string | null;
  name: string | null;
  puedeKiosco?: boolean; // tiene los dos sistemas: se muestra el enlace para cambiar al kiosco
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Aviso de pedido nuevo: solo el personal que atiende pedidos (no el repartidor).
  const atiendePedidos = ["admin", "encargado", "vendedor", "concesionario"].includes(role ?? "");
  const pedidosPorAtender = usePedidosPorAtender(atiendePedidos);

  const visibles = ITEMS.filter((i) => i.roles.includes(role ?? ""));
  const activo = (href: string) =>
    href === RUTA_TENTEO_PEDIDOS
      ? pathname === href
      : pathname === href || pathname.startsWith(href + "/");
  const inicial = ((name ?? email ?? "?")[0] ?? "?").toUpperCase();

  async function cerrarSesion() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <header className="shrink-0" style={{ background: NAVY_BAR, borderBottom: "1px solid rgba(0,0,0,0.18)" }}>
      <div className="flex items-center justify-between gap-3 px-4" style={{ minHeight: 56 }}>
        <Link href={visibles[0]?.href ?? RUTA_TENTEO_PEDIDOS} className="flex items-center gap-2.5 shrink-0">
          <span
            style={{
              width: 30, height: 30, borderRadius: 8, background: LIME, color: "#12312A",
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13,
            }}
          >
            T
          </span>
          <span style={{ color: "white", fontWeight: 700, fontSize: 14 }}>Tenteo</span>
        </Link>

        <nav className="hidden md:flex items-stretch flex-1 self-stretch">
          {visibles.map((item) => <NavLink key={item.href} item={item} activo={activo(item.href)} badge={item.href === RUTA_TENTEO_PEDIDOS ? pedidosPorAtender : 0} />)}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {puedeKiosco && (
            <Link href="/auth/sistema?ir=kiosco" className="text-xs font-medium whitespace-nowrap" style={{ color: "rgba(255,255,255,0.8)" }}>
              Ir al kiosco
            </Link>
          )}
          <div className="hidden lg:block" style={{ lineHeight: 1.3 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "white", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {name ?? email ?? "—"}
            </p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{ROLE_LABEL[role ?? ""] ?? role ?? ""}</p>
          </div>
          <span
            className="lg:hidden"
            style={{
              width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.16)", color: "white",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
            }}
          >
            {inicial}
          </span>
          <button
            onClick={cerrarSesion}
            title="Cerrar sesión"
            className="text-xs"
            style={{ color: "rgba(255,255,255,0.7)", background: "none", border: "none", cursor: "pointer" }}
          >
            Salir
          </button>
        </div>
      </div>

      {/* Celular: las pantallas van en una segunda fila */}
      <nav className="md:hidden flex items-stretch overflow-x-auto" style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        {visibles.map((item) => <NavLink key={item.href} item={item} activo={activo(item.href)} badge={item.href === RUTA_TENTEO_PEDIDOS ? pedidosPorAtender : 0} />)}
      </nav>
    </header>
  );
}

function NavLink({ item, activo, badge }: { item: Item; activo: boolean; badge: number }) {
  return (
    <Link
      href={item.href}
      className="flex items-center gap-1.5 shrink-0 whitespace-nowrap"
      style={{
        padding: "10px 14px",
        fontSize: 13,
        fontWeight: activo ? 600 : 400,
        color: activo ? "#ffffff" : "rgba(255,255,255,0.72)",
        background: activo ? "rgba(255,255,255,0.10)" : "transparent",
        borderBottom: activo ? "3px solid white" : "3px solid transparent",
      }}
    >
      {item.label}
      {badge > 0 && (
        <span
          style={{
            minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9,
            background: "#FDF1E3", color: "#B54708", fontSize: 11, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
