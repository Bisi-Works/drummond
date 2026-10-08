import { afterEach, describe, expect, it } from "vitest"

import { clearSavedData } from "~lib/dev-reset"

// `chrome.storage.local` de mentira injetado em `globalThis`, como em tracking-storage.test.ts.
const installChrome = (initial: Record<string, unknown>, opts: { failRemove?: boolean } = {}) => {
  const data = new Map(Object.entries(initial))
  const local = {
    get: async () => Object.fromEntries(data),
    remove: async (keys: string | string[]) => {
      if (opts.failRemove) throw new Error("storage indisponível")
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key)
    }
  }
  Object.defineProperty(globalThis, "chrome", {
    value: { storage: { local } },
    configurable: true,
    writable: true
  })
  return data
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "chrome")
})

describe("clearSavedData", () => {
  it("apaga dias, relatórios e a trava, e preserva posição do widget e tema", async () => {
    const data = installChrome({
      "drummond.dayLog.2026-10-07": { date: "2026-10-07" },
      "drummond.dayLog.2026-10-08": { date: "2026-10-08" },
      "drummond.report.2026-10-07": {},
      "drummond.report.latest": { date: "2026-10-07" },
      "drummond.report.generated.2026-10-07": { count: 1 },
      "drummond.widgetPosition": { version: 1, top: 64 },
      theme: "dark",
      "outra.extensao": 1
    })

    expect(await clearSavedData()).toBe(5)
    expect([...data.keys()].sort()).toEqual(["drummond.widgetPosition", "outra.extensao", "theme"])
  })

  it("devolve 0 quando não há nada para apagar", async () => {
    installChrome({ theme: "light" })
    expect(await clearSavedData()).toBe(0)
  })

  it("devolve null sem storage ou quando a limpeza falha, para não anunciar sucesso", async () => {
    expect(await clearSavedData()).toBeNull()

    installChrome({ "drummond.dayLog.2026-10-08": {} }, { failRemove: true })
    expect(await clearSavedData()).toBeNull()
  })
})
