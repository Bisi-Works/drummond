import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatMessage } from "~adapters/types"
import type { DraftReview } from "~lib/ai/schemas"

const conversation: ChatMessage[] = [
  { id: 1, author: "cliente", text: "Vocês entregam em SP?" },
  { id: 2, author: "vendedor", text: "Entregamos sim!" }
]

const pendingBant = { status: "pendente", evidence: "Não abordado.", question: "Qual o prazo?" }
const bant = {
  budget: pendingBant,
  authority: { status: "parcial", evidence: "Vai ver com o sócio (#4).", question: "Quem mais decide?" },
  need: { status: "cumprido", evidence: "Precisa de entrega em SP (#1).", question: "" },
  timing: pendingBant
}

// `config` lê process.env no import, então cada teste recarrega o módulo com o env desejado.
const loadService = async (env: Record<string, string> = {}) => {
  vi.resetModules()
  vi.stubEnv("PLASMO_PUBLIC_OPENROUTER_API_KEY", "sk-test")
  vi.stubEnv("PLASMO_PUBLIC_REVIEW_MODEL", "vendor/review-x")
  vi.stubEnv("PLASMO_PUBLIC_COACH_MODEL", "vendor/coach-y")
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  return import("~lib/ai/service")
}

const mockModelResponse = (content: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
      status: 200
    })
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

beforeEach(() => vi.unstubAllEnvs())
afterEach(() => vi.unstubAllGlobals())

describe("normalizeReview", () => {
  const base: DraftReview = { status: "ajustes", suggestedText: "Oi!", changes: [], warnings: [] }

  it("status ok devolve o rascunho original e sem mudanças", async () => {
    const { normalizeReview } = await loadService()
    const review = normalizeReview(
      { ...base, status: "ok", suggestedText: "Oi, tudo bem!", warnings: ["confira o preço"] },
      "oi tudo bem"
    )
    expect(review).toEqual({
      status: "ok",
      suggestedText: "oi tudo bem",
      changes: [],
      warnings: ["confira o preço"]
    })
  })

  it("sugestão idêntica ao original vira ok", async () => {
    const { normalizeReview } = await loadService()
    expect(normalizeReview({ ...base, suggestedText: " Oi! " }, "Oi!").status).toBe("ok")
  })

  it("limita a quantidade de mudanças", async () => {
    const { normalizeReview } = await loadService()
    const changes = Array.from({ length: 9 }, () => ({
      category: "clareza" as const,
      excerpt: "x",
      reason: "y"
    }))
    expect(normalizeReview({ ...base, changes }, "Oi").changes).toHaveLength(5)
  })
})

