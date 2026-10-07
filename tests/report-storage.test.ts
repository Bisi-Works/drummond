import { afterEach, describe, expect, it, vi } from "vitest"

import type { DailyReport } from "~lib/ai/schemas"
import {
  listReportDates,
  loadLatestReportRef,
  loadReport,
  REPORT_LATEST_KEY,
  REPORT_STORAGE_PREFIX,
  saveReport,
  toReportRef,
  toStoredReport,
  type StoredReport
} from "~lib/report/storage"
import type { DailyReportInput } from "~lib/tracking/report"

// Persistência do relatório com um `chrome.storage.local` de mentira, no mesmo estilo de
// `tracking-storage.test.ts`: o módulo lê o global na hora da chamada, então o stub manda no
// round-trip sem arrastar navegador nem rede.

interface FakeChrome {
  data: Map<string, unknown>
  breakReads: () => void
  breakWrites: () => void
}

const installChrome = (initial: Record<string, unknown> = {}): FakeChrome => {
  const data = new Map(Object.entries(initial))
  let failReads = false
  let failWrites = false

  const local = {
    get: async (keys?: string | string[] | null): Promise<Record<string, unknown>> => {
      if (failReads) throw new Error("storage indisponível")
      if (keys == null) return Object.fromEntries(data)
      const list = Array.isArray(keys) ? keys : [keys]
      const items: Record<string, unknown> = {}
      for (const key of list) if (data.has(key)) items[key] = data.get(key)
      return items
    },
    set: async (items: Record<string, unknown>): Promise<void> => {
      if (failWrites) throw new Error("storage indisponível")
      for (const [key, value] of Object.entries(items)) data.set(key, value)
    },
    remove: async (keys: string | string[]): Promise<void> => {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key)
    }
  }

  Object.defineProperty(globalThis, "chrome", {
    value: { storage: { local } },
    configurable: true,
    writable: true
  })

  return {
    data,
    breakReads: () => {
      failReads = true
    },
    breakWrites: () => {
      failWrites = true
    }
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "chrome")
  vi.restoreAllMocks()
})

const report: DailyReport = {
  resumo: "Dia corrido.",
  acertos: ["Boa retomada"],
  erros: ["Demora na resposta"],
  melhorias: ["Responder mais rápido"],
  pendencias: ["Falar com o cliente X"]
}

const input: DailyReportInput = {
  date: "2026-10-07",
  totals: {
    conversations: 1,
    waiting: 0,
    answered: 1,
    withoutMessage: 0,
    reviews: 1,
    coachings: 0,
    waitingByLevel: { verde: 0, amarelo: 0, laranja: 0, vermelho: 0 },
    alerts: 0,
    averageFirstResponseMs: 60_000,
    averageResponseMs: 90_000
  },
  conversations: []
}

const stored = (over: Partial<StoredReport> = {}): StoredReport => ({
  date: "2026-10-07",
  generatedAt: 1_000,
  model: "deepseek/deepseek-v4-flash-0731",
  promptVersion: "2026-10-07.1",
  report,
  input,
  ...over
})

describe("saveReport / loadReport", () => {
  it("faz round-trip do relatório na chave prefixada da própria data", async () => {
    const chrome = installChrome()
    const value = stored()

    await saveReport("2026-10-07", value)

    expect(chrome.data.get(`${REPORT_STORAGE_PREFIX}2026-10-07`)).toEqual(value)
    await expect(loadReport("2026-10-07")).resolves.toEqual(value)
  })

  it("usa a data do parâmetro como dona da chave, mesmo que o relatório traga outra", async () => {
    const chrome = installChrome()

    await saveReport("2026-10-08", stored({ date: "2026-10-07" }))

    expect(chrome.data.get(`${REPORT_STORAGE_PREFIX}2026-10-08`)).toEqual(
      stored({ date: "2026-10-08" })
    )
  })

  it("devolve null sem storage, sem chave ou com registro corrompido", async () => {
    const chrome = installChrome()
    await expect(loadReport("2026-10-07")).resolves.toBeNull()

    await saveReport("2026-10-07", stored())
    chrome.data.set(`${REPORT_STORAGE_PREFIX}2026-10-07`, { generatedAt: "ontem" })
    await expect(loadReport("2026-10-07")).resolves.toBeNull()

    Reflect.deleteProperty(globalThis, "chrome")
    await expect(loadReport("2026-10-07")).resolves.toBeNull()
  })

  it("não lança quando a gravação falha", async () => {
    const chrome = installChrome()
    chrome.breakWrites()
    await expect(saveReport("2026-10-07", stored())).resolves.toBeUndefined()
  })
})

