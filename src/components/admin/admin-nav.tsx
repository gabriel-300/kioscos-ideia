"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ─── Tokens ─────────────────────────────────── */
const NAVY   = "#15375E";
const NAVY_D = "#0F2742";

/* ─── Icon system ────────────────────────────── */
const PATHS: Record<string, React.ReactNode> = {
  dashboard:   <><path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></>,
  sucursales:  <><path d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" /></>,
  movimientos: <><path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></>,
  cierres:     <><path d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" /></>,
  ventas:      <><path d="M3 3v18h18M7 15l4-4 3 3 5-6" /></>,
  gastos:      <><path d="M12 6v12m-4-4.5c0 1.38 1.79 2.5 4 2.5s4-1.12 4-2.5-1.79-2.5-4-2.5-4-1.12-4-2.5S9.79 6 12 6s4 1.12 4 2.5" /></>,
  stock:       <><path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></>,
  categorias:  <><path d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3zM6 6h.008v.008H6V6z" /></>,
  productos:   <><path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></>,
  promociones: <><path d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3zM6 6h.008v.008H6V6z" /></>,
  staff:       <><path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></>,
  proveedores: <><path d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" /></>,
  pronostico:  <><path d="M2.25 18L9 11.25l4.306 4.306a11.95 11.95 0 015.814-5.518L21.75 6M21.75 6H15.75M21.75 6v6" /></>,
  signout:     <><path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /></>,
  menu:        <><path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></>,
  close:       <><path d="M6 18L18 6M6 6l12 12" /></>,
};

function NavIcon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg
      width={size} height={size} fill="none" viewBox="0 0 24 24"
      stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      {PATHS[name]}
    </svg>
  );
}

/* ─── Nav items ──────────────────────────────── */
type NavItem = { href: string; label: string; roles: string[]; icon: string };

const NAV: NavItem[] = [
  { href: "/admin/dashboard",   label: "Dashboard",  roles: ["admin"],                          icon: "dashboard" },
  { href: "/admin/sucursales",  label: "Kioscos",    roles: ["admin", "encargado", "vendedor"], icon: "sucursales" },
  { href: "/admin/movimientos", label: "Historial",  roles: ["admin"],                          icon: "movimientos" },
  { href: "/admin/stock",       label: "Stock",      roles: ["admin", "encargado", "vendedor"], icon: "stock" },
  { href: "/admin/cierres",     label: "Cierres",    roles: ["admin"],                          icon: "cierres" },
  { href: "/admin/ventas",      label: "Ventas",     roles: ["admin"],                          icon: "ventas" },
  { href: "/admin/pronostico",  label: "Pronóstico", roles: ["admin", "encargado"],              icon: "pronostico" },
  { href: "/admin/gastos",      label: "Finanzas",   roles: ["admin"],                          icon: "gastos" },
  { href: "/admin/categorias",  label: "Categorías", roles: ["admin"],                          icon: "categorias" },
  { href: "/admin/productos",   label: "Productos",  roles: ["admin"],                          icon: "productos" },
  { href: "/admin/promociones", label: "Promociones", roles: ["admin"],                         icon: "promociones" },
  { href: "/admin/proveedores",  label: "Proveedores", roles: ["admin"],                         icon: "proveedores" },
  { href: "/admin/staff",       label: "Staff",      roles: ["admin"],                          icon: "staff" },
];

const ROLE_LABEL: Record<string, string> = {
  admin:     "Administrador",
  encargado: "Encargado",
  vendedor:  "Vendedor",
};

