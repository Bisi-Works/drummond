import { describe, expect, it } from "vitest"

import { extractJsonObject, ParseError, parseModelJson } from "~lib/ai/parse"
import { draftReviewSchema } from "~lib/ai/schemas"

const valid = {
  status: "ajustes",
  suggestedText: "Olá, tudo bem?",
  changes: [{ category: "ortografia", excerpt: "Olá", reason: "Acento." }],
  warnings: []
}

describe("extractJsonObject", () => {
  it("extrai JSON puro", () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}')
  })

  it("remove cercas de código e texto em volta", () => {
    const raw = 'Claro! Aqui está:\n```json\n{"a": {"b": 2}}\n```\nQualquer coisa, avise.'
    expect(JSON.parse(extractJsonObject(raw)!)).toEqual({ a: { b: 2 } })
  })

  it("ignora chaves e aspas escapadas dentro de strings", () => {
    const raw = '{"t": "use {nome} e \\"aspas\\" }"} lixo }'
    expect(JSON.parse(extractJsonObject(raw)!)).toEqual({ t: 'use {nome} e "aspas" }' })
  })

  it("retorna null sem objeto ou com objeto incompleto", () => {
    expect(extractJsonObject("sem json aqui")).toBeNull()
    expect(extractJsonObject('{"a": 1')).toBeNull()
  })
})

describe("parseModelJson", () => {
  it("valida contra o schema", () => {
    expect(parseModelJson(JSON.stringify(valid), draftReviewSchema)).toEqual(valid)
  })

  it("falha com ParseError quando não há JSON", () => {
    expect(() => parseModelJson("desculpe, não posso", draftReviewSchema)).toThrow(ParseError)
  })

  it("falha com ParseError em JSON inválido", () => {
    expect(() => parseModelJson("{status: ok}", draftReviewSchema)).toThrow(/JSON inválido/)
  })

  it("aponta os campos fora do formato", () => {
    const wrong = { ...valid, status: "talvez", warnings: undefined }
    expect(() => parseModelJson(JSON.stringify(wrong), draftReviewSchema)).toThrow(
      /status.*warnings|warnings.*status/
    )
  })
})
