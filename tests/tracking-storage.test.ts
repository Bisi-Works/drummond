import { afterEach, describe, expect, it, vi } from "vitest"

import { DAY_LOG_PREFIX } from "~lib/tracking/constants"
import { emptyDay, loadDay, saveDay, saveDayMerged, subscribeDay } from "~lib/tracking/store"
import type { DayLog, TrackedConversation } from "~lib/tracking/types"

// Persistência do dia com um `chrome.storage.local` de mentira injetado em `globalThis`. O store lê
// o global na hora da chamada, então o stub manda no round-trip sem arrastar navegador nem rede —
// e, por ficar num arquivo próprio, a injeção do `chrome` não contamina os testes puros.

type StorageChange = { oldValue?: unknown; newValue?: unknown }
type StorageListener = (changes: Record<string, StorageChange>, areaName: string) => void

interface FakeChrome {
  /** Conteúdo "gravado", indexado pela chave completa (ex.: "drummond.dayLog.2026-10-07"). */
  data: Map<string, unknown>
  /** Faz as leituras seguintes falharem, para exercitar o caminho "sem storage". */
  breakReads: () => void
  /** Faz as gravações seguintes falharem. */
  breakWrites: () => void
  /** Entrega um evento de `chrome.storage.onChanged`, como outra aba faria. */
  emitChanges: (changes: Record<string, StorageChange>, areaName?: string) => void
  /** Quantos listeners de mudança seguem registrados. */
  listenerCount: () => number
}

/** `chrome.storage.local` mínimo: só o que o store usa (`get`/`set`/`remove`). */
const installChrome = (initial: Record<string, unknown> = {}): FakeChrome => {
  const data = new Map(Object.entries(initial))
  let failReads = false
  let failWrites = false

  const listeners = new Set<StorageListener>()

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

  const onChanged = {
    addListener: (listener: StorageListener) => listeners.add(listener),
    removeListener: (listener: StorageListener) => listeners.delete(listener)
  }

  Object.defineProperty(globalThis, "chrome", {
    value: { storage: { local, onChanged } },
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
    },
    emitChanges: (changes, areaName = "local") => {
      for (const listener of listeners) listener(changes, areaName)
    },
    listenerCount: () => listeners.size
  }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "chrome")
  vi.restoreAllMocks()
})

const conversation = (over: Partial<TrackedConversation> = {}): TrackedConversation => ({
  key: "chat-1",
  platform: "botconversa",
  label: "Cliente",
  openedAt: 1_000,
  lastSeenAt: 1_000,
  lastMessageAuthor: "cliente",
  lastMessageText: "Boa tarde",
  lastMessageAt: 1_000,
  clientSince: 1_000,
  firstResponseAt: null,
  lastClientAt: 1_000,
  lastSellerAt: null,
  messageCount: 1,
  reviewCount: 0,
  ...over
})

const dayWith = (
  date: string,
  conversations: TrackedConversation[],
  updatedAt = 1_000
): DayLog => ({
  date,
  conversations: Object.fromEntries(conversations.map((item) => [item.key, item])),
  updatedAt
})

describe("loadDay / saveDay", () => {
  it("faz round-trip do dia na chave prefixada da própria data", async () => {
    const chrome = installChrome()
    const day = dayWith("2026-10-07", [conversation()])

    await saveDay(day)

    expect(chrome.data.get(`${DAY_LOG_PREFIX}2026-10-07`)).toEqual(day)
    await expect(loadDay("2026-10-07")).resolves.toEqual(day)
  })

  it("mantém cada data na sua própria chave, sem misturar os dias", async () => {
    const chrome = installChrome()
    await saveDay(dayWith("2026-10-07", [conversation({ key: "chat-1", lastMessageText: "hoje" })]))
    await saveDay(
      dayWith("2026-10-08", [conversation({ key: "chat-2", lastMessageText: "amanhã" })], 2_000)
    )

    const today = await loadDay("2026-10-07")
    const tomorrow = await loadDay("2026-10-08")

    expect(Object.keys(today.conversations)).toEqual(["chat-1"])
    expect(Object.keys(tomorrow.conversations)).toEqual(["chat-2"])
    expect(today.conversations["chat-2"]).toBeUndefined()
    expect(tomorrow.conversations["chat-1"]).toBeUndefined()
    expect(chrome.data.size).toBe(2)
    // Data sem gravação continua vazia: o dia novo não herda nada do anterior.
    await expect(loadDay("2026-10-09")).resolves.toEqual(emptyDay("2026-10-09"))
  })

  it("devolve um dia vazio quando a leitura do storage falha", async () => {
    const chrome = installChrome({
      [`${DAY_LOG_PREFIX}2026-10-07`]: dayWith("2026-10-07", [conversation()])
    })
    chrome.breakReads()

    await expect(loadDay("2026-10-07")).resolves.toEqual(emptyDay("2026-10-07"))
  })

  it("devolve um dia vazio quando não há `chrome.storage` (extensão recarregada)", async () => {
    Reflect.deleteProperty(globalThis, "chrome")

    await expect(loadDay("2026-10-07")).resolves.toEqual(emptyDay("2026-10-07"))
  })

  it("não lança quando a gravação falha e preserva o que já estava salvo", async () => {
    const previous = dayWith("2026-10-07", [conversation({ lastMessageText: "antigo" })])
    const chrome = installChrome({ [`${DAY_LOG_PREFIX}2026-10-07`]: previous })
    chrome.breakWrites()

    await expect(
      saveDay(dayWith("2026-10-07", [conversation({ lastMessageText: "novo" })], 9_000))
    ).resolves.toBeUndefined()
    expect(chrome.data.get(`${DAY_LOG_PREFIX}2026-10-07`)).toEqual(previous)
  })
})