/* ─── Component ──────────────────────────────── */
export function AdminNav({ role, email, name, sucursalId }: {
  role:        string | null;
  email:       string | null;
  name:        string | null;
  sucursalId?: string | null;
}) {
  const pathname = usePathname();
  const router   = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const visibleItems: NavItem[] = NAV
    .filter((item) => item.roles.includes(role ?? ""))
    .filter((item) => {
      if ((role === "encargado" || role === "vendedor") && item.href === "/admin/dashboard") return false;
      return true;
    })
    .map((item) => {
      if ((role === "encargado" || role === "vendedor") && sucursalId && item.href === "/admin/sucursales") {
        return { ...item, href: `/admin/sucursales/${sucursalId}`, label: "Mi Kiosco" };
      }
      return item;
    });

  const initials = ((name ?? email ?? "?")[0] ?? "?").toUpperCase();

  function isActive(href: string) {
    if (href === "/admin/dashboard") return pathname === "/admin/dashboard" || pathname === "/admin";
    return pathname.startsWith(href);
  }

  const LogoBox = (size: number, radius: number, fontSize: number) => (
    <div style={{
      width: size, height: size, borderRadius: radius, background: NAVY_D,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 800, fontSize, color: "white", letterSpacing: "-.5px", flexShrink: 0,
    }}>KI</div>
  );

  return (
    <>
      {/* ══════════ DESKTOP TOPBAR ══════════ */}
      <header
        className="hidden md:flex items-stretch shrink-0"
        style={{ background: NAVY, height: 60, borderBottom: "1px solid rgba(0,0,0,0.18)" }}
      >
        {/* Brand */}
        <Link
          href="/admin/dashboard"
          className="flex items-center gap-2.5 shrink-0"
          style={{ padding: "0 20px", borderRight: "1px solid rgba(255,255,255,0.1)" }}
        >
          {LogoBox(32, 9, 13)}
          <span style={{ color: "white", fontWeight: 700, fontSize: 14, letterSpacing: "-.2px", whiteSpace: "nowrap" }}>
            Kioscos IDEIA
          </span>
        </Link>

        {/* Nav tabs */}
        <nav className="flex items-stretch flex-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {visibleItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-1.5 shrink-0 transition-all whitespace-nowrap nav-tab"
                style={{
                  padding: "0 14px",
                  height: "100%",
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? "#ffffff" : "rgba(255,255,255,0.72)",
                  background: active ? "rgba(255,255,255,0.10)" : "transparent",
                  borderBottom: active ? "3px solid white" : "3px solid transparent",
                }}
              >
                <span style={{ display: "flex", color: active ? "#ffffff" : "rgba(255,255,255,0.60)" }}>
                  <NavIcon name={item.icon} size={15} />
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div
          className="flex items-center gap-2 shrink-0"
          style={{ padding: "0 14px", borderLeft: "1px solid rgba(255,255,255,0.1)" }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: "50%",
            background: "rgba(255,255,255,0.16)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, color: "white", flexShrink: 0,
          }}>
            {initials}
          </div>
          <div className="hidden lg:block" style={{ lineHeight: 1.3 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "white", whiteSpace: "nowrap", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}>
              {name ?? email ?? "—"}
            </p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              {ROLE_LABEL[role ?? ""] ?? role ?? ""}
            </p>
          </div>
          <button
            onClick={handleSignOut}
            title="Cerrar sesión"
            className="transition-colors text-white/50 hover:text-white"
            style={{
              width: 30, height: 30, borderRadius: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: "none", cursor: "pointer",
            }}
          >
            <NavIcon name="signout" size={15} />
          </button>
        </div>
      </header>

      {/* ══════════ MOBILE HEADER (fixed) ══════════ */}
      <header
        className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between"
        style={{ background: NAVY, height: 56, padding: "0 16px", borderBottom: "1px solid rgba(0,0,0,0.18)" }}
      >
        <Link href="/admin/dashboard" className="flex items-center gap-2">
          {LogoBox(28, 7, 12)}
          <span style={{ color: "white", fontWeight: 700, fontSize: 14 }}>Kioscos IDEIA</span>
        </Link>
        <button
          onClick={() => setOpen(true)}
          style={{ color: "rgba(255,255,255,0.8)", background: "none", border: "none", cursor: "pointer", padding: 6 }}
        >
          <NavIcon name="menu" size={20} />
        </button>
      </header>

      {/* ══════════ MOBILE OVERLAY ══════════ */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ══════════ MOBILE DRAWER ══════════ */}
      <aside
        className={`md:hidden fixed top-0 left-0 bottom-0 z-50 flex flex-col transition-transform duration-300 ease-out ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ width: 272, background: NAVY }}
      >
        <div
          className="flex items-center justify-between shrink-0"
          style={{ padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}
        >
          <Link href="/admin/dashboard" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
            {LogoBox(32, 9, 13)}
            <div>
              <p style={{ color: "white", fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>Kioscos IDEIA</p>
              <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, lineHeight: 1.2 }}>
                {ROLE_LABEL[role ?? ""] ?? role ?? ""}
              </p>
            </div>
          </Link>
          <button
            onClick={() => setOpen(false)}
            style={{ color: "rgba(255,255,255,0.6)", background: "none", border: "none", cursor: "pointer", padding: 4 }}
          >
            <NavIcon name="close" size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto" style={{ padding: "10px 8px" }}>
          {visibleItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 12px", borderRadius: 8, marginBottom: 2,
                  background: active ? "rgba(255,255,255,0.12)" : "transparent",
                  color: active ? "white" : "rgba(255,255,255,0.7)",
                  fontSize: 14, fontWeight: active ? 600 : 400,
                  transition: "all .12s",
                }}
              >
                <span style={{ color: active ? "white" : "rgba(255,255,255,0.45)", display: "flex" }}>
                  <NavIcon name={item.icon} size={18} />
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {active && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.6)", flexShrink: 0 }} />}
              </Link>
            );
          })}
        </nav>

        <div style={{ padding: "12px 8px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px" }}>
            <div style={{
              width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 700, color: "white", flexShrink: 0,
            }}>
              {initials}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }}>
                {name ?? email ?? "—"}
              </p>
              {name && email && (
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }}>
                  {email}
                </p>
              )}
            </div>
            <button
              onClick={handleSignOut}
              title="Cerrar sesión"
              style={{
                width: 30, height: 30, borderRadius: 6,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "rgba(255,255,255,0.5)", background: "none", border: "none", cursor: "pointer",
              }}
            >
              <NavIcon name="signout" size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
