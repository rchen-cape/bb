import path from "node:path";
import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    silent: "passed-only",
    testTimeout: 20_000,
    projects: sharedWorkerProjects({
      pkgDir: import.meta.dirname,
      name: "bb-plugin-bb--ai-hub",
      include: ["**/*.test.{ts,tsx}"],
      exclude: ["node_modules/**", "dist/**"],
      aliases: { "@": "." },
    }),
  },
});
