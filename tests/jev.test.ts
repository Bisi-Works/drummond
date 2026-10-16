import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { buildClosingRequest, buildClosingState, classifyClosing, parseClosingAnswer } from "~lib/ai/jev"

const KEY = "sk-or-v1-chave-de-teste"

const answer = (pNoReply: number, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      model: "typesafe/jev-1.13-20260917",
      answers: {
        reply: {
          type: "choice",
          choice: pNoReply >= 0.5 ? "nao_precisa_resposta" : "precisa_resposta",
          confidence: 1,
          probabilities: { nao_precisa_resposta: pNoReply, precisa_resposta: 1 - pNoReply }
        }
      },
      usage: { input_tokens: 410, output_tokens: 44, cost: 0.0000172 },
      ...extra
    })
  )

beforeEach(() => {
  process.env.PLASMO_PUBLIC_OPENROUTER_API_KEY = KEY
})
afterEach(() => {
  delete process.env.PLASMO_PUBLIC_OPENROUTER_API_KEY
})

describe("buildClosingRequest", () => {
  it("manda a mensagem do cliente com a anterior do vendedor, na ordem da conversa", () => {
    expect(buildClosingState({ previous: "Posso te ligar?", text: "ok" })).toEqual({
      conversa: [
        { de: "vendedor", texto: "Posso te ligar?" },
        { de: "cliente", texto: "ok" }
      ]
    })
    expect(buildClosingState({ text: "Obrigado" })).toEqual({ conversa: [{ de: "cliente", texto: "Obrigado" }] })
  })

  it("corta textos longos e proíbe provedor que retém ou treina com os dados", () => {
    const request = buildClosingRequest({ previous: "p".repeat(900), text: "t".repeat(900) }, "typesafe/jev-1.13")
    expect(request.state.conversa.every((m) => m.texto.length === 300)).toBe(true)
    expect(request.provider).toEqual({ data_collection: "deny" })
    expect(request.model).toBe("typesafe/jev-1.13")
  })

  it("pergunta com a opção que dispensa a conversa primeiro (variante vencedora do benchmark)", () => {
    const { reply } = buildClosingRequest({ text: "x" }).questions
    expect(reply.type).toBe("choice")
    expect(Object.keys(reply.criteria)).toEqual(["nao_precisa_resposta", "precisa_resposta"])
  })
})

describe("parseClosingAnswer", () => {
  it("lê P(não precisa de resposta) e rejeita o que não faz sentido", () => {
    const body = (probabilities: unknown) => ({ answers: { reply: { probabilities } } })
    expect(parseClosingAnswer(body({ nao_precisa_resposta: 0.97 }))).toBe(0.97)
    expect(parseClosingAnswer(body({ nao_precisa_resposta: 1.2 }))).toBeNull()
    expect(parseClosingAnswer(body({ nao_precisa_resposta: "0.9" }))).toBeNull()
    expect(parseClosingAnswer(body({}))).toBeNull()
    expect(parseClosingAnswer(null)).toBeNull()
    expect(parseClosingAnswer({ answers: {} })).toBeNull()
  })
})

describe("classifyClosing", () => {
  it("dispensa só quando a probabilidade chega ao limiar (0,95 por padrão)", async () => {
    const confident = await classifyClosing({ text: "Obrigado!" }, { fetch: async () => answer(0.97) })
    expect(confident).toMatchObject({ ok: true, closing: true, pNoReply: 0.97, cost: 0.0000172 })

    const unsure = await classifyClosing({ text: "ok" }, { fetch: async () => answer(0.9) })
    expect(unsure).toMatchObject({ ok: true, closing: false, pNoReply: 0.9 })
  })

  it("chama a Decisions API com a chave do OpenRouter e o corpo esperado", async () => {
    const fetchSpy = vi.fn(async () => answer(1))
    await classifyClosing({ previous: "Posso enviar?", text: "Pode" }, { fetch: fetchSpy as unknown as typeof fetch })

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions")
    expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer ${KEY}`)
    const body = JSON.parse(String(init.body))
    expect(body.state.conversa).toHaveLength(2)
    expect(body.questions.reply.type).toBe("choice")
  })

  it("nunca devolve a chave nem lança: falhas viram { ok: false }", async () => {
    const cases: [string, typeof fetch][] = [
      ["HTTP 500", async () => new Response("erro", { status: 500 })],
      ["HTTP 402", async () => new Response("{}", { status: 402 })],
      ["rede", async () => Promise.reject(new TypeError("offline"))],
      ["formato", async () => new Response(JSON.stringify({ answers: {} }))],
      ["não JSON", async () => new Response("<html>")],
      [
        "timeout",
        async () => {
          throw Object.assign(new Error("timeout"), { name: "TimeoutError" })
        }
      ]
    ]
    for (const [, fetchImpl] of cases) {
      const result = await classifyClosing({ text: "Obrigado" }, { fetch: fetchImpl })
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain(KEY)
    }
  })

  it("explica a falta da chave e não faz chamada sem ela", async () => {
    delete process.env.PLASMO_PUBLIC_OPENROUTER_API_KEY
    const fetchSpy = vi.fn()
    const result = await classifyClosing({ text: "Obrigado" }, { fetch: fetchSpy as unknown as typeof fetch })
    expect(result).toMatchObject({ ok: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("não chama a API para mensagem vazia", async () => {
    const fetchSpy = vi.fn()
    expect(await classifyClosing({ text: "   " }, { fetch: fetchSpy as unknown as typeof fetch })).toMatchObject({ ok: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
