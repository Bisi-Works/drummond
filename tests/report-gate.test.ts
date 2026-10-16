import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DailyReport } from "~lib/ai/schemas"
import type { GenerateReportResponse } from "~lib/messages"
import { commitGeneratedReport, loadReportGate } from "~lib/report/gate"
import {
  canGenerateReport,
  loadReport,
  loadReportGeneration,
  markReportGenerated,
  REPORT_GENERATED_PREFIX,
  REPORT_STORAGE_PREFIX,
  saveReport,
  type StoredReport
} from "~lib/report/storage"
import type { DailyReportInput } from "~lib/tracking/report"

// `config` é embutido em tempo de build e imutável no módulo real; aqui um objeto mutável permite
// cobrir `reportUnlimited` sem reimportar o storage a cada caso (mesmo padrão de
// `report-storage.test.ts`).
const mockedConfig = vi.hoisted(() => ({ reportUnlimited: false, reportLimitPerDay: 1 }))

vi.mock("~lib/config", () => ({ config: mockedConfig }))

/** Instante dentro do dia local "2026-10-07" (a trava compara a data com `dayKey(now)`). */
const NOW = new Date(2026, 9, 7, 12, 0).getTime()

/** `chrome.storage.local` de mentira, no mesmo estilo de `report-storage.test.ts`. */
const installChrome = (initial: Record<string, unknown> = {}) => {
  const data = new Map(Object.entries(initial))
  let failWrites = false
  const local = {
    get: async (keys?: string | string[] | null): Promise<Record<string, unknown>> => {
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

  return { data, breakWrites: () => (failWrites = true) }
}

beforeEach(() => {
  mockedConfig.reportUnlimited = false
  mockedConfig.reportLimitPerDay = 1
})

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
    reviews: 0,
    coachings: 0,
    waitingByLevel: { verde: 0, amarelo: 0, laranja: 0, vermelho: 0 },
    alerts: 0,
    averageFirstResponseMs: null,
    averageResponseMs: null
  },
  conversations: []
}

const stored = (): StoredReport => ({
  date: "2026-10-07",
  generatedAt: 1_000,
  model: "deepseek/deepseek-v4-flash-0731",
  promptVersion: "2026-10-07.1",
  report,
  input
})

describe("loadReportGate", () => {
  it("libera sem relatório e sem marca: { locked: false, stored: false }", async () => {
    installChrome()
    await expect(loadReportGate("2026-10-07", NOW)).resolves.toEqual({
      locked: false,
      stored: false
    })
  })

  it("marca stored quando há relatório salvo no dia", async () => {
    installChrome()
    await saveReport("2026-10-07", stored())

    await expect(loadReportGate("2026-10-07", NOW)).resolves.toEqual({
      locked: false,
      stored: true
    })
  })

  it("trava após a marca em produção, mantendo stored quando o relatório existe", async () => {
    installChrome()
    await saveReport("2026-10-07", stored())
    await markReportGenerated("2026-10-07", NOW)

    await expect(loadReportGate("2026-10-07", NOW)).resolves.toEqual({
      locked: true,
      stored: true
    })
  })

  it("não trava quando reportUnlimited (dev)", async () => {
    installChrome()
    await markReportGenerated("2026-10-07", NOW)
    mockedConfig.reportUnlimited = true

    await expect(loadReportGate("2026-10-07", NOW)).resolves.toEqual({
      locked: false,
      stored: false
    })
  })

  it("libera um dia novo e ignora relatório corrompido", async () => {
    const chrome = installChrome()
    await markReportGenerated("2026-10-07", NOW)
    chrome.data.set(`${REPORT_STORAGE_PREFIX}2026-10-08`, { generatedAt: "ontem" })

    await expect(
      loadReportGate("2026-10-08", new Date(2026, 9, 8, 9, 0).getTime())
    ).resolves.toEqual({ locked: false, stored: false })
  })

  it("não lança sem storage", async () => {
    Reflect.deleteProperty(globalThis, "chrome")
    await expect(loadReportGate("2026-10-07", NOW)).resolves.toEqual({
      locked: false,
      stored: false
    })
  })
})

// O widget delega o pós-geração a `commitGeneratedReport`: só um `ok: true` da IA, seguido de uma
// gravação bem-sucedida, consome a cota do dia. É o invariante "falha da IA não marca a geração"
// testado sem React.
const aiOk = (data: DailyReport): GenerateReportResponse => ({
  ok: true,
  data,
  meta: { model: "vendor/report-z", promptVersion: "2026-10-07.1", durationMs: 10 }
})

const aiFail = (error: string): GenerateReportResponse => ({
  ok: false,
  error,
  meta: { model: "vendor/report-z", promptVersion: "2026-10-07.1", durationMs: 10 }
})

describe("commitGeneratedReport", () => {
  it("falha da IA não grava nem marca a geração (cota continua livre)", async () => {
    const chrome = installChrome()

    await expect(
      commitGeneratedReport(input, aiFail("modelo não retornou o formato esperado"), NOW)
    ).resolves.toEqual({ status: "ai-failed", error: "modelo não retornou o formato esperado" })

    // Nada persistido: nem relatório, nem marca — o botão segue disponível para nova tentativa.
    expect(chrome.data.has(`${REPORT_GENERATED_PREFIX}2026-10-07`)).toBe(false)
    expect(chrome.data.has(`${REPORT_STORAGE_PREFIX}2026-10-07`)).toBe(false)
    await expect(loadReportGeneration("2026-10-07")).resolves.toBeNull()
    await expect(canGenerateReport("2026-10-07", NOW)).resolves.toBe(true)
  })

  it("sucesso grava o relatório, marca a cota e trava a segunda geração em produção", async () => {
    installChrome()

    await expect(commitGeneratedReport(input, aiOk(report), NOW)).resolves.toEqual({
      status: "stored",
      generatedAt: NOW
    })

    const expected: StoredReport = {
      date: "2026-10-07",
      generatedAt: NOW,
      model: "vendor/report-z",
      promptVersion: "2026-10-07.1",
      report,
      input
    }
    await expect(loadReport("2026-10-07")).resolves.toEqual(expected)
    await expect(loadReportGeneration("2026-10-07")).resolves.toEqual({
      generatedAt: NOW,
      count: 1
    })
    await expect(canGenerateReport("2026-10-07", NOW)).resolves.toBe(false)
  })

  it("gravação falhando não marca a cota nem deixa relatório pela metade", async () => {
    const chrome = installChrome()
    chrome.breakWrites()

    await expect(commitGeneratedReport(input, aiOk(report), NOW)).resolves.toEqual({
      status: "save-failed"
    })

    await expect(loadReportGeneration("2026-10-07")).resolves.toBeNull()
    await expect(canGenerateReport("2026-10-07", NOW)).resolves.toBe(true)
  })
})