describe("reviewDraft", () => {
  it("envia modelo, formato e política de dados ao OpenRouter e valida a resposta", async () => {
    const { reviewDraft } = await loadService()
    const fetchMock = mockModelResponse({
      status: "ajustes",
      suggestedText: "Entregamos, sim!",
      changes: [{ category: "gramatica", excerpt: "sim", reason: "Vírgula antes de 'sim'." }],
      warnings: []
    })

    const result = await reviewDraft(conversation, "Entregamos sim!")

    expect(result.ok).toBe(true)
    expect(result.meta.model).toBe("vendor/review-x")
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(init.headers.Authorization).toBe("Bearer sk-test")
    const body = JSON.parse(init.body)
    expect(body.model).toBe("vendor/review-x")
    expect(body.provider).toEqual({
      require_parameters: true,
      order: ["cohere", "parasail"],
      data_collection: "deny"
    })
    expect(body.response_format.json_schema.name).toBe("draft_review")
    expect(body.response_format.json_schema.schema).not.toHaveProperty("$schema")
    // warnings antes de suggestedText: o modelo anota a pergunta sem resposta antes de reescrever.
    expect(Object.keys(body.response_format.json_schema.schema.properties)).toEqual([
      "status",
      "warnings",
      "suggestedText",
      "changes"
    ])
    expect(body).not.toHaveProperty("stream")
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"])
  })

  it("com PLASMO_PUBLIC_REVIEW_RESPONSE_FORMAT=json_object, não envia o schema", async () => {
    const { reviewDraft } = await loadService({ PLASMO_PUBLIC_REVIEW_RESPONSE_FORMAT: "json_object" })
    const fetchMock = mockModelResponse({ status: "ok", suggestedText: "x", changes: [], warnings: [] })
    await reviewDraft(conversation, "x")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toEqual({ type: "json_object" })
  })

  it("respeita PLASMO_PUBLIC_DENY_DATA_COLLECTION=false, mas mantém require_parameters", async () => {
    const { reviewDraft } = await loadService({ PLASMO_PUBLIC_DENY_DATA_COLLECTION: "false" })
    const fetchMock = mockModelResponse({ status: "ok", suggestedText: "x", changes: [], warnings: [] })
    await reviewDraft(conversation, "x")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).provider).toEqual({
      require_parameters: true,
      order: ["cohere", "parasail"]
    })
  })

  it("só envia temperatura quando definida (com require_parameters, enviar à toa gera 404)", async () => {
    const reply = { status: "ok", suggestedText: "x", changes: [], warnings: [] }

    const withTemperature = await loadService({ PLASMO_PUBLIC_REVIEW_TEMPERATURE: "0.7" })
    let fetchMock = mockModelResponse(reply)
    await withTemperature.reviewDraft(conversation, "x")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).temperature).toBe(0.7)

    const withoutTemperature = await loadService({ PLASMO_PUBLIC_REVIEW_TEMPERATURE: "none" })
    fetchMock = mockModelResponse(reply)
    await withoutTemperature.reviewDraft(conversation, "x")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("temperature")
  })

  it("só envia reasoning quando configurado (off desliga, esforço define, default não envia)", async () => {
    const reply = { status: "ok", suggestedText: "x", changes: [], warnings: [] }
    const cases: [string, unknown][] = [
      ["off", { enabled: false }],
      ["low", { effort: "low" }],
      ["default", undefined]
    ]
    for (const [value, expected] of cases) {
      const service = await loadService({ PLASMO_PUBLIC_REVIEW_REASONING: value })
      const fetchMock = mockModelResponse(reply)
      await service.reviewDraft(conversation, "x")
      expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning).toEqual(expected)
    }
  })

  it("explica o 404 de modelo sem provedor compatível", async () => {
    const { reviewDraft } = await loadService({ PLASMO_PUBLIC_REVIEW_TEMPERATURE: "0.3" })
    const detail = "No endpoints found that can handle the requested parameters."
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: detail } }), { status: 404 }))
    )
    const result = await reviewDraft(conversation, "Oi")
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Nenhum provedor do modelo "vendor\/review-x".*temperatura.*No endpoints found/)
    })
  })

  it("não chama a IA com rascunho vazio", async () => {
    const { reviewDraft } = await loadService()
    const fetchMock = mockModelResponse({})
    const result = await reviewDraft(conversation, "   ")
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Digite uma mensagem/) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("traduz erros HTTP para mensagens em português", async () => {
    const { reviewDraft } = await loadService()
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ error: { message: "x" } }), { status: 402 }))
    )
    const result = await reviewDraft(conversation, "Oi")
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Sem créditos/) })
  })

  it("avisa quando a chave não foi configurada na build", async () => {
    const { reviewDraft } = await loadService({ PLASMO_PUBLIC_OPENROUTER_API_KEY: "" })
    const result = await reviewDraft(conversation, "Oi")
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Chave do OpenRouter ausente/)
    })
  })
})

