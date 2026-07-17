"use client";

import { useEffect, useRef, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { Input, Textarea } from "@/components/ui";
import { Button } from "@/components/ui";
import { crearSucursal, actualizarSucursal } from "../actions";
import type { Database } from "@/types/database";

type Sucursal = Database["public"]["Tables"]["sucursales"]["Row"];
type EncargadoUser = { id: string; email: string; nombre: string };

const schema = z.object({
  nombre:              z.string().min(2, "Mínimo 2 caracteres"),
  encargado_nombre:    z.string().optional(),
  encargado_telefono:  z.string().optional(),
  encargado_email:     z.email("Email inválido").optional().or(z.literal("")),
  encargado_user_id:   z.string().optional(),
  direccion:           z.string().optional(),
  localidad:           z.string().min(2, "Requerido"),
  provincia:           z.string().min(2, "Requerido"),
  notas:               z.string().optional(),
  auditoria_obligatoria: z.boolean().optional(),
  pedidoya_store_id:   z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open:            boolean;
  sucursal:        Sucursal | null;
  onClose:         () => void;
  encargadoUsers:  EncargadoUser[];
}

export function SucursalDrawer({ open, sucursal, onClose, encargadoUsers }: Props) {
  const [pending, startTransition] = useTransition();
  const overlayRef = useRef<HTMLDivElement>(null);

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      nombre:             "",
      encargado_nombre:   "",
      encargado_telefono: "",
      encargado_email:    "",
      encargado_user_id:  "",
      direccion:          "",
      localidad:          "Posadas",
      provincia:          "Misiones",
      notas:              "",
      auditoria_obligatoria: false,
      pedidoya_store_id:  "",
    },
  });

  useEffect(() => {
    if (open) {
      reset(sucursal ? {
        nombre:             sucursal.nombre,
        encargado_nombre:   sucursal.encargado_nombre  ?? "",
        encargado_telefono: sucursal.encargado_telefono ?? "",
        encargado_email:    sucursal.encargado_email   ?? "",
        encargado_user_id:  sucursal.encargado_user_id ?? "",
        direccion:          sucursal.direccion          ?? "",
        localidad:          sucursal.localidad,
        provincia:          sucursal.provincia,
        notas:              sucursal.notas             ?? "",
        auditoria_obligatoria: sucursal.auditoria_obligatoria ?? false,
        pedidoya_store_id:  sucursal.pedidoya_store_id  ?? "",
      } : {
        nombre: "", encargado_nombre: "", encargado_telefono: "",
        encargado_email: "", encargado_user_id: "", direccion: "",
        localidad: "Posadas", provincia: "Misiones", notas: "",
        auditoria_obligatoria: false,
        pedidoya_store_id: "",
      });
    }
  }, [open, sucursal, reset]);

  function onSubmit(values: FormValues) {
    const payload = {
      nombre:             values.nombre,
      encargado_nombre:   values.encargado_nombre   || null,
      encargado_telefono: values.encargado_telefono || null,
      encargado_email:    values.encargado_email    || null,
      encargado_user_id:  values.encargado_user_id  || null,
      direccion:          values.direccion          || null,
      localidad:          values.localidad,
      provincia:          values.provincia,
      notas:              values.notas              || null,
      auditoria_obligatoria: values.auditoria_obligatoria ?? false,
      pedidoya_store_id:  values.pedidoya_store_id  || null,
    };

    startTransition(async () => {
      try {
        if (sucursal) {
          await actualizarSucursal(sucursal.id, payload);
        } else {
          await crearSucursal(payload);
        }
        onClose();
      } catch (e) {
        alert((e as Error).message);
      }
    });
  }

  if (!open) return null;

  return (
    <>
      <div
        ref={overlayRef}
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
          <h2 className="text-base font-semibold font-display text-neutral-900">
            {sucursal ? "Editar sucursal" : "Nueva sucursal"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition-colors"
            aria-label="Cerrar"
          >
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto p-6 space-y-5">
          <Input
            label="Nombre del kiosco *"
            placeholder="Ej: Kiosco El Sol"
            error={errors.nombre?.message}
            {...register("nombre")}
          />

          <div className="pt-2 pb-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Encargado</p>
          </div>

          <Input
            label="Nombre"
            placeholder="Nombre del encargado"
            error={errors.encargado_nombre?.message}
            {...register("encargado_nombre")}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Teléfono"
              type="tel"
              placeholder="376 4…"
              error={errors.encargado_telefono?.message}
              {...register("encargado_telefono")}
            />
            <Input
              label="Email"
              type="email"
              placeholder="email@ejemplo.com"
              error={errors.encargado_email?.message}
              {...register("encargado_email")}
            />
          </div>

          {encargadoUsers.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-1">
                Usuario del panel
              </label>
              <select
                {...register("encargado_user_id")}
                onChange={(e) => {
                  const userId = e.target.value;
                  setValue("encargado_user_id", userId);
                  if (userId) {
                    const u = encargadoUsers.find((u) => u.id === userId);
                    if (u) {
                      setValue("encargado_nombre", u.nombre);
                      setValue("encargado_email",  u.email);
                    }
                  }
                }}
                className="w-full h-10 rounded-lg border border-neutral-300 bg-white px-3 text-sm focus:outline-none focus:border-tierra-700 focus:ring-2 focus:ring-tierra-700/20"
              >
                <option value="">Sin acceso al panel</option>
                {encargadoUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre} — {u.email}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-neutral-400">
                Al seleccionar un usuario se auto-completa el nombre y email del encargado.
              </p>
            </div>
          )}

          <div className="pt-2 pb-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Ubicación</p>
          </div>

          <Input
            label="Dirección"
            placeholder="Calle y número"
            error={errors.direccion?.message}
            {...register("direccion")}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Localidad"
              placeholder="Posadas"
              error={errors.localidad?.message}
              {...register("localidad")}
            />
            <Input
              label="Provincia"
              placeholder="Misiones"
              error={errors.provincia?.message}
              {...register("provincia")}
            />
          </div>

          <Textarea
            label="Notas"
            placeholder="Observaciones sobre esta sucursal…"
            {...register("notas")}
          />

          <div className="pt-2 pb-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Stock</p>
          </div>
          <label className="flex items-start gap-2.5 rounded-lg border border-neutral-200 p-3 cursor-pointer hover:bg-neutral-50 transition-colors">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-neutral-300 text-tierra-700 focus:ring-tierra-700/20"
              {...register("auditoria_obligatoria")}
            />
            <span>
              <span className="block text-sm font-medium text-neutral-800">Auditoría de stock obligatoria por turno</span>
              <span className="block text-xs text-neutral-400 mt-0.5">
                No deja cerrar caja hasta contar el stock de ese turno. Activalo recién después de capacitar al personal.
              </span>
            </span>
          </label>

          <div className="pt-2 pb-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">Integraciones</p>
          </div>
          <Input
            label="ID de tienda en PedidosYa"
            placeholder="Se completa cuando tengamos acceso al Vendor Portal"
            error={errors.pedidoya_store_id?.message}
            {...register("pedidoya_store_id")}
          />
          <p className="text-xs text-neutral-400 -mt-3">
            Mapea esta sucursal con la tienda correspondiente en PedidosYa, para que los pedidos que lleguen por webhook se asignen solos.
          </p>
        </form>

        <div className="px-6 py-4 border-t border-neutral-200 flex gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} type="button" className="flex-1">
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            loading={pending}
            onClick={handleSubmit(onSubmit)}
            className="flex-1"
          >
            {sucursal ? "Guardar cambios" : "Crear sucursal"}
          </Button>
        </div>
      </aside>
    </>
  );
}
