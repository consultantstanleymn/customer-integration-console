import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["api/test/**/*.test.ts", "mocks/test/**/*.test.ts", "web/test/**/*.test.ts"],
    globalSetup: ["./scripts/vitest-global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
