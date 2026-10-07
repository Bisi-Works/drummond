import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    // Mesmo alias do Plasmo: `~lib/...` → `src/lib/...`
    alias: [{ find: /^~(.*)$/, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/$1` }]
  },
  test: {
    include: ["tests/**/*.test.ts"]
  }
})
