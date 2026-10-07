import { describe, expect, it } from "vitest"

import { parsePartialJson } from "~lib/ai/partial-json"

const sample = {
  summary: 'Texto com "aspas", quebra\nde linha, barra \\ e acentuação: ção 😊',
  strengths: ["um", "dois"],
  improvements: [{ messageId: 12, impact: "alto", ok: true, nada: null, nota: -1.5e2 }],
  bant: { budget: { status: "pendente", question: "" } },
  nextStep: "fim"
}

describe("parsePartialJson", () => {
  it("JSON completo é lido como JSON.parse (com ou sem espaços)", () => {
    expect(parsePartialJson(JSON.stringify(sample))).toEqual(sample)
    expect(parsePartialJson(JSON.stringify(sample, null, 2))).toEqual(sample)
  })

  it("todo prefixo é lido sem erro, e o texto parcial é sempre começo do texto final", () => {
    const full = JSON.stringify(sample)
    for (let end = 0; end <= full.length; end++) {
      const partial = parsePartialJson(full.slice(0, end)) as Record<string, unknown> | undefined
      if (typeof partial?.summary === "string") expect(sample.summary.startsWith(partial.summary)).toBe(true)
      if (typeof partial?.nextStep === "string") expect(sample.nextStep.startsWith(partial.nextStep)).toBe(true)
    }
  })

  it("mostra a string em andamento", () => {
    expect(parsePartialJson('{"summary": "A conv')).toEqual({ summary: "A conv" })
    expect(parsePartialJson('{"a": ["um", "do')).toEqual({ a: ["um", "do"] })
  })

  it("descarta números e literais que ainda podem crescer, e chaves sem valor", () => {
    expect(parsePartialJson('{"a": 12')).toEqual({})
    expect(parsePartialJson('{"a": 12,')).toEqual({ a: 12 })
    expect(parsePartialJson('{"a": tr')).toEqual({})
    expect(parsePartialJson('{"a": [1, 2')).toEqual({ a: [1] })
    expect(parsePartialJson('{"a": "x", "b')).toEqual({ a: "x" })
    expect(parsePartialJson('{"a": "x", "b"')).toEqual({ a: "x" })
    expect(parsePartialJson('{"a": "x", "b": ')).toEqual({ a: "x" })
  })

  it("não mostra escapes pela metade", () => {
    expect(parsePartialJson('{"a": "x\\')).toEqual({ a: "x" })
    expect(parsePartialJson('{"a": "x\\u00')).toEqual({ a: "x" })
    expect(parsePartialJson('{"a": "x\\u00e7\\n')).toEqual({ a: "xç\n" })
  })

  it("ignora texto antes do JSON e para no que estiver fora da gramática", () => {
    expect(parsePartialJson('```json\n{"a": {"b": "c')).toEqual({ a: { b: "c" } })
    expect(parsePartialJson('{"a": 1, oops "b": 2}')).toEqual({ a: 1 })
    expect(parsePartialJson("sem json")).toBeUndefined()
  })
})
