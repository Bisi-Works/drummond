import { describe, expect, it } from "vitest"

import { diffWords, type DiffPart } from "~lib/word-diff"

// Reconstrói os dois lados a partir das partes: o diff não pode perder nem inventar texto.
const sides = (parts: DiffPart[]) => ({
  before: parts.filter((p) => !p.added).map((p) => p.value).join(""),
  after: parts.filter((p) => !p.removed).map((p) => p.value).join("")
})

describe("diffWords", () => {
  it("textos iguais viram uma única parte sem mudança", () => {
    expect(diffWords("Olá, tudo bem?", "Olá, tudo bem?")).toEqual([{ value: "Olá, tudo bem?" }])
  })

  it("marca a palavra trocada como removida + adicionada", () => {
    expect(diffWords("ola, tudo bem?", "Olá, tudo bem?")).toEqual([
      { value: "ola", removed: true },
      { value: "Olá", added: true },
      { value: ", tudo bem?" }
    ])
  })

  it("trata pontuação como token próprio", () => {
    expect(diffWords("Entregamos sim", "Entregamos, sim")).toEqual([
      { value: "Entregamos" },
      { value: ",", added: true },
      { value: " sim" }
    ])
  })

  it("preserva quebras de linha, emojis e formatação do WhatsApp", () => {
    const before = "oi joao 👋\n\n*proposta* em anexo"
    const after = "Oi, João! 👋\n\n*Proposta* em anexo."
    expect(sides(diffWords(before, after))).toEqual({ before, after })
  })

  it("lida com lados vazios", () => {
    expect(diffWords("", "novo texto")).toEqual([{ value: "novo texto", added: true }])
    expect(diffWords("texto", "")).toEqual([{ value: "texto", removed: true }])
  })
})
