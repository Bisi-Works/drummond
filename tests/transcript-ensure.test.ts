import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatAdapter, ChatMessage } from "~adapters/types"
import { prepareConversation } from "~lib/transcripts/ensure"
import { saveTranscript } from "~lib/transcripts/store"

// O pipeline inteiro sem navegador: storage em memória, adapter falso e o messaging mockado. O que
// importa aqui é que cada áudio seja transcrito uma vez, que o cache seja reaproveitado e que uma
// falha não derrube a conversa.

const sendToBackground = vi.hoisted(() => vi.fn())

vi.mock("@plasmohq/messaging", () => ({ sendToBackground }))

const installChrome = () => {
  const data = new Map<string, unknown>()
  const local = {
    get: async (keys?: string | string[] | null): Promise<Record<string, unknown>> => {
      if (keys == null) return Object.fromEntries(data)
      const list = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(list.filter((key) => data.has(key)).map((key) => [key, data.get(key)]))
    },
    set: async (items: Record<string, unknown>): Promise<void> => {
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
  return data
}

const adapter = (readAudio: (key: string) => ReturnType<NonNullable<ChatAdapter["readAudio"]>>) =>
  ({ id: "botconversa", readAudio }) as unknown as ChatAdapter

const audio = (messageKey: string): ChatMessage => ({
  id: 1,
  author: "cliente",
  text: "[áudio]",
  audio: true,
  messageKey
})

beforeEach(() => {
  sendToBackground.mockReset()
  sendToBackground.mockResolvedValue({
    ok: true,
    text: "Transcrição pronta.",
    meta: { model: "openai/whisper-large-v3-turbo", durationMs: 10, cached: false }
  })
  installChrome()
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, "chrome")
  vi.restoreAllMocks()
})

describe("prepareConversation", () => {
  it("devolve a conversa intacta quando não há áudio", async () => {
    const conversation: ChatMessage[] = [{ id: 1, author: "cliente", text: "Oi" }]
    const result = await prepareConversation(adapter(async () => null), conversation, "1")

    expect(result.conversation[0]).toBe(conversation[0])
    expect(result.total).toBe(0)
    expect(sendToBackground).not.toHaveBeenCalled()
  })

  it("transcreve só o áudio faltante e reporta o progresso", async () => {
    const progress = vi.fn()
    const result = await prepareConversation(
      adapter(async () => ({ blob: new Blob(["abc"]), mimeType: "audio/ogg" })),
      [audio("a")],
      "123",
      progress
    )

    expect(sendToBackground).toHaveBeenCalledTimes(1)
    const call = sendToBackground.mock.calls[0][0]
    expect(call.name).toBe("transcribe-audio")
    expect(call.body).toMatchObject({
      platform: "botconversa",
      conversationKey: "123",
      messageKey: "a",
      mimeType: "audio/ogg",
      audioBase64: "YWJj"
    })
    expect(result.conversation[0].transcript).toBe("Transcrição pronta.")
    expect(result.transcribed).toBe(1)
    expect(progress).toHaveBeenLastCalledWith({ total: 1, done: 1, failed: 0 })
  })

  it("reaproveita a transcrição do cache sem chamar o messaging", async () => {
    await saveTranscript(
      { platform: "botconversa", conversationKey: "123", messageKey: "a" },
      {
        text: "Já estava no cache.",
        at: Date.now(),
        model: "openai/whisper-large-v3-turbo",
        mime: "audio/ogg"
      }
    )

    const result = await prepareConversation(
      adapter(async () => ({ blob: new Blob(["abc"]), mimeType: "audio/ogg" })),
      [audio("a")],
      "123"
    )

    expect(sendToBackground).not.toHaveBeenCalled()
    expect(result.cached).toBe(1)
    expect(result.transcribed).toBe(0)
    expect(result.conversation[0].transcript).toBe("Já estava no cache.")
  })

  it("duas análises simultâneas do mesmo áudio fazem uma única chamada", async () => {
    const fake = adapter(async () => ({ blob: new Blob(["abc"]), mimeType: "audio/ogg" }))
    const conversation = [audio("a")]

    await Promise.all([
      prepareConversation(fake, conversation, "123"),
      prepareConversation(fake, conversation, "123")
    ])

    expect(sendToBackground).toHaveBeenCalledTimes(1)
  })

  it("falha do áudio não derruba a conversa", async () => {
    const result = await prepareConversation(
      adapter(async () => null),
      [audio("a")],
      "123"
    )

    expect(sendToBackground).not.toHaveBeenCalled()
    expect(result.failed).toBe(1)
    expect(result.conversation[0].transcript).toBeUndefined()
  })

  it("erro do background mantém o marcador e conta como falha", async () => {
    sendToBackground.mockResolvedValue({
      ok: false,
      error: "formato recusado",
      meta: { model: "openai/whisper-large-v3-turbo", durationMs: 10, cached: false }
    })

    const result = await prepareConversation(
      adapter(async () => ({ blob: new Blob(["abc"]), mimeType: "audio/webm" })),
      [audio("a")],
      "123"
    )

    expect(result.failed).toBe(1)
    expect(result.transcribed).toBe(0)
    expect(result.conversation[0].transcript).toBeUndefined()
  })
})
