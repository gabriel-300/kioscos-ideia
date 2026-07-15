"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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
  mermas:      <><path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></>,
  auditoria:   <><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></>,
  ayuda:       <><path d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" /></>,
  nichos:      <><path d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" /></>,
  signout:     <><path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /></>,
  menu:        <><path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></>,
  close:       <><path d="M6 18L18 6M6 6l12 12" /></>,
  chevron:     <><path d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></>,
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
type NavItem  = { href: string; label: string; roles: string[]; icon: string };
type NavGroup = { label: string; icon: string; children: NavItem[] };

// Ítems sueltos que van antes de los grupos
const NAV_HEAD: NavItem[] = [
  { href: "/admin/dashboard",  label: "Dashboard", roles: ["admin"],                          icon: "dashboard" },
  { href: "/admin/sucursales", label: "Kioscos",   roles: ["admin", "encargado", "vendedor"], icon: "sucursales" },
];

// Agrupados en dropdown — demasiados módulos sueltos para una barra horizontal
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Ventas", icon: "ventas",
    children: [
      { href: "/admin/ventas",  label: "Ventas",  roles: ["admin"], icon: "ventas" },
      { href: "/admin/cierres", label: "Cierres", roles: ["admin"], icon: "cierres" },
    ],
  },
  {
    label: "Stock", icon: "stock",
    children: [
      { href: "/admin/movimientos", label: "Historial",  roles: ["admin"],                          icon: "movimientos" },
      { href: "/admin/stock",       label: "Stock",      roles: ["admin", "encargado", "vendedor"], icon: "stock" },
      { href: "/admin/mermas",      label: "Mermas",     roles: ["admin"],                          icon: "mermas" },
      { href: "/admin/pronostico",  label: "Pronóstico", roles: ["admin", "encargado"],              icon: "pronostico" },
      { href: "/admin/auditoria",   label: "Auditoría",  roles: ["admin"],                          icon: "auditoria" },
    ],
  },
  {
    label: "Catálogo", icon: "productos",
    children: [
      { href: "/admin/productos",   label: "Productos",   roles: ["admin"], icon: "productos" },
      { href: "/admin/categorias",  label: "Categorías",  roles: ["admin"], icon: "categorias" },
      { href: "/admin/promociones", label: "Promociones", roles: ["admin"], icon: "promociones" },
      { href: "/admin/proveedores", label: "Proveedores", roles: ["admin"], icon: "proveedores" },
    ],
  },
];

// Ítems sueltos que van después de los grupos
const NAV_TAIL: NavItem[] = [
  { href: "/admin/gastos", label: "Finanzas", roles: ["admin"],               icon: "gastos" },
  { href: "/admin/nichos", label: "Nichos",   roles: ["admin", "encargado"],  icon: "nichos" },
  { href: "/admin/staff",  label: "Staff",    roles: ["admin"],               icon: "staff" },
  { href: "/admin/ayuda",  label: "Ayuda",    roles: ["admin", "encargado", "vendedor"], icon: "ayuda" },
];

const ROLE_LABEL: Record<string, string> = {
  admin:     "Administrador",
  encargado: "Encargado",
  vendedor:  "Vendedor",
};