describe("modelo por tarefa", () => {
  it("revisão e coaching usam cada um o seu modelo e parâmetros", async () => {
    const { reviewDraft, coachConversation } = await loadService()
    const reviewFetch = mockModelResponse({ status: "ok", suggestedText: "x", changes: [], warnings: [] })
    const review = await reviewDraft(conversation, "x")
    const coachFetch = mockModelResponse({ summary: "s", strengths: [], improvements: [], bant, nextStep: "n" })
    const coach = await coachConversation(conversation)

    const reviewBody = JSON.parse(reviewFetch.mock.calls[0][1].body)
    const coachBody = JSON.parse(coachFetch.mock.calls[0][1].body)
    expect([review.meta.model, coach.meta.model]).toEqual(["vendor/review-x", "vendor/coach-y"])
    expect([reviewBody.model, coachBody.model]).toEqual(["vendor/review-x", "vendor/coach-y"])
    // Padrões: os dois com temperatura 0.3, sem raciocínio e com JSON Schema.
    expect(reviewBody.temperature).toBe(0.3)
    expect(coachBody.temperature).toBe(0.3)
    expect([reviewBody.reasoning, coachBody.reasoning]).toEqual([{ enabled: false }, { enabled: false }])
    expect(reviewBody.response_format.json_schema.name).toBe("draft_review")
    expect(coachBody.response_format.json_schema.name).toBe("coaching_report")
  })

  it("sem modelo no env, as duas tarefas usam o DeepSeek V4 Flash", async () => {
    const { reviewDraft, coachConversation } = await loadService({
      PLASMO_PUBLIC_REVIEW_MODEL: "",
      PLASMO_PUBLIC_COACH_MODEL: ""
    })
    const reviewFetch = mockModelResponse({ status: "ok", suggestedText: "x", changes: [], warnings: [] })
    await reviewDraft(conversation, "x")
    const coachFetch = mockModelResponse({ summary: "s", strengths: [], improvements: [], bant, nextStep: "n" })
    await coachConversation(conversation)
    const models = [reviewFetch, coachFetch].map((f) => JSON.parse(f.mock.calls[0][1].body).model)
    expect(models).toEqual(["deepseek/deepseek-v4-flash-0731", "deepseek/deepseek-v4-flash-0731"])
  })

  it("ordem de provedores configurável; default deixa o OpenRouter escolher", async () => {
    const reply = { status: "ok", suggestedText: "x", changes: [], warnings: [] }

    const custom = await loadService({ PLASMO_PUBLIC_REVIEW_PROVIDER_ORDER: " together , deepinfra " })
    let fetchMock = mockModelResponse(reply)
    await custom.reviewDraft(conversation, "x")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).provider.order).toEqual(["together", "deepinfra"])

    const openRouterChooses = await loadService({ PLASMO_PUBLIC_REVIEW_PROVIDER_ORDER: "default" })
    fetchMock = mockModelResponse(reply)
    await openRouterChooses.reviewDraft(conversation, "x")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).provider).not.toHaveProperty("order")
  })

  it("aceita modelo e parâmetros do coaching pelo env", async () => {
    const { coachConversation } = await loadService({
      PLASMO_PUBLIC_COACH_MODEL: "vendor/outro",
      PLASMO_PUBLIC_COACH_TEMPERATURE: "0.2",
      PLASMO_PUBLIC_COACH_REASONING: "default",
      PLASMO_PUBLIC_COACH_RESPONSE_FORMAT: "json_object"
    })
    const fetchMock = mockModelResponse({ summary: "s", strengths: [], improvements: [], bant, nextStep: "n" })
    await coachConversation(conversation)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({ model: "vendor/outro", temperature: 0.2, response_format: { type: "json_object" } })
    expect(body).not.toHaveProperty("reasoning")
  })
})

describe("tempo limite", () => {
  // fetch que só termina quando a requisição é abortada pelo tempo limite.
  const hangingFetch = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
          )
      )
    )

  afterEach(() => vi.useRealTimers())

  it("a revisão desiste em 30s; o coaching espera até 90s", async () => {
    vi.useFakeTimers()
    const { reviewDraft, coachConversation } = await loadService()
    hangingFetch()
    let review: unknown
    let coach: unknown
    reviewDraft(conversation, "Oi").then((r) => (review = r))
    coachConversation(conversation).then((r) => (coach = r))

    await vi.advanceTimersByTimeAsync(30_000)
    expect(review).toMatchObject({ ok: false, error: expect.stringMatching(/demorou demais/) })
    expect(coach).toBeUndefined()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(coach).toMatchObject({ ok: false, error: expect.stringMatching(/demorou demais/) })
  })
})

