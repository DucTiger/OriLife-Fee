import { defineConfig } from "vitest/config";

// THIS repository's tests, not another repository's. `vendor/` is excluded because machines that
// ran the removed LAMP prototype may still hold a checkout of LAMP at `vendor/lamp`, test suite
// included; left alone, vitest would fold that suite into this repository's number.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "vendor/**"],
  },
});
