import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests unitaires des INVARIANTS MÉTIER purs (src/lib) : parité A/B, matérialisation
// des miroirs, vacances scolaires, délai de réservation, jauge… (audit 2026-07-19 :
// aucune couverture automatisée jusqu'ici). Les tests vivent à côté des modules
// (src/**/*.test.ts) et sont typecheckés avec le reste du code.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
