import { afterEach, describe, expect, it } from "vitest"

import {
  loadTranscript,
  loadTranscripts,
  pruneTranscripts,
  saveTranscript,
  toStoredTranscript,
  TRANSCRIPT_VERSION,
  transcriptStorageKey,
  type TranscriptRef
} from "~lib/transcripts/store"

// O cache é lido no content script e no background; o teste usa um `chrome.storage.local` de
// mentira para cobrir round-trip, lote, dados corrompidos e indisponibilidade sem navegador.

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

const ref = (over: Partial<TranscriptRef> = {}): TranscriptRef => ({
  platform: "botconversa",
  conversationKey: "12345",
  messageKey: "wamid.ABC",
  ...over
})

const NOW = new Date(2026, 9, 19, 12, 0).getTime()

const input = {
  text: "Bom dia, consigo sim.",
  at: NOW,
  model: "openai/whisper-large-v3-turbo",
  provider: "DeepInfra",
  mime: "audio/ogg",
  bytes: 1234
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "chrome")
})

describe("transcriptStorageKey", () => {
  it("separa plataforma, conversa e mensagem com segmentos escapados", () => {
    const key = transcriptStorageKey(ref({ conversationKey: "a/b?c", messageKey: "x y" }))

    expect(key).toBe("drummond.transcript.v1.botconversa.a%2Fb%3Fc.x%20y")
  })

  it("não colide entre conversas diferentes", () => {
    const first = transcriptStorageKey(ref({ conversationKey: "1" }))
    const second = transcriptStorageKey(ref({ conversationKey: "2" }))

    expect(first).not.toBe(second)
  })
})

describe("toStoredTranscript", () => {
  it("normaliza um registro válido", () => {
    expect(toStoredTranscript({ version: TRANSCRIPT_VERSION, ...input })).toEqual({
      version: TRANSCRIPT_VERSION,
      ...input
    })
  })

  it("corta espaços do texto", () => {
    const stored = toStoredTranscript({ version: TRANSCRIPT_VERSION, ...input, text: "  oi  " })
    expect(stored?.text).toBe("oi")
  })

  it("descarta versão errada, texto vazio, horário inválido ou modelo ausente", () => {
    expect(toStoredTranscript({ version: 99, ...input })).toBeNull()
    expect(toStoredTranscript({ version: TRANSCRIPT_VERSION, ...input, text: "   " })).toBeNull()
    expect(toStoredTranscript({ version: TRANSCRIPT_VERSION, ...input, at: Number.NaN })).toBeNull()
    expect(toStoredTranscript({ version: TRANSCRIPT_VERSION, ...input, model: "" })).toBeNull()
    expect(toStoredTranscript(null)).toBeNull()
  })
})

describe("saveTranscript / loadTranscript", () => {
  it("faz round-trip por messageKey", async () => {
    installChrome()

    await expect(saveTranscript(ref(), input)).resolves.toBe(true)
    await expect(loadTranscript(ref())).resolves.toEqual({
      version: TRANSCRIPT_VERSION,
      ...input
    })
  })

  it("devolve false quando a escrita falha ou não há storage", async () => {
    const fake = installChrome()
    fake.breakWrites()
    await expect(saveTranscript(ref(), input)).resolves.toBe(false)

    Reflect.deleteProperty(globalThis, "chrome")
    await expect(saveTranscript(ref(), input)).resolves.toBe(false)
    await expect(loadTranscript(ref())).resolves.toBeNull()
  })

  it("não grava texto vazio", async () => {
    const fake = installChrome()

    await expect(saveTranscript(ref(), { ...input, text: "  " })).resolves.toBe(false)
    expect(fake.data.size).toBe(0)
  })
})

describe("loadTranscripts", () => {
  it("lê várias mensagens de uma vez e ignora cache ausente ou inválido", async () => {
    const fake = installChrome()
    const messageA = ref({ messageKey: "a" })
    const messageB = ref({ messageKey: "b" })
    const messageC = ref({ messageKey: "c" })

    await saveTranscript(messageA, input)
    await saveTranscript(messageB, { ...input, text: "Segunda mensagem" })
    fake.data.set(transcriptStorageKey(messageC), { version: 99, text: "lixo" })

    await expect(loadTranscripts([messageA, messageB, messageC])).resolves.toEqual({
      a: "Bom dia, consigo sim.",
      b: "Segunda mensagem"
    })
  })

  it("devolve vazio sem storage ou sem refs", async () => {
    await expect(loadTranscripts([ref()])).resolves.toEqual({})

    const fake = installChrome()
    await expect(loadTranscripts([])).resolves.toEqual({})

    fake.breakReads()
    await expect(loadTranscripts([ref()])).resolves.toEqual({})
  })
})

describe("pruneTranscripts", () => {
  it("remove vencidas e inválidas, preservando as recentes e chaves de outro namespace", async () => {
    const fake = installChrome()
    const fresh = ref({ messageKey: "fresh" })
    const old = ref({ messageKey: "old" })
    const invalid = ref({ messageKey: "invalid" })

    await saveTranscript(fresh, { ...input, at: NOW })
    fake.data.set(transcriptStorageKey(old), {
      version: TRANSCRIPT_VERSION,
      ...input,
      at: NOW - 31 * 24 * 60 * 60 * 1000
    })
    fake.data.set(transcriptStorageKey(invalid), { version: 1, text: "" })
    fake.data.set("drummond.day.2026-10-19", { date: "2026-10-19" })
    fake.data.set("theme", "dark")

    await expect(pruneTranscripts(NOW)).resolves.toBe(2)
    expect(fake.data.has(transcriptStorageKey(fresh))).toBe(true)
    expect(fake.data.has(transcriptStorageKey(old))).toBe(false)
    expect(fake.data.has(transcriptStorageKey(invalid))).toBe(false)
    expect(fake.data.get("drummond.day.2026-10-19")).toEqual({ date: "2026-10-19" })
    expect(fake.data.get("theme")).toBe("dark")
  })

  it("devolve 0 sem storage ou quando a leitura falha", async () => {
    await expect(pruneTranscripts(NOW)).resolves.toBe(0)

    const fake = installChrome()
    fake.breakReads()
    await expect(pruneTranscripts(NOW)).resolves.toBe(0)
  })
})
