import { describe, expect, it } from "vitest"

import type { ChatMessage } from "~adapters/types"
import {
  applyTranscripts,
  audioWithoutTranscript,
  transcriptRefs
} from "~lib/transcripts/prepare"

const conversation: ChatMessage[] = [
  { id: 1, author: "cliente", text: "Oi" },
  {
    id: 2,
    author: "cliente",
    text: "[áudio]",
    audio: true,
    messageKey: "a",
    transcript: "Já transcrito"
  },
  { id: 3, author: "vendedor", text: "[áudio]", audio: true, messageKey: "b" },
  { id: 4, author: "vendedor", text: "[áudio]", audio: true }
]

describe("audioWithoutTranscript", () => {
  it("seleciona só áudios com messageKey e sem transcrição", () => {
    expect(audioWithoutTranscript(conversation).map((m) => m.messageKey)).toEqual(["b"])
  })
})

describe("transcriptRefs", () => {
  it("monta as referências de cache com plataforma e conversa", () => {
    expect(transcriptRefs("botconversa", "123", conversation)).toEqual([
      { platform: "botconversa", conversationKey: "123", messageKey: "b" }
    ])
  })
})

describe("applyTranscripts", () => {
  it("aplica pelo messageKey sem alterar as outras mensagens", () => {
    const next = applyTranscripts(conversation, { b: "Novo contexto", a: "ignorado" })

    expect(next[1].transcript).toBe("Já transcrito")
    expect(next[2].transcript).toBe("Novo contexto")
    expect(next[3].transcript).toBeUndefined()
    expect(next[0]).toBe(conversation[0])
  })

  it("preserva a identidade quando o texto é igual", () => {
    const next = applyTranscripts(conversation, { a: "Já transcrito" })
    expect(next[1]).toBe(conversation[1])
  })
})
