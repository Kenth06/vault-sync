import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { ADMIN_SECRET: "test-admin-secret-with-at-least-32-characters", GC_GRACE_MS: "0" } },
    }),
  ],
});
