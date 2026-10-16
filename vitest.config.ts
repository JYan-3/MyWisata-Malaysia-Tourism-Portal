import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Bound fork concurrency so full-project checks do not starve other test workers.
    maxWorkers: 4,
    exclude: [
      "**/node_modules/**",
      "**/output/**",
      ".worktrees/**",
      "worktrees/**",
      "tests/e2e/**",
      "scripts/**/*.test.mjs",
      "docs/**",
      "Docs/**",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