/* ─── Component ──────────────────────────────── */
export function AdminNav({ role, email, name, sucursalId, auditoriaPendientes = 0 }: {
  role:        string | null;
  email:       string | null;
  name:        string | null;
  sucursalId?: string | null;
  auditoriaPendientes?: number;
}) {
  const pathname = usePathname();
  const router   = useRouter();
  const [open, setOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const groupBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => { setOpen(false); setOpenGroup(null); }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  function toggleGroup(label: string) {
    if (openGroup === label) { setOpenGroup(null); return; }
    const btn = groupBtnRefs.current[label];
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 2, left: rect.left });
    }
    setOpenGroup(label);
  }

  // Cerrar el dropdown abierto al hacer click afuera (sin cerrar si el click
  // fue dentro del panel portalled, para que los Links de adentro naveguen)
  useEffect(() => {
    if (!openGroup) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (navRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpenGroup(null);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openGroup]);

  // La posición del panel se calcula una sola vez al abrir; si la página
  // se scrollea/redimensiona mientras está abierto, mejor cerrarlo.
  useEffect(() => {
    if (!openGroup) return;
    function close() { setOpenGroup(null); }
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [openGroup]);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  function resolveItem(item: NavItem): NavItem {
    if ((role === "encargado" || role === "vendedor") && sucursalId && item.href === "/admin/sucursales") {
      return { ...item, href: `/admin/sucursales/${sucursalId}`, label: "Mi Kiosco" };
    }
    return item;
  }

  const visibleHead = NAV_HEAD
    .filter((item) => item.roles.includes(role ?? ""))
    .filter((item) => !((role === "encargado" || role === "vendedor") && item.href === "/admin/dashboard"))
    .map(resolveItem);

  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, children: g.children.filter((c) => c.roles.includes(role ?? "")) }))
    .filter((g) => g.children.length > 0);

  const visibleTail = NAV_TAIL.filter((item) => item.roles.includes(role ?? ""));

  const initials = ((name ?? email ?? "?")[0] ?? "?").toUpperCase();

  function isActive(href: string) {
    if (href === "/admin/dashboard") return pathname === "/admin/dashboard" || pathname === "/admin";
    return pathname.startsWith(href);
  }
  function isGroupActive(group: NavGroup) {
    return group.children.some((c) => isActive(c.href));
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
        <nav ref={navRef} className="flex items-stretch flex-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {visibleHead.map((item) => {
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

          {visibleGroups.map((group) => {
            const active   = isGroupActive(group);
            const isOpen   = openGroup === group.label;
            return (
              <div key={group.label} className="relative shrink-0">
                <button
                  ref={(el) => { groupBtnRefs.current[group.label] = el; }}
                  type="button"
                  onClick={() => toggleGroup(group.label)}
                  className="flex items-center gap-1.5 shrink-0 transition-all whitespace-nowrap nav-tab"
                  style={{
                    padding: "0 14px",
                    height: 60,
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    color: active ? "#ffffff" : "rgba(255,255,255,0.72)",
                    background: active || isOpen ? "rgba(255,255,255,0.10)" : "transparent",
                    borderBottom: active ? "3px solid white" : "3px solid transparent",
                    border: "none", cursor: "pointer",
                  }}
                >
                  <span style={{ display: "flex", position: "relative" }}>
                    <span style={{ display: "flex", color: active ? "#ffffff" : "rgba(255,255,255,0.60)" }}>
                      <NavIcon name={group.icon} size={15} />
                    </span>
                    {group.label === "Stock" && auditoriaPendientes > 0 && (
                      <span style={{
                        position: "absolute", top: -3, right: -3, width: 7, height: 7,
                        borderRadius: "50%", background: "#DC2626", border: "1.5px solid " + NAVY,
                      }} />
                    )}
                  </span>
                  {group.label}
                  <span
                    style={{
                      display: "flex", color: "rgba(255,255,255,0.5)",
                      transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .15s",
                    }}
                  >
                    <NavIcon name="chevron" size={12} />
                  </span>
                </button>

                {isOpen && dropdownPos && createPortal(
                  <div
                    ref={dropdownRef}
                    className="fixed z-50 rounded-lg overflow-hidden shadow-xl"
                    style={{ top: dropdownPos.top, left: dropdownPos.left, minWidth: 190, background: "white", border: "1px solid #E2E8F0" }}
                  >
                    {group.children.map((child) => {
                      const childActive = isActive(child.href);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={() => setOpenGroup(null)}
                          className="flex items-center gap-2.5 transition-colors"
                          style={{
                            padding: "9px 14px",
                            fontSize: 13,
                            fontWeight: childActive ? 600 : 400,
                            color: childActive ? "#15375E" : "#475569",
                            background: childActive ? "#EEF2F7" : "white",
                          }}
                        >
                          <span style={{ display: "flex", color: childActive ? "#15375E" : "#94A3B8" }}>
                            <NavIcon name={child.icon} size={15} />
                          </span>
                          <span style={{ flex: 1 }}>{child.label}</span>
                          {child.href === "/admin/auditoria" && auditoriaPendientes > 0 && (
                            <span style={{
                              minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9,
                              background: "#FEE2E2", color: "#DC2626", fontSize: 11, fontWeight: 700,
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              {auditoriaPendientes}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>,
                  document.body
                )}
              </div>
            );
          })}

          {visibleTail.map((item) => {
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
          {visibleHead.map((item) => {
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

          {visibleGroups.map((group) => (
            <div key={group.label} style={{ marginTop: 10, marginBottom: 4 }}>
              <p style={{
                padding: "4px 12px", fontSize: 11, fontWeight: 700, letterSpacing: ".04em",
                textTransform: "uppercase", color: "rgba(255,255,255,0.4)",
              }}>
                {group.label}
              </p>
              {group.children.map((child) => {
                const active = isActive(child.href);
                return (
                  <Link
                    key={child.href}
                    href={child.href}
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
                      <NavIcon name={child.icon} size={18} />
                    </span>
                    <span style={{ flex: 1 }}>{child.label}</span>
                    {child.href === "/admin/auditoria" && auditoriaPendientes > 0 && (
                      <span style={{
                        minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9,
                        background: "#DC2626", color: "white", fontSize: 11, fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}>
                        {auditoriaPendientes}
                      </span>
                    )}
                    {active && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(255,255,255,0.6)", flexShrink: 0 }} />}
                  </Link>
                );
              })}
            </div>
          ))}

          <div style={{ marginTop: 10 }}>
            {visibleTail.map((item) => {
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
          </div>
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
