import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Registrarse — En Minutas" };

export default async function RegisterPage() {
  const supabase = await createClient();
  const { data: zones } = await supabase
    .from("delivery_zones")
    .select("id, name, flete_kg")
    .not("flete_kg", "is", null)
    .eq("is_active", true)
    .order("name");

  return <RegisterForm zones={zones ?? []} />;
}
