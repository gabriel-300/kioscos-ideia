import { defineConfig } from "@playwright/test";

// E2E de humo, SOLO LECTURA: no hace login ni escribe en la base. No hay
// entorno de staging (la base es la de producción), así que los flujos que sí
// escriben (venta, cierre de caja, pedido online) NO están acá -- para
// automatizarlos hace falta un proyecto Supabase aparte o una branch de
// Supabase; ver informe de auditoría 19/09/2026.
//
// E2E_BASE_URL: por defecto el Worker de producción. Para probar el código
// local: `npm run dev` y E2E_BASE_URL=http://localhost:3000.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://kioscos-ideia.lytwyn-ideia.workers.dev",
    ignoreHTTPSErrors: false,
  },
});
