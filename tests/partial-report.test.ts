import { describe, expect, it } from "vitest"

import { readPartialCoaching } from "~lib/ai/partial-report"

const report = {
  summary: "Conversa cordial.",
  strengths: ["a", "b", "c", "d"],
  improvements: Array.from({ length: 7 }, (_, i) => ({
    messageId: i + 1,
    excerpt: "x",
    issue: "y",
    suggestion: "z",
    category: "tom",
    impact: "medio"
  })),
  bant: {
    budget: { status: "pendente", evidence: "Não abordado.", question: "Qual o orçamento?" },
    authority: { status: "cumprido", evidence: "Dono (#1).", question: "" },
    need: { status: "parcial", evidence: "Vago.", question: "O que mais atrapalha?" },
    timing: { status: "pendente", evidence: "Não abordado.", question: "Para quando?" }
  },
  nextStep: "Perguntar o prazo."
}

describe("readPartialCoaching", () => {
  it("relatório completo sai igual, com os mesmos limites do resultado final", () => {
    expect(readPartialCoaching(JSON.stringify(report))).toEqual({
      ...report,
      strengths: report.strengths.slice(0, 3),
      improvements: report.improvements.slice(0, 5)
    })
  })

  it("enum só aparece quando chegou inteiro", () => {
    const text = JSON.stringify(report)
    const cut = text.indexOf('"pendente"') + 4 // ..."pen
    expect(readPartialCoaching(text.slice(0, cut)).bant?.budget).toEqual({
      status: undefined,
      evidence: undefined,
      question: undefined
    })
    expect(readPartialCoaching(text.slice(0, cut + 7)).bant?.budget?.status).toBe("pendente")
  })

  it("ignora campos com tipo errado (a resposta parcial não passa pelo zod)", () => {
    const partial = readPartialCoaching(
      JSON.stringify({
        summary: 1,
        strengths: ["ok", 2],
        improvements: [{ messageId: "3", impact: "enorme" }, "x"]
      })
    )
    expect(partial.summary).toBeUndefined()
    expect(partial.strengths).toEqual(["ok"])
    expect(partial.improvements).toEqual([
      {
        messageId: undefined,
        excerpt: undefined,
        issue: undefined,
        suggestion: undefined,
        category: undefined,
        impact: undefined
      }
    ])
  })

  it("nada lido ainda vira relatório vazio", () => {
    expect(readPartialCoaching("")).toEqual({})
    expect(readPartialCoaching("{")).toMatchObject({ summary: undefined, bant: undefined })
  })
})