describe("loadLatestReportRef", () => {
  it("aponta para o último relatório gravado", async () => {
    const chrome = installChrome()
    await saveReport("2026-10-06", stored({ date: "2026-10-06", generatedAt: 1_000 }))
    await saveReport("2026-10-07", stored({ date: "2026-10-07", generatedAt: 2_000 }))

    expect(chrome.data.get(REPORT_LATEST_KEY)).toEqual({
      date: "2026-10-07",
      generatedAt: 2_000
    })
    await expect(loadLatestReportRef()).resolves.toEqual({ date: "2026-10-07", generatedAt: 2_000 })
  })

  it("cai para o relatório mais recente quando o ponteiro está ausente ou corrompido", async () => {
    const chrome = installChrome({
      [`${REPORT_STORAGE_PREFIX}2026-10-05`]: stored({ date: "2026-10-05", generatedAt: 100 }),
      [`${REPORT_STORAGE_PREFIX}2026-10-07`]: stored({ date: "2026-10-07", generatedAt: 300 })
    })

    await expect(loadLatestReportRef()).resolves.toEqual({ date: "2026-10-07", generatedAt: 300 })

    chrome.data.set(REPORT_LATEST_KEY, { date: 42 })
    await expect(loadLatestReportRef()).resolves.toEqual({ date: "2026-10-07", generatedAt: 300 })
  })

  it("devolve null sem storage e sem nenhum relatório", async () => {
    installChrome()
    await expect(loadLatestReportRef()).resolves.toBeNull()

    Reflect.deleteProperty(globalThis, "chrome")
    await expect(loadLatestReportRef()).resolves.toBeNull()
  })

  it("devolve null quando a leitura falha", async () => {
    const chrome = installChrome()
    chrome.breakReads()
    await expect(loadLatestReportRef()).resolves.toBeNull()
  })
})

describe("listReportDates", () => {
  it("lista as datas da mais recente para a mais antiga, ignorando chaves alheias", async () => {
    installChrome({
      [`${REPORT_STORAGE_PREFIX}2026-10-05`]: stored({ date: "2026-10-05" }),
      [`${REPORT_STORAGE_PREFIX}2026-10-07`]: stored({ date: "2026-10-07" }),
      [`${REPORT_STORAGE_PREFIX}2026-10-06`]: stored({ date: "2026-10-06" }),
      "drummond.dayLog.2026-10-07": { date: "2026-10-07" },
      [`${REPORT_STORAGE_PREFIX}nao-e-data`]: {}
    })

    await expect(listReportDates()).resolves.toEqual(["2026-10-07", "2026-10-06", "2026-10-05"])
  })

  it("devolve lista vazia sem storage", async () => {
    await expect(listReportDates()).resolves.toEqual([])
  })
})

describe("validadores", () => {
  it("toReportRef aceita só date/ generatedAt válidos", () => {
    expect(toReportRef({ date: "2026-10-07", generatedAt: 1 })).toEqual({
      date: "2026-10-07",
      generatedAt: 1
    })
    expect(toReportRef(null)).toBeNull()
    expect(toReportRef({ date: "", generatedAt: 1 })).toBeNull()
    expect(toReportRef({ date: "2026-10-07", generatedAt: NaN })).toBeNull()
  })

  it("toStoredReport descarta registro sem report/input ou sem metadados", () => {
    expect(toStoredReport(stored(), "2026-10-07")).toEqual(stored())
    expect(toStoredReport({ generatedAt: 1 }, "2026-10-07")).toBeNull()
    expect(toStoredReport(stored({ model: "" }), "2026-10-07")).toBeNull()
    expect(toStoredReport({ ...stored(), input: null }, "2026-10-07")).toBeNull()
  })
})
