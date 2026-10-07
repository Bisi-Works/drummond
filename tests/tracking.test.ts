import { describe, expect, it } from "vitest"

import type { ChatMessage } from "~adapters/types"
import { conversationLabel } from "~lib/tracking/level"

const message = (author: ChatMessage["author"], text: string): ChatMessage => ({
  id: 1,
  author,
  text
})

describe("conversationLabel", () => {
  it("usa o início da primeira mensagem do cliente", () => {
    const messages = [
      message("vendedor", "Oi, tudo bem?"),
      message("cliente", "Boa tarde, queria saber o preço do plano")
    ]
    expect(conversationLabel(messages, "chat-123")).toBe("Boa tarde, queria saber o preço do plano")
  })

  it("pega só a primeira linha e colapsa espaços", () => {
    const messages = [message("cliente", "  Quero   saber\nsobre o produto  ")]
    expect(conversationLabel(messages, "chat-123")).toBe("Quero saber")
  })

  it("trunca trechos longos com reticências", () => {
    const messages = [message("cliente", "a".repeat(80))]
    const label = conversationLabel(messages, "chat-123")
    expect(label).toHaveLength(40)
    expect(label.endsWith("…")).toBe(true)
  })

  it("cai para a própria chave quando não há mensagem do cliente", () => {
    expect(conversationLabel([message("vendedor", "Olá")], "chat-123")).toBe("chat-123")
    expect(conversationLabel([], "chat-123")).toBe("chat-123")
  })
})
