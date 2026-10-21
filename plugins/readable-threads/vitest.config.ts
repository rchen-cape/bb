import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: "passed-only",
    name: "bb-plugin-readable-threads",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
