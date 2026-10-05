// Quién ve y quién carga en Tesorería.
//   * Ver:   admin o socio (profiles.es_socio). Es la misma regla que ya tenía /admin/tesoreria.
//   * Cargar: admin con profiles.es_administrativo. Los otros socios ven todo pero no cargan (decisión del usuario):
//     la contabilidad la hace una sola persona, mirando la factura real; hoy Damián, mañana quien se marque en Staff.
//
// Sin "use server" a propósito (igual que lib/auth/require-role.ts): son guardas internas, no endpoints.

import { createAdminClient, getUser } from "@/lib/supabase/server";
import { rolDe } from "@/lib/auth/acceso";

export interface PermisosTesoreria {
  userId:      string;
  puedeVer:    boolean;
  puedeCargar: boolean;
}

// null = no hay sesión.
export async function permisosTesoreria(): Promise<PermisosTesoreria | null> {
  const user = await getUser();
  if (!user) return null;

  const { data } = await createAdminClient()
    .from("profiles")
    .select("es_socio, es_administrativo")
    .eq("id", user.id)
    .single();

  const esAdmin = rolDe(user) === "admin";
  const esSocio = !!data?.es_socio;
  return {
    userId:      user.id,
    puedeVer:    esAdmin || esSocio,
    puedeCargar: esAdmin && !!data?.es_administrativo,
  };
}
