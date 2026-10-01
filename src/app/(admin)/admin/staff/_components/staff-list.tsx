"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { Button, Badge, Input } from "@/components/ui";
import { crearStaff, eliminarStaff, actualizarStaff, asignarSucursal, asignarSucursalesVendedor, generarLinkResetPassword, suspenderStaff } from "../actions";
import { friendlyError } from "@/lib/utils";
import { ROLES_PERSONAL, SISTEMAS, sistemasFijos, type Rol, type Sistema } from "@/lib/auth/acceso";

type StaffUser = {
  id: string;
  email: string | undefined;
  nombre: string | undefined;
  role: string | undefined;
  sucursalIdProfile: string | null;
  sucursalIdsVendedor: string[];
  creditoLimite: number | null;
  esSocio: boolean;
  sistemas: Sistema[];          // los que tiene hoy (resueltos con las reglas de lib/auth/acceso)
  sistemasPorDefecto: boolean;  // no tiene el dato guardado: se aplica el defecto (kiosco)
  isSuspended: boolean;
  lastSignIn: string | null;
};

type Sucursal = { id: string; nombre: string; encargado_user_id: string | null; pedidos_online_habilitado?: boolean | null };

const SISTEMA_LABEL: Record<Sistema, string> = { kiosco: "Kiosco", tenteo: "Tenteo" };
const SISTEMA_BADGE: Record<Sistema, string> = {
  kiosco: "bg-neutral-50 text-neutral-700 border-neutral-200",
  tenteo: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

// A qué sistemas entra la persona: el sistema del kiosco (venta, caja, stock...) y/o
// Tenteo (pedidos online y entregas). Admin y repartidor son fijos. El aviso de
// sucursal sin pedidos online no bloquea: solo avisa que esa persona no va a ver
// pedidos ahí hasta que se habilite.
function SistemasPicker({ role, valor, onChange, sucursalesElegidas }: {
  role: string;
  valor: Sistema[];
  onChange: (v: Sistema[]) => void;
  sucursalesElegidas: Sucursal[];
}) {
  const fijos = sistemasFijos(role as Rol);
  const efectivo = fijos ?? valor;
  const sinPedidos = sucursalesElegidas.filter((s) => s.pedidos_online_habilitado === false);

  function alternar(s: Sistema) {
    onChange(valor.includes(s) ? valor.filter((x) => x !== s) : SISTEMAS.filter((x) => x === s || valor.includes(x)));
  }

  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Sistemas</label>
      <div className="flex gap-4">
        {SISTEMAS.map((s) => (
          <label key={s} className={`flex items-center gap-2 select-none ${fijos ? "opacity-60" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              className="rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700"
              checked={efectivo.includes(s)}
              disabled={!!fijos}
              onChange={() => alternar(s)}
            />
            <span className="text-sm text-neutral-700">{SISTEMA_LABEL[s]}</span>
          </label>
        ))}
      </div>
      <p className="text-[11px] text-neutral-400 mt-1.5">
        {role === "admin"
          ? "El administrador entra siempre a los dos."
          : role === "repartidor"
          ? "El repartidor solo usa Tenteo (sus entregas)."
          : "Kiosco: venta, caja, stock e informes. Tenteo: pedidos online y entregas. Podés darle los dos."}
      </p>
      {!fijos && valor.length === 0 && (
        <p className="text-[11px] text-red-600 mt-1">Elegí al menos uno.</p>
      )}
      {!fijos && valor.includes("tenteo") && sinPedidos.length > 0 && (
        <p className="text-[11px] text-amber-600 mt-1">
          Pedidos online está apagado en {sinPedidos.map((s) => s.nombre).join(", ")}: no va a ver pedidos ahí hasta que se habilite en Configuración de Tenteo.
        </p>
      )}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = {
  admin:         "Administrador",
  encargado:     "Encargado kiosco",
  vendedor:      "Vendedor",
  concesionario: "Encargado Concesionario",
  repartidor:    "Repartidor",
};

const ROLE_BADGE: Record<string, string> = {
  admin:         "bg-tierra-50 text-tierra-700 border-tierra-200",
  encargado:     "bg-blue-50 text-blue-700 border-blue-200",
  vendedor:      "bg-purple-50 text-purple-700 border-purple-200",
  concesionario: "bg-amber-50 text-amber-700 border-amber-200",
  repartidor:    "bg-green-50 text-green-700 border-green-200",
};

// ── Form crear staff ──────────────────────────────────────────────────────────
const createSchema = z.object({
  nombre:     z.string().min(2, "Mínimo 2 caracteres"),
  email:      z.string().email("Email inválido"),
  password:   z.string().min(8, "Mínimo 8 caracteres"),
  role:       z.enum(ROLES_PERSONAL),
  sucursalId: z.string().optional(),
});

function NuevoStaffForm({ sucursales, onCreated }: { sucursales: Sucursal[]; onCreated: () => void }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { nombre: "", email: "", password: "", role: "vendedor", sucursalId: "" },
  });

  const roleValue = watch("role");
  const sucursalValue = watch("sucursalId");
  const [sistemas, setSistemas] = useState<Sistema[]>(["kiosco"]);

  function onSubmit(values: z.infer<typeof createSchema>) {
    if (!sistemasFijos(values.role) && sistemas.length === 0) { alert("Elegí al menos un sistema (Kiosco o Tenteo)."); return; }
    startTransition(async () => {
      try {
        await crearStaff({
          nombre:     values.nombre,
          email:      values.email,
          password:   values.password,
          role:       values.role,
          sistemas:   sistemasFijos(values.role) ? undefined : sistemas,
          sucursalId: values.sucursalId || undefined,
        });
        reset();
        setSistemas(["kiosco"]);
        router.refresh();
        onCreated();
      } catch (e) {
        alert(friendlyError(e));
      }
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 space-y-4">
      <p className="text-sm font-semibold text-neutral-900">Nuevo usuario</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Nombre *" placeholder="Nombre completo" error={errors.nombre?.message} {...register("nombre")} />
        <Input label="Email *" type="email" placeholder="correo@ejemplo.com" error={errors.email?.message} {...register("email")} />
        <Input label="Contraseña *" type="password" placeholder="Mínimo 8 caracteres" error={errors.password?.message} {...register("password")} />
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Rol *</label>
          <select
            {...register("role")}
            className="w-full h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
          >
            <option value="vendedor">Vendedor</option>
            <option value="encargado">Encargado kiosco</option>
            <option value="concesionario">Encargado Concesionario</option>
            <option value="repartidor">Repartidor</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Sucursal</label>
          <select
            {...register("sucursalId")}
            className="w-full h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
          >
            <option value="">Sin asignar por ahora</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}{(roleValue === "encargado" || roleValue === "concesionario") && s.encargado_user_id ? " (ya tiene encargado)" : ""}
              </option>
            ))}
          </select>
        </div>
        <SistemasPicker
          role={roleValue}
          valor={sistemas}
          onChange={setSistemas}
          sucursalesElegidas={sucursales.filter((s) => s.id === sucursalValue)}
        />
      </div>
      <div className="flex justify-end">
        <Button size="sm" loading={pending} onClick={handleSubmit(onSubmit)}>Crear usuario</Button>
      </div>
    </div>
  );
}

// ── Drawer editar ─────────────────────────────────────────────────────────────
const editSchema = z.object({
  nombre:   z.string().min(2, "Mínimo 2 caracteres"),
  password: z.string().optional().refine((v) => !v || v.length >= 8, { message: "Mínimo 8 caracteres" }),
});

function EditDrawer({
  user,
  sucursales,
  onClose,
}: {
  user: StaffUser;
  sucursales: Sucursal[];
  onClose: () => void;
}) {
  const [pending,     startTransition] = useTransition();
  const [resetting,   startReset]      = useTransition();
  const [suspendiendo, startSuspend]   = useTransition();
  const [resetLink,   setResetLink]    = useState<string | null>(null);
  const [copied,      setCopied]       = useState(false);
  const [creditoLimite, setCreditoLimite] = useState(
    user.creditoLimite != null ? String(user.creditoLimite) : ""
  );
  const [esSocio, setEsSocio] = useState(user.esSocio);
  const [role, setRole] = useState(user.role ?? "vendedor");
  const [sistemas, setSistemas] = useState<Sistema[]>(user.sistemas);
  const router = useRouter();

  const sucursalActual =
    (user.role === "encargado" || user.role === "concesionario")
      ? sucursales.find((s) => s.encargado_user_id === user.id)
      : sucursales.find((s) => s.id === user.sucursalIdProfile);

  const [sucursalId, setSucursalId] = useState(sucursalActual?.id ?? "");
  const [sucursalIds, setSucursalIds] = useState<string[]>(user.sucursalIdsVendedor);

  function toggleSucursal(id: string) {
    setSucursalIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  // Si se cambia el rol acá mismo, la asignación de sucursal significa algo
  // distinto para cada uno (encargado: una sola, exclusiva -- vendedor: un
  // conjunto) -- no tiene sentido arrastrar el valor del rol anterior, se
  // arranca en blanco y se elige de nuevo para el rol nuevo.
  function handleRoleChange(nuevoRol: string) {
    setRole(nuevoRol);
    setSucursalId("");
    setSucursalIds([]);
    // Los sistemas de admin y repartidor son fijos; al pasar a otro rol se arranca en
    // kiosco (lo que se tenía por rol fijo no se traslada), salvo que ya hubiera una elección propia.
    const fijos = sistemasFijos(nuevoRol as Rol);
    if (fijos) setSistemas(fijos);
    else if (sistemasFijos(role as Rol)) setSistemas(sistemasFijos(user.role as Rol) ? ["kiosco"] : user.sistemas);
  }

  const sucursalesElegidas = role === "vendedor"
    ? sucursales.filter((s) => sucursalIds.includes(s.id))
    : sucursales.filter((s) => s.id === sucursalId);

  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    defaultValues: { nombre: user.nombre ?? "", password: "" },
  });

  function onSubmit(values: z.infer<typeof editSchema>) {
    if (!sistemasFijos(role as Rol) && sistemas.length === 0) { alert("Elegí al menos un sistema (Kiosco o Tenteo)."); return; }
    // Solo se mandan los sistemas si cambiaron o cambió el rol: quien no se toca queda con su dato (o su defecto).
    const cambioSistemas = sistemas.join(",") !== user.sistemas.join(",") || role !== user.role;
    startTransition(async () => {
      try {
        const limiteNum = creditoLimite.trim() ? parseFloat(creditoLimite) : null;
        await actualizarStaff(user.id, {
          nombre:        values.nombre,
          password:      values.password || undefined,
          creditoLimite: limiteNum,
          esSocio,
          role:          role !== user.role ? (role as Rol) : undefined,
          sistemas:      cambioSistemas && !sistemasFijos(role as Rol) ? sistemas : undefined,
        });
        if (role === "vendedor") {
          const cambiaron =
            user.role !== "vendedor" ||
            sucursalIds.length !== user.sucursalIdsVendedor.length ||
            [...sucursalIds].sort().join(",") !== [...user.sucursalIdsVendedor].sort().join(",");
          if (cambiaron) await asignarSucursalesVendedor(user.id, sucursalIds);
        } else if (role !== user.role || sucursalId !== (sucursalActual?.id ?? "")) {
          await asignarSucursal(user.id, sucursalId || null, role);
        }
        router.refresh();
        onClose();
      } catch (e) {
        alert(friendlyError(e));
      }
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
          <h2 className="text-base font-semibold font-display text-neutral-900">
            Editar {ROLE_LABEL[role] ?? role}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors">
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <p className="text-xs text-neutral-400 mb-0.5">Email</p>
            <p className="text-sm font-medium text-neutral-800">{user.email}</p>
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Rol</label>
            <select
              value={role}
              onChange={(e) => handleRoleChange(e.target.value)}
              className="w-full h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
            >
              <option value="vendedor">Vendedor</option>
              <option value="encargado">Encargado kiosco</option>
              <option value="concesionario">Encargado Concesionario</option>
              <option value="repartidor">Repartidor</option>
              <option value="admin">Administrador</option>
            </select>
            {role !== user.role && (
              <p className="text-[11px] text-amber-600 mt-1">
                Cambiaste el rol — elegí de nuevo la sucursal más abajo, la asignación anterior no se traslada sola.
              </p>
            )}
          </div>
          <SistemasPicker role={role} valor={sistemas} onChange={setSistemas} sucursalesElegidas={sucursalesElegidas} />
          <Input label="Nombre" error={errors.nombre?.message} {...register("nombre")} />
          <Input
            label="Nueva contraseña"
            type="password"
            placeholder="Dejar vacío para no cambiar"
            error={errors.password?.message}
            {...register("password")}
          />
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">
              Límite de crédito CTA (ARS)
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={creditoLimite}
              onChange={(e) => setCreditoLimite(e.target.value)}
              placeholder="Sin límite"
              className="w-full h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm tabular-nums focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
            />
          </div>
          {role === "vendedor" ? (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">
                Sucursales asignadas
              </label>
              <div className="space-y-1.5">
                {sucursales.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700"
                      checked={sucursalIds.includes(s.id)}
                      onChange={() => toggleSucursal(s.id)}
                    />
                    <span className="text-sm text-neutral-700">{s.nombre}</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-neutral-400 mt-1.5">
                Si marcás más de una, elige en cuál trabaja al abrir el turno — el resto sigue funcionando como siempre.
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">
                Sucursal asignada
              </label>
              <select
                value={sucursalId}
                onChange={(e) => setSucursalId(e.target.value)}
                className="w-full h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
              >
                <option value="">Sin sucursal asignada</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                    {(role === "encargado" || role === "concesionario") && s.encargado_user_id && s.encargado_user_id !== user.id
                      ? " (asignada a otro encargado)"
                      : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          {user.lastSignIn && (
            <div>
              <p className="text-xs text-neutral-400 mb-0.5">Último acceso</p>
              <p className="text-sm text-neutral-600">{user.lastSignIn}</p>
            </div>
          )}

          {/* Socio (retiros de Tesorería) */}
          <div className="border-t border-neutral-100 pt-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Es socio</p>
                <p className="text-xs text-neutral-400 mt-0.5">Aparece como opción de socio en Tesorería (retiros/devoluciones), en cualquier sucursal</p>
              </div>
              <input
                type="checkbox"
                checked={esSocio}
                onChange={(e) => setEsSocio(e.target.checked)}
                className="size-4 rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700/20"
              />
            </label>
          </div>

          {/* Suspensión */}
          <div className="border-t border-neutral-100 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Suspender cuenta</p>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {user.isSuspended ? "Suspendido — no puede ingresar" : "Cuenta activa"}
                </p>
              </div>
              <button
                disabled={suspendiendo}
                onClick={() => {
                  const msg = user.isSuspended
                    ? "¿Reactivar este usuario?"
                    : "¿Suspender a este usuario? No podrá ingresar al sistema.";
                  if (!confirm(msg)) return;
                  startSuspend(async () => {
                    try {
                      await suspenderStaff(user.id, !user.isSuspended);
                      router.refresh();
                      onClose();
                    } catch (e) { alert(friendlyError(e)); }
                  });
                }}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${user.isSuspended ? "bg-red-400" : "bg-neutral-300"}`}
              >
                <span className={`inline-block size-4 mt-0.5 rounded-full bg-white shadow-sm transition-transform ${user.isSuspended ? "translate-x-4.5" : "translate-x-0.5"}`} />
              </button>
            </div>
          </div>

          {/* Link de acceso */}
          <div className="border-t border-neutral-100 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 mb-1.5">Link de acceso único</p>
            {resetLink ? (
              <div className="space-y-2">
                <input
                  readOnly
                  value={resetLink}
                  onClick={(e) => e.currentTarget.select()}
                  className="w-full h-9 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-xs text-neutral-600 font-mono"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(resetLink).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                >
                  {copied ? "✓ Copiado" : "Copiar link"}
                </Button>
              </div>
            ) : (
              <>
                <p className="text-xs text-neutral-400 mb-2">Generá un link para que el empleado pueda ingresar o cambiar su contraseña.</p>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={resetting}
                  onClick={() => {
                    if (!user.email) { alert("El usuario no tiene email"); return; }
                    startReset(async () => {
                      try { setResetLink(await generarLinkResetPassword(user.email!)); }
                      catch (e) { alert(friendlyError(e)); }
                    });
                  }}
                >
                  Generar link de acceso
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-neutral-200 flex gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button variant="primary" size="sm" loading={pending} onClick={handleSubmit(onSubmit)} className="flex-1">
            Guardar cambios
          </Button>
        </div>
      </aside>
    </>
  );
}

// ── Eliminar ──────────────────────────────────────────────────────────────────
function DeleteBtn({ id, email }: { id: string; email?: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!confirm(`¿Eliminar usuario ${email ?? id}?`)) return;
        startTransition(async () => {
          await eliminarStaff(id);
          router.refresh();
        });
      }}
      className="text-xs text-neutral-400 hover:text-danger transition-colors disabled:opacity-50"
    >
      {pending ? "…" : "Eliminar"}
    </button>
  );
}

// ── Lista principal ───────────────────────────────────────────────────────────
export function StaffList({ staff, sucursales }: { staff: StaffUser[]; sucursales: Sucursal[] }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<StaffUser | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-neutral-400">{staff.length} usuarios</span>
        <Button size="sm" variant={showForm ? "ghost" : "primary"} onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancelar" : (
            <>
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Nuevo usuario
            </>
          )}
        </Button>
      </div>

      {showForm && <NuevoStaffForm sucursales={sucursales} onCreated={() => setShowForm(false)} />}

      <div className="rounded-xl border border-neutral-200 bg-white overflow-x-auto">
        {staff.length === 0 ? (
          <div className="p-10 text-center text-sm text-neutral-400">No hay usuarios con rol de staff.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Usuario</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Rol</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Sistemas</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">Sucursal</th>
                <th className="px-4 py-3 w-28" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {staff.map((u) => {
                const sucursal =
                  (u.role === "encargado" || u.role === "concesionario")
                    ? sucursales.find((s) => s.encargado_user_id === u.id)
                    : sucursales.find((s) => s.id === u.sucursalIdProfile);
                return (
                  <tr key={u.id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium text-neutral-800 text-sm">{u.nombre ?? <span className="text-neutral-400">Sin nombre</span>}</p>
                      <p className="text-xs text-neutral-400 mt-0.5">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {u.role && (
                          <Badge className={ROLE_BADGE[u.role] ?? ""}>
                            {ROLE_LABEL[u.role] ?? u.role}
                          </Badge>
                        )}
                        {u.isSuspended && (
                          <Badge className="bg-red-50 text-red-600 border-red-200">Suspendido</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-nowrap gap-1.5 items-center">
                        {u.sistemas.map((s) => (
                          <Badge key={s} className={SISTEMA_BADGE[s]}>{SISTEMA_LABEL[s]}</Badge>
                        ))}
                        {u.sistemasPorDefecto && <span className="text-[10px] text-neutral-300">por defecto</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {sucursal
                        ? <span className="text-sm text-selva-700 font-medium">{sucursal.nombre}</span>
                        : <span className="text-xs text-neutral-300">Sin asignar</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => setEditing(u)}
                          className="text-xs text-tierra-700 hover:underline font-medium"
                        >
                          Editar
                        </button>
                        {u.role !== "admin" && <DeleteBtn id={u.id} email={u.email} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <EditDrawer user={editing} sucursales={sucursales} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