describe("saveDayMerged", () => {
  it("junta a gravação local ao que já está no storage (duas abas, mesmo dia)", async () => {
    const chrome = installChrome({
      [`${DAY_LOG_PREFIX}2026-10-07`]: dayWith(
        "2026-10-07",
        [conversation({ key: "chat-1", lastMessageText: "aba A" })],
        1_000
      )
    })

    await saveDayMerged(
      dayWith("2026-10-07", [conversation({ key: "chat-2", lastMessageText: "aba B" })], 2_000)
    )

    const stored = await loadDay("2026-10-07")
    expect(Object.keys(stored.conversations).sort()).toEqual(["chat-1", "chat-2"])
    expect(stored.conversations["chat-1"].lastMessageText).toBe("aba A")
    expect(stored.conversations["chat-2"].lastMessageText).toBe("aba B")
    expect(stored.updatedAt).toBe(2_000)
    expect(chrome.data.size).toBe(1)
  })

  it("não toca nas outras datas ao juntar o dia de hoje", async () => {
    const yesterday = dayWith("2026-10-06", [conversation({ key: "chat-0" })], 500)
    const chrome = installChrome({ [`${DAY_LOG_PREFIX}2026-10-06`]: yesterday })

    await saveDayMerged(dayWith("2026-10-07", [conversation({ key: "chat-1" })], 2_000))

    expect(chrome.data.get(`${DAY_LOG_PREFIX}2026-10-06`)).toEqual(yesterday)
  })
})

describe("subscribeDay", () => {
  it("entrega o dia da chave alterada, normalizado, e ignora outras chaves e áreas", () => {
    const chrome = installChrome()
    const onChange = vi.fn()
    subscribeDay(onChange)

    chrome.emitChanges({
      [`${DAY_LOG_PREFIX}2026-10-08`]: {
        newValue: {
          conversations: { "chat-2": { key: "chat-2", clientSince: 5_000 } },
          updatedAt: 6_000
        }
      },
      [`${DAY_LOG_PREFIX}2026-10-07`]: {
        newValue: { conversations: { "chat-1": { key: "chat-1", clientSince: 1_000 } }, updatedAt: 2_000 }
      },
      outro: { newValue: 1 }
    })
    // Área diferente da local não conta.
    chrome.emitChanges({ [`${DAY_LOG_PREFIX}2026-10-07`]: { newValue: {} } }, "sync")

    expect(onChange).toHaveBeenCalledTimes(2)
    const [firstDay, firstDate] = onChange.mock.calls[0]
    expect(firstDate).toBe("2026-10-08")
    expect(firstDay.date).toBe("2026-10-08")
    expect(firstDay.conversations["chat-2"]).toMatchObject({
      key: "chat-2",
      clientSince: 5_000,
      firstResponseAt: null,
      lastSellerAt: null,
      messageCount: 0
    })
  })

  it("para de escutar depois do unsubscribe", () => {
    const chrome = installChrome()
    const onChange = vi.fn()
    const unsubscribe = subscribeDay(onChange)

    unsubscribe()
    expect(chrome.listenerCount()).toBe(0)

    chrome.emitChanges({ [`${DAY_LOG_PREFIX}2026-10-09`]: { newValue: {} } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it("não quebra quando não há `chrome.storage.onChanged`", () => {
    Reflect.deleteProperty(globalThis, "chrome")
    const onChange = vi.fn()

    const unsubscribe = subscribeDay(onChange)

    expect(() => unsubscribe()).not.toThrow()
    expect(onChange).not.toHaveBeenCalled()
  })
})
