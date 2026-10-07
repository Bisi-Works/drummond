import { describe, expect, it } from "vitest"

import type { ChatMessage } from "~adapters/types"
import type { CoachingReport, DraftReview } from "~lib/ai/schemas"
import { conversationLabel } from "~lib/tracking/level"
import { coachingSignal, reviewSignal, reviewSummary } from "~lib/tracking/signals"

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

const review = (over: Partial<DraftReview> = {}): DraftReview => ({
  status: "ajustes",
  warnings: [],
  suggestedText: "Olá!",
  changes: [],
  ...over
})

const bantItem = { status: "pendente" as const, evidence: "-", question: "?" }

const coaching = (over: Partial<CoachingReport> = {}): CoachingReport => ({
  summary: "Condução ok.",
  strengths: [],
  improvements: [],
  bant: { budget: bantItem, authority: bantItem, need: bantItem, timing: bantItem },
  nextStep: "Perguntar o prazo.",
  ...over
})

describe("reviewSummary", () => {
  it("resume a primeira alteração e conta quantas houve", () => {
    const summary = reviewSummary(
      review({
        changes: [
          { category: "tom", excerpt: "Oi", reason: "Tom mais próximo." },
          { category: "clareza", excerpt: "Ok", reason: "Frase direta." }
        ]
      })
    )
    expect(summary).toBe("2 ajustes: Tom mais próximo.")
  })

  it("usa o primeiro aviso quando não houve alteração", () => {
    expect(reviewSummary(review({ warnings: ["", "Confira o preço combinado."] }))).toBe(
      "Confira o preço combinado."
    )
  })

  it("tem um texto próprio quando não há nada a apontar", () => {
    expect(reviewSummary(review({ status: "ok" }))).toBe("Sem ajustes necessários")
  })

  it("corta resumos longos em uma linha só", () => {
    const summary = reviewSummary(review({ warnings: [`${"a".repeat(200)}\nsegunda linha`] }))
    expect(summary).toHaveLength(140)
    expect(summary.endsWith("…")).toBe(true)
    expect(summary).not.toContain("\n")
  })
})

describe("reviewSignal / coachingSignal", () => {
  it("anexam o status, o resumo e o instante da revisão", () => {
    const signal = reviewSignal(
      review({ status: "ok", changes: [{ category: "tom", excerpt: "Oi", reason: "Ok." }] }),
      1234
    )
    expect(signal).toEqual({ status: "ok", summary: "Ok.", at: 1234 })
  })

  it("resumem o coaching e preservam o próximo passo", () => {
    expect(coachingSignal(coaching({ summary: "  Boa escuta.  " }), 99)).toEqual({
      summary: "Boa escuta.",
      nextStep: "Perguntar o prazo.",
      at: 99
    })
  })
})
