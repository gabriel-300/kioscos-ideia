import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Iniciar sesión — Kioscos IDEIA" };

export default function LoginPage() {
  return <LoginForm />;
}
