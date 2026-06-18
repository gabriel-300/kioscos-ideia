"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";

function Icon({ children, className = "size-[18px] shrink-0" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  dashboard:   <Icon><path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></Icon>,
  sucursales:  <Icon><path d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" /></Icon>,
  movimientos: <Icon><path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></Icon>,
  stock:       <Icon><path d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" /></Icon>,
  categorias:  <Icon><path d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3zM6 6h.008v.008H6V6z" /></Icon>,
  productos:   <Icon><path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></Icon>,
  staff:       <Icon><path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></Icon>,
  signout:     <Icon><path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /></Icon>,
};

type NavItem   = { href: string; label: string; roles: string[]; icon: keyof typeof ICONS };
type Separator = { type: "separator"; label: string; roles: string[] };
type Item = NavItem | Separator;

const NAV: Item[] = [
  { href: "/admin/dashboard",   label: "Dashboard",           roles: ["admin", "encargado"], icon: "dashboard" },
  { type: "separator", label: "Kioscos", roles: ["admin", "encargado"] },
  { href: "/admin/sucursales",  label: "Sucursales",          roles: ["admin", "encargado"], icon: "sucursales" },
  { href: "/admin/movimientos", label: "Historial",           roles: ["admin"],              icon: "movimientos" },
  { href: "/admin/stock",       label: "Stock kioscos",       roles: ["admin"],              icon: "stock" },
  { type: "separator", label: "Catálogo", roles: ["admin"] },
  { href: "/admin/categorias",  label: "Categorías",          roles: ["admin"],              icon: "categorias" },
  { href: "/admin/productos",   label: "Productos (reventa)", roles: ["admin"],              icon: "productos" },
  { type: "separator", label: "Configuración", roles: ["admin"] },
  { href: "/admin/staff",       label: "Staff",               roles: ["admin"],              icon: "staff" },
];

const ROLE_LABEL: Record<string, string> = {
  admin:     "Administrador",
  encargado: "Encargado kiosco",
};

function NavContent({
  visibleItems, pathname, name, email, role, onSignOut, onNavClick,
}: {
  visibleItems: Item[];
  pathname:     string;
  name:         string | null;
  email:        string | null;
  role:         string | null;
  onSignOut:    () => void;
  onNavClick?:  () => void;
}) {
  const initials = ((name ?? email ?? "?")[0] ?? "?").toUpperCase();

  return (
    <>
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {visibleItems.map((item, i) => {
          if ("type" in item) {
            return (
              <div key={i} className="px-3 pt-5 pb-1.5 first:pt-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                  {item.label}
                </p>
              </div>
            );
          }

          const active = pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavClick}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 ${
                active
                  ? "bg-white/10 text-white"
                  : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
              }`}
            >
              <span className={`shrink-0 ${active ? "text-tierra-400" : "text-neutral-500"}`}>
                {ICONS[item.icon]}
              </span>
              <span className="text-sm font-medium">{item.label}</span>
              {active && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-tierra-400 shrink-0" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* User section */}
      <div className="p-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-3 p-2 rounded-lg">
          <div className="size-8 rounded-full bg-tierra-700 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-white">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-neutral-200 truncate leading-tight">{name ?? email ?? "—"}</p>
            {name && email && <p className="text-[11px] text-neutral-500 truncate leading-tight">{email}</p>}
            {role && <p className="text-[10px] text-neutral-500 font-medium uppercase tracking-wide mt-0.5">{ROLE_LABEL[role] ?? role}</p>}
          </div>
          <button
            onClick={onSignOut}
            title="Cerrar sesión"
            className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-200 hover:bg-white/10 transition-colors shrink-0"
          >
            {ICONS.signout}
          </button>
        </div>
      </div>
    </>
  );
}

export function AdminNav({ role, email, name, sucursalId }: {
  role:       string | null;
  email:      string | null;
  name:       string | null;
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

  const navWithSucursal: Item[] = sucursalId && role === "encargado"
    ? NAV.map((item) =>
        !("type" in item) && item.href === "/admin/sucursales"
          ? { ...item, href: `/admin/sucursales/${sucursalId}`, label: "Mi sucursal" }
          : item
      )
    : NAV;

  const visibleItems = navWithSucursal.filter((item) => {
    if (!item.roles.includes(role ?? "")) return false;
    if (!("type" in item) && item.href === "/admin/dashboard" && role === "encargado" && sucursalId) return false;
    return true;
  });

  const navProps = { visibleItems, pathname, name, email, role, onSignOut: handleSignOut };

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 bg-neutral-900 flex-col shrink-0 h-screen sticky top-0">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-white/[0.06]">
          <Link href="/admin/dashboard" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="size-8 rounded-xl bg-tierra-700 text-white flex items-center justify-center font-display font-bold text-sm shadow-lg shadow-tierra-900/30">
              KI
            </div>
            <div>
              <p className="text-sm font-bold text-white font-display leading-tight">Kioscos IDEIA</p>
              <p className="text-[11px] text-neutral-500 leading-tight">{role ? (ROLE_LABEL[role] ?? role) : "Panel admin"}</p>
            </div>
          </Link>
        </div>
        <NavContent {...navProps} />
      </aside>

      {/* Mobile header */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-neutral-900 border-b border-white/[0.06] flex items-center justify-between px-4 h-14">
        <Link href="/admin/dashboard" className="flex items-center gap-2.5">
          <div className="size-7 rounded-lg bg-tierra-700 text-white flex items-center justify-center font-display font-bold text-xs shadow-sm">KI</div>
          <span className="text-sm font-bold text-white font-display">Kioscos IDEIA</span>
        </Link>
        <button
          onClick={() => setOpen(true)}
          className="p-2 rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="Abrir menú"
        >
          <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
      </header>

      {open && (
        <div className="md:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
      )}

      <aside className={`md:hidden fixed top-0 left-0 bottom-0 z-50 w-72 bg-neutral-900 shadow-2xl flex flex-col transition-transform duration-300 ease-out ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="px-4 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <Link href="/admin/dashboard" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
            <div className="size-8 rounded-xl bg-tierra-700 text-white flex items-center justify-center font-display font-bold text-sm shadow-sm">KI</div>
            <div>
              <p className="text-sm font-bold text-white font-display leading-tight">Kioscos IDEIA</p>
              <p className="text-[11px] text-neutral-500 leading-tight">{role ? (ROLE_LABEL[role] ?? role) : "Panel admin"}</p>
            </div>
          </Link>
          <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-neutral-500 hover:bg-white/10 hover:text-white transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <NavContent {...navProps} onNavClick={() => setOpen(false)} />
      </aside>
    </>
  );
}
