import { afterEach, describe, expect, it } from "vitest"

import {
  quotaDay,
  releaseTranscription,
  reserveTranscription,
  TRANSCRIPTION_DAILY_LIMIT,
  TRANSCRIPTION_QUOTA_KEY
} from "~lib/transcripts/quota"

// A cota vive no `chrome.storage.local` do background. O teste usa um storage de mentira para
// cobrir o dia local, a virada de dia, concorrência, devolução de reserva e indisponibilidade.

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

const TODAY = new Date(2026, 9, 19, 12, 0).getTime()
const TOMORROW = new Date(2026, 9, 20, 9, 0).getTime()

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome
})

describe("quotaDay", () => {
  it("usa o dia local com dois dígitos", () => {
    expect(quotaDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05")
    expect(quotaDay(TODAY)).toBe("2026-10-19")
  })
})

describe("reserveTranscription", () => {
  it("conta as reservas e barra ao atingir o limite", async () => {
    installChrome()

    expect(await reserveTranscription(3, TODAY)).toMatchObject({ ok: true, used: 1, limit: 3 })
    expect(await reserveTranscription(3, TODAY)).toMatchObject({ ok: true, used: 2, limit: 3 })
    expect(await reserveTranscription(3, TODAY)).toMatchObject({ ok: true, used: 3, limit: 3 })
    expect(await reserveTranscription(3, TODAY)).toEqual({ ok: false, used: 3, limit: 3 })
  })

  it("não perde reservas com chamadas concorrentes", async () => {
    const chrome = installChrome()

    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveTranscription(10, TODAY))
    )

    expect(results.every((result) => result.ok)).toBe(true)
    expect(chrome.data.get(TRANSCRIPTION_QUOTA_KEY)).toEqual({ date: "2026-10-19", used: 10 })
  })

  it("zera a contagem quando o dia vira", async () => {
    const chrome = installChrome({
      [TRANSCRIPTION_QUOTA_KEY]: { date: "2026-10-19", used: 1000 }
    })

    expect(await reserveTranscription(TRANSCRIPTION_DAILY_LIMIT, TOMORROW)).toMatchObject({
      ok: true,
      used: 1
    })
    expect(chrome.data.get(TRANSCRIPTION_QUOTA_KEY)).toEqual({ date: "2026-10-20", used: 1 })
  })

  it("trata contador corrompido ou de outro dia como zero", async () => {
    installChrome({ [TRANSCRIPTION_QUOTA_KEY]: { date: "2026-10-18", used: 999 } })
    expect(await reserveTranscription(1000, TODAY)).toMatchObject({ ok: true, used: 1 })

    installChrome({ [TRANSCRIPTION_QUOTA_KEY]: { date: "2026-10-19", used: "muitas" } })
    expect(await reserveTranscription(1000, TODAY)).toMatchObject({ ok: true, used: 1 })
  })

  it("libera quando não há storage ou ele falha (trava de custo, não dependência)", async () => {
    delete (globalThis as { chrome?: unknown }).chrome
    expect(await reserveTranscription(1, TODAY)).toMatchObject({ ok: true, used: 1 })

    const chrome = installChrome()
    chrome.breakReads()
    expect(await reserveTranscription(1, TODAY)).toMatchObject({ ok: true, used: 1 })

    chrome.breakWrites()
    expect(await reserveTranscription(1, TODAY)).toMatchObject({ ok: true })
  })
})

describe("releaseTranscription", () => {
  it("devolve a reserva e nunca deixa o contador negativo", async () => {
    const chrome = installChrome()

    await reserveTranscription(10, TODAY)
    await reserveTranscription(10, TODAY)
    await releaseTranscription(TODAY)

    expect(chrome.data.get(TRANSCRIPTION_QUOTA_KEY)).toEqual({ date: "2026-10-19", used: 1 })

    await releaseTranscription(TODAY)
    await releaseTranscription(TODAY)

    expect(chrome.data.get(TRANSCRIPTION_QUOTA_KEY)).toEqual({ date: "2026-10-19", used: 0 })
  })

  it("não lança sem storage", async () => {
    delete (globalThis as { chrome?: unknown }).chrome
    await expect(releaseTranscription(TODAY)).resolves.toBeUndefined()
  })
})
