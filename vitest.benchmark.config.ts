import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

// Config separada para os benchmarks (fazem chamadas reais à rede), fora do `pnpm test`.
export default defineConfig({
  resolve: {
    alias: [{ find: /^~(.*)$/, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/$1` }]
  },
  test: {
    include: ["scripts/benchmark/*.run.ts"]
  }
})
