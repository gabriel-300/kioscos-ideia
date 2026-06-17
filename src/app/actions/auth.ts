"use server";

import { createAdminClient } from "@/lib/supabase/server";

/**
 * Reads app_metadata.role from the DB via admin API using the userId from the
 * just-authenticated session. Bypasses the JWT (and the custom_access_token_hook
 * that overwrites staff roles with profiles.role, making them appear as customer_b2c).
 */
export async function obtenerRolReal(
  userId: string,
): Promise<{ role: string | null; b2bStatus: string | null }> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user) return { role: null, b2bStatus: null };

    return {
      role: (data.user.app_metadata?.role as string) ?? null,
      b2bStatus: (data.user.app_metadata?.b2b_status as string) ?? null,
    };
  } catch {
    return { role: null, b2bStatus: null };
  }
}
