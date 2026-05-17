import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors the `paths` mapping in tsconfig.json so the rule engine's
      // `import { Observation } from "@/lib/types/observations"` works under
      // vitest the same way it does under tsc.
      "@/lib": path.resolve(here, "..", "lib"),
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
  },
});
