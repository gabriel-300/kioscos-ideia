import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Primera base de tests (auditoría 19/09/2026). Solo lógica pura y módulos
// que reciben el cliente de Supabase por parámetro (se prueban con un
// doble en memoria, tests/helpers/fake-supabase.ts) -- nada de esto toca la
// base real. Los flujos con login/plata real van en e2e/ (Playwright).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    restoreMocks: true,
  },
});
