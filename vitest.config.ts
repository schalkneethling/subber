import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    host: "127.0.0.1",
  },
  test: {
    clearMocks: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
