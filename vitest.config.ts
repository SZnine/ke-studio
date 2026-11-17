import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: [
      {
        find: "../framework.mjs",
        replacement: fileURLToPath(
          new URL("./src/studio/framework.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
