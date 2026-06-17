"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";

function Icon({ children, className = "size-4 shrink-0" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  dashboard:   <Icon><path d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></Icon>,
  sucursales:  <Icon><path d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" /></Icon>,
  productos:   <Icon><path d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></Icon>,
  movimientos: <Icon><path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></Icon>,
  envio:       <Icon><path d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" /></Icon>,
  staff:       <Icon><path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></Icon>,
};

type NavItem   = { href: string; label: string; roles: string[]; icon: keyof typeof ICONS; sub?: boolean };
type Separator = { type: "separator"; label: string; roles: string[] };
type Item = NavItem | Separator;

const NAV: Item[] = [
  { href: "/admin/dashboard",    label: "Dashboard",          roles: ["admin", "encargado"], icon: "dashboard" },

  { type: "separator", label: "Kioscos", roles: ["admin", "encargado"] },

  { href: "/admin/sucursales",   label: "Sucursales",         roles: ["admin", "encargado"], icon: "sucursales" },
  { href: "/admin/movimientos",  label: "Historial",          roles: ["admin"],              icon: "movimientos" },

  { type: "separator", label: "Catálogo", roles: ["admin"] },

  { href: "/admin/productos",    label: "Productos (reventa)", roles: ["admin"],             icon: "productos" },

  { type: "separator", label: "Configuración", roles: ["admin"] },

  { href: "/admin/staff",        label: "Staff",              roles: ["admin"],              icon: "staff" },
];

const ROLE_LABEL: Record<string, string> = {
  admin:      "Administrador",
  encargado:  "Encargado kiosco",
};

function NavContent({
  visibleItems,
  pathname,
  name,
  email,
  onSignOut,
  onNavClick,
}: {
  visibleItems: Item[];
  pathname:     string;
  name:         string | null;
  email:        string | null;
  onSignOut:    () => void;
  onNavClick?:  () => void;
}) {
  return (
    <>
      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {visibleItems.map((item, i) => {
          if ("type" in item) {
            return (
              <div key={i} className="pt-3 pb-1">
                <p className="px-3 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
                  {item.label}
                </p>
              </div>
            );
          }

          const active = item.sub
            ? pathname === item.href
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavClick}
              className={`flex items-center gap-2.5 rounded-lg transition-colors ${
                item.sub ? "pl-7 pr-3 py-1.5" : "px-3 py-2.5"
              } ${
                active
                  ? "bg-tierra-50 text-tierra-700 font-medium"
                  : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
              }`}
            >
              <span className={active ? "text-tierra-700" : "text-neutral-400"}>
                {ICONS[item.icon]}
              </span>
              <span className={item.sub ? "text-xs" : "text-sm"}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-neutral-200 space-y-2">
        <div>
          <p className="text-xs font-medium text-neutral-700 truncate">{name ?? email ?? "—"}</p>
          {name && <p className="text-xs text-neutral-400 truncate">{email}</p>}
        </div>
        <button
          onClick={onSignOut}
          className="w-full text-left text-xs text-neutral-400 hover:text-neutral-700 transition-colors py-1"
        >
          Cerrar sesión
        </button>
      </div>
    </>
  );
}

export function AdminNav({ role, email, name }: { role: string | null; email: string | null; name: string | null }) {
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

  const visibleItems = NAV.filter((item) => item.roles.includes(role ?? ""));

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 bg-white border-r border-neutral-200 flex-col shrink-0 h-screen sticky top-0">
        <div className="p-5 border-b border-neutral-200">
          <Link href="/admin/dashboard" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="size-8 rounded-lg bg-tierra-700 text-white flex items-center justify-center font-display font-bold text-sm">KI</div>
            <div>
              <p className="text-sm font-semibold text-neutral-900 font-display">Kioscos IDEIA</p>
              <p className="text-xs text-neutral-400">{role ? (ROLE_LABEL[role] ?? role) : "Panel admin"}</p>
            </div>
          </Link>
        </div>
        <NavContent visibleItems={visibleItems} pathname={pathname} name={name} email={email} onSignOut={handleSignOut} />
      </aside>

      {/* Mobile header */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-neutral-200 flex items-center justify-between px-4 h-14">
        <Link href="/admin/dashboard" className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-tierra-700 text-white flex items-center justify-center font-display font-bold text-xs">KI</div>
          <span className="text-sm font-semibold text-neutral-900 font-display">Kioscos IDEIA</span>
        </Link>
        <button
          onClick={() => setOpen(true)}
          className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 transition-colors"
          aria-label="Abrir menú"
        >
          <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
      </header>

      {open && <div className="md:hidden fixed inset-0 z-50 bg-black/40" onClick={() => setOpen(false)} />}

      <aside className={`md:hidden fixed top-0 left-0 bottom-0 z-50 w-72 bg-white shadow-xl flex flex-col transition-transform duration-300 ease-out ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
          <Link href="/admin/dashboard" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
            <div className="size-8 rounded-lg bg-tierra-700 text-white flex items-center justify-center font-display font-bold text-sm">KI</div>
            <div>
              <p className="text-sm font-semibold text-neutral-900 font-display">Kioscos IDEIA</p>
              <p className="text-xs text-neutral-400">{role ? (ROLE_LABEL[role] ?? role) : "Panel admin"}</p>
            </div>
          </Link>
          <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-neutral-400 hover:bg-neutral-100">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <NavContent visibleItems={visibleItems} pathname={pathname} name={name} email={email} onSignOut={handleSignOut} onNavClick={() => setOpen(false)} />
      </aside>
    </>
  );
}
