import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/types/database";

// Cliente con service role — bypasea RLS, solo usar en server actions admin
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component — cookies de solo lectura, ignorar
          }
        },
      },
    }
  );
}

// Usuario de la request, validado UNA sola vez por render. El layout del admin y
// la página piden el usuario a la vez; sin cache() cada uno hacía su propio
// viaje a Supabase Auth (además del middleware). React.cache vive solo durante
// una request, no se comparte entre usuarios. Las Server Actions NO lo usan:
// cada acción valida por su cuenta (requireAdmin/requireStaff).
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