describe("custos (só no dev)", () => {
  const coachReply = { summary: "s", strengths: ["a"], improvements: [], bant, nextStep: "n" }
  const endpoints = [
    { provider_name: "A", supported_parameters: ["response_format", "structured_outputs", "reasoning", "temperature"], pricing: { prompt: "0.0000001", completion: "0.0000004" } },
    { provider_name: "B", supported_parameters: ["response_format", "structured_outputs", "reasoning", "temperature"], pricing: { prompt: "0.0000006", completion: "0.0000024" } }
  ]

  // Roteia: preços do modelo (API pública) × chamada do chat (com `usage`, como o OpenRouter devolve).
  const routeFetch = (content: unknown) => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/endpoints")
        ? new Response(JSON.stringify({ data: { endpoints } }))
        : new Response(
            JSON.stringify({
              provider: "DeepInfra",
              choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
              usage: { prompt_tokens: 1200, completion_tokens: 300, completion_tokens_details: { reasoning_tokens: 40 }, cost: 0.00042 }
            })
          )
    )
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  it("no dev, devolve a faixa estimada e o custo efetivo com tokens e provedor", async () => {
    const { coachConversation } = await loadService({ NODE_ENV: "development" })
    const fetchMock = routeFetch(coachReply)

    const { meta } = await coachConversation(conversation)

    expect(fetchMock.mock.calls.some(([url]) => url === "https://openrouter.ai/api/v1/models/vendor/coach-y/endpoints")).toBe(true)
    expect(meta.cost?.estimate).toMatchObject({ outputTokens: 1000, providers: 2 })
    expect(meta.cost!.estimate!.maxUsd).toBeGreaterThan(meta.cost!.estimate!.minUsd)
    expect(meta.cost?.effective).toEqual({
      usd: 0.00042,
      inputTokens: 1200,
      outputTokens: 300,
      reasoningTokens: 40,
      provider: "DeepInfra"
    })
  })

  it("registra o custo mesmo quando a resposta veio fora do formato (já foi cobrada)", async () => {
    const { coachConversation } = await loadService({ NODE_ENV: "development" })
    routeFetch("isso não é JSON")
    const result = await coachConversation(conversation)
    expect(result.ok).toBe(false)
    expect(result.meta.cost?.effective?.usd).toBe(0.00042)
  })

  it("preço indisponível não derruba a análise", async () => {
    const { coachConversation } = await loadService({ NODE_ENV: "development" })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/endpoints")
          ? new Response("erro", { status: 500 })
          : new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(coachReply) } }] }))
      )
    )
    const result = await coachConversation(conversation)
    expect(result.ok).toBe(true)
    expect(result.meta.cost).toEqual({ estimate: null, effective: null })
  })

  it("fora do dev, não busca preços nem devolve custo", async () => {
    const { coachConversation } = await loadService({ NODE_ENV: "production" })
    const fetchMock = routeFetch(coachReply)
    const { meta } = await coachConversation(conversation)
    expect(meta.cost).toBeUndefined()
    expect(fetchMock.mock.calls.every(([url]) => !url.endsWith("/endpoints"))).toBe(true)
  })
})

describe("coachConversation", () => {
  it("não chama a IA quando não há mensagens do vendedor", async () => {
    const { coachConversation } = await loadService()
    const fetchMock = mockModelResponse({})
    const result = await coachConversation([
      { id: 1, author: "vendedor", text: "Oferta do mês!", template: true },
      { id: 2, author: "cliente", text: "Oi" }
    ])
    expect(result.ok).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    const statuses = result.ok && Object.values(result.data.bant).map((item) => item.status)
    expect(statuses).toEqual(["pendente", "pendente", "pendente", "pendente"])
  })

  it("envia o checklist BANT no schema e devolve a avaliação do modelo", async () => {
    const { coachConversation } = await loadService()
    const fetchMock = mockModelResponse({ summary: "s", strengths: [], improvements: [], bant, nextStep: "n" })
    const result = await coachConversation(conversation)

    const schema = JSON.parse(fetchMock.mock.calls[0][1].body).response_format.json_schema.schema
    expect(schema.required).toContain("bant")
    expect(Object.keys(schema.properties.bant.properties)).toEqual(["budget", "authority", "need", "timing"])
    expect(result.ok && result.data.bant).toEqual(bant)
  })

  it.each([
    ["sem bant", {}],
    ["com status fora do enum", { bant: { ...bant, timing: { ...pendingBant, status: "talvez" } } }]
  ])("rejeita resposta %s", async (_label, override) => {
    const { coachConversation } = await loadService()
    mockModelResponse({ summary: "s", strengths: [], improvements: [], nextStep: "n", ...override })
    const result = await coachConversation(conversation)
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/bant/) })
  })

  it("ordena melhorias por impacto", async () => {
    const { coachConversation } = await loadService()
    const item = { messageId: 2, excerpt: "Entregamos", issue: "y", suggestion: "z", category: "tom" }
    mockModelResponse({
      summary: "s",
      strengths: ["a"],
      improvements: [
        { ...item, impact: "baixo" },
        { ...item, impact: "alto" },
        { ...item, impact: "medio" }
      ],
      bant,
      nextStep: "n"
    })
    const result = await coachConversation(conversation)
    expect(result.ok && result.data.improvements.map((i) => i.impact)).toEqual([
      "alto",
      "medio",
      "baixo"
    ])
  })
})

describe("dropInvalidImprovements", () => {
  const base = { issue: "y", category: "tom", impact: "alto" } as const
  const chat: ChatMessage[] = [
    { id: 1, author: "cliente", text: "Quanto custa?" },
    { id: 2, author: "vendedor", text: "Fala chefe, tudo bem? *Custa 100*." },
    { id: 3, author: "vendedor", text: "[áudio]" },
    { id: 4, author: "vendedor", text: "Oferta do mês", template: true }
  ]
  const report = (improvements: object[]) =>
    ({ summary: "s", strengths: [], improvements, bant, nextStep: "n" }) as never

  it("mantém só melhorias de texto real do vendedor, com trecho existente e sugestão diferente", async () => {
    const { dropInvalidImprovements } = await loadService()
    const result = dropInvalidImprovements(
      report([
        { ...base, messageId: 2, excerpt: "Fala chefe, tudo bem?", suggestion: "Olá, tudo bem?" },
        { ...base, messageId: 2, excerpt: "custa 100", suggestion: "O valor é 100" },
        { ...base, messageId: 2, excerpt: "Fala chefe", suggestion: "fala chefe" },
        { ...base, messageId: 2, excerpt: "texto que não existe", suggestion: "z" },
        { ...base, messageId: 1, excerpt: "Quanto custa?", suggestion: "z" },
        { ...base, messageId: 3, excerpt: "[áudio]", suggestion: "z" },
        { ...base, messageId: 4, excerpt: "Oferta do mês", suggestion: "z" },
        { ...base, messageId: 99, excerpt: "x", suggestion: "z" }
      ]),
      chat
    )
    expect(result.improvements.map((i) => i.suggestion)).toEqual(["Olá, tudo bem?", "O valor é 100"])
  })
})

describe("coaching em streaming", () => {
  const item = { messageId: 2, excerpt: "Entregamos", issue: "y", suggestion: "z", category: "tom" }
  const report = {
    summary: "Conversa cordial.",
    strengths: ["Respondeu rápido."],
    improvements: [
      { ...item, impact: "baixo" },
      { ...item, impact: "alto" }
    ],
    bant,
    nextStep: "Perguntar o prazo."
  }

  const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`
  const chunk = (content: string) => ({ provider: "Fake", choices: [{ delta: { content } }] })

  /** Resposta SSE do OpenRouter, entregue em pedaços de `size` bytes (cortando linhas no meio). */
  const sseResponse = (events: string[], size = 7) => {
    const bytes = new TextEncoder().encode(events.join(""))
    return new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size))
          controller.close()
        }
      }),
      { headers: { "Content-Type": "text/event-stream" } }
    )
  }

  const streamOf = (content: string, pieces = 6) => {
    const size = Math.ceil(content.length / pieces)
    const parts = Array.from({ length: pieces }, (_, i) => content.slice(i * size, (i + 1) * size))
    return [
      ": OPENROUTER PROCESSING\n\n",
      ...parts.map((part) => event(chunk(part))),
      event({ ...chunk(""), usage: { prompt_tokens: 900, completion_tokens: 250, cost: 0.0002 } }),
      "data: [DONE]\n\n"
    ]
  }

  it("repassa os trechos na ordem e devolve o relatório validado, com o custo do último evento", async () => {
    const { coachConversation } = await loadService({ NODE_ENV: "development" })
    const content = JSON.stringify(report)
    const requests: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/endpoints")) return new Response(JSON.stringify({ data: { endpoints: [] } }))
        requests.push(JSON.parse(init!.body as string))
        return sseResponse(streamOf(content))
      })
    )

    const deltas: string[] = []
    const result = await coachConversation(conversation, { onDelta: (text) => deltas.push(text) })

    expect(requests).toMatchObject([{ stream: true }])
    expect(deltas.length).toBeGreaterThan(1)
    expect(deltas.join("")).toBe(content)
    expect(result.ok && result.data.improvements.map((i) => i.impact)).toEqual(["alto", "baixo"])
    expect(result.meta.cost?.effective).toMatchObject({ usd: 0.0002, inputTokens: 900, provider: "Fake" })
  })

  it("erro do provedor no meio do streaming vira mensagem de erro", async () => {
    const { coachConversation } = await loadService()
    const events = [
      event(chunk('{"summary": "Conv')),
      event({ ...chunk(""), error: { code: 502, message: "Provider disconnected" } })
    ]
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)))
    const result = await coachConversation(conversation, { onDelta: () => {} })
    expect(result).toMatchObject({ ok: false, error: "Erro do provedor: Provider disconnected" })
  })

  it("resposta cortada (JSON incompleto) falha na validação final", async () => {
    const { coachConversation } = await loadService()
    const partial = JSON.stringify(report).slice(0, 80)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([event(chunk(partial)), "data: [DONE]\n\n"])))
    const result = await coachConversation(conversation, { onDelta: () => {} })
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) })
  })

  it("cancelar pelo signal aborta a chamada", async () => {
    const { coachConversation } = await loadService()
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
          )
      )
    )
    const controller = new AbortController()
    const pending = coachConversation(conversation, { onDelta: () => {}, signal: controller.signal })
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, error: "Análise cancelada." })
  })
})
