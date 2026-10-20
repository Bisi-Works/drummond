import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ChatMessage } from "~adapters/types"
import { buildPitacoPrompt, SYSTEM_BASE, TASK_PITACO } from "~lib/ai/prompts"
import { limitPitaco, pitacoSchema, toResponseFormat, type Pitaco } from "~lib/ai/schemas"

const conversation: ChatMessage[] = [
  { id: 1, author: "cliente", text: "Oi, quero saber do consórcio de carro." },
  { id: 2, author: "vendedor", text: "Olá! Para que você pretende usar o carro?" },
  {
    id: 3,
    author: "cliente",
    text: "[áudio]",
    audio: true,
    transcript: "Uso para trabalhar com aplicativo e o meu carro está velho."
  },
  { id: 4, author: "cliente", text: "Quanto fica a parcela?" }
]

const stage = (status: "coberta" | "parcial" | "pendente", evidence: string) => ({ status, evidence })

const reply: Pitaco = {
  stages: {
    situacao: stage("coberta", "Usa o carro para aplicativo (#3)."),
    problema: stage("parcial", "Carro velho (#3), sem detalhar o impacto."),
    implicacao: stage("pendente", "Não abordada."),
    necessidade: stage("pendente", "Não abordada.")
  },
  stageNow: "problema",
  diagnosis: "O cliente trouxe o uso e um carro velho, mas pediu preço antes de falar do impacto.",
  path: ["Acolher a pergunta de preço", "Entender o que o carro velho atrapalha hoje"],
  points: [
    {
      stage: "problema",
      kind: "aprofundar",
      title: "O que o carro velho atrapalha",
      why: "Ele citou o carro velho no áudio (#3).",
      hint: "Entender manutenção e dias parados.",
      evidence: [3]
    }
  ],
  questions: [{ stage: "implicacao", text: "Quantos dias o carro ficou parado este mês?", evidence: [3] }],
  avoid: ["Mandar a tabela de parcelas antes de entender o uso"],
  warnings: ["Confirme as condições vigentes antes de falar em valores."]
}

// `config` lê process.env no import, então cada teste recarrega o módulo com o env desejado.
const loadService = async (env: Record<string, string> = {}) => {
  vi.resetModules()
  vi.stubEnv("PLASMO_PUBLIC_OPENROUTER_API_KEY", "sk-test")
  vi.stubEnv("PLASMO_PUBLIC_PITACO_MODEL", "vendor/pitaco-z")
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  return import("~lib/ai/service")
}

const mockModelResponse = (content: unknown) => {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
    url.endsWith("/endpoints")
      ? new Response(JSON.stringify({ data: { endpoints: [] } }))
      : new Response(
          JSON.stringify({
            provider: "Cohere",
            choices: [{ message: { content: JSON.stringify(content) } }],
            usage: { prompt_tokens: 1500, completion_tokens: 600, cost: 0.0003 }
          })
        )
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const modelCalls = (fetchMock: ReturnType<typeof mockModelResponse>) =>
  fetchMock.mock.calls.filter(([url]) => url === "https://openrouter.ai/api/v1/chat/completions")

beforeEach(() => vi.unstubAllEnvs())
afterEach(() => vi.unstubAllGlobals())

describe("pitacoSchema", () => {
  it("as etapas vêm antes da etapa atual e do caminho, e não há campo de mensagem pronta", () => {
    const format = toResponseFormat("pitaco", pitacoSchema, "json_schema")
    if (format.type !== "json_schema") throw new Error("esperava json_schema")
    const properties = format.json_schema.schema.properties as Record<string, unknown>
    expect(Object.keys(properties)).toEqual([
      "stages",
      "stageNow",
      "diagnosis",
      "path",
      "points",
      "questions",
      "avoid",
      "warnings"
    ])
    const json = JSON.stringify(format.json_schema.schema)
    expect(json).not.toMatch(/suggestedText|message"|maxItems|minimum/)
  })

  it("valida a resposta de exemplo e recusa etapa fora do SPIN", () => {
    expect(pitacoSchema.safeParse(reply).success).toBe(true)
    expect(pitacoSchema.safeParse({ ...reply, stageNow: "fechamento" }).success).toBe(false)
  })

  it("limita as listas ao tamanho do drawer", () => {
    const many = <T>(item: T) => Array.from({ length: 9 }, () => item)
    const limited = limitPitaco({
      ...reply,
      path: many("x"),
      points: many(reply.points[0]),
      questions: many(reply.questions[0]),
      avoid: many("x"),
      warnings: many("x")
    })
    expect([
      limited.path.length,
      limited.points.length,
      limited.questions.length,
      limited.avoid.length,
      limited.warnings.length
    ]).toEqual([4, 4, 5, 3, 3])
  })
})

describe("buildPitacoPrompt", () => {
  it("usa a tarefa do Pitaco sobre a conversa inteira, com a transcrição do áudio", () => {
    const prompt = buildPitacoPrompt(conversation)
    expect(prompt.system).toBe(`${SYSTEM_BASE}\n\n${TASK_PITACO}`)
    expect(prompt.user.startsWith("<conversa>\n[1] CLIENTE")).toBe(true)
    expect(prompt.user).toContain("[3] CLIENTE: Uso para trabalhar com aplicativo")
    expect(prompt.user).toContain("[4] CLIENTE: Quanto fica a parcela?")
  })

  it("traz as regras do SPIN e proíbe a mensagem pronta", () => {
    expect(TASK_PITACO).toContain("Nunca escreva a mensagem do vendedor")
    expect(TASK_PITACO).toContain("Não repita perguntas já respondidas")
    expect(TASK_PITACO).toContain("não sugira apresentar solução")
    expect(TASK_PITACO).toContain("pergunta direta do cliente (ex.: preço) nunca fica")
    expect(TASK_PITACO).toContain("acolher com empatia")
    expect(TASK_PITACO).toContain("números [n]")
    // A regra do áudio transcrito é geral (SYSTEM_BASE): a tarefa só lembra de não repetir perguntas.
    expect(TASK_PITACO).toContain("inclusive em áudio transcrito")
    for (const value of ["situacao", "problema", "implicacao", "necessidade", "abertura"]) {
      expect(TASK_PITACO).toContain(`"${value}"`)
    }
  })
})

describe("sanitizePitaco", () => {
  it("tira números inexistentes e descarta o item que só citava mensagens inventadas", async () => {
    const { sanitizePitaco } = await loadService()
    const result = sanitizePitaco(
      {
        ...reply,
        points: [
          { ...reply.points[0], evidence: [3, 3, 42] },
          { ...reply.points[0], title: "Inventado", evidence: [99] },
          { ...reply.points[0], title: "Falta de informação", evidence: [] }
        ],
        questions: [{ ...reply.questions[0], evidence: [77] }]
      },
      conversation
    )
    expect(result.points.map((p) => [p.title, p.evidence])).toEqual([
      ["O que o carro velho atrapalha", [3]],
      ["Falta de informação", []]
    ])
    expect(result.questions).toEqual([])
  })

  it("descarta pergunta que virou mensagem pronta e esvazia a dica longa", async () => {
    const { sanitizePitaco } = await loadService()
    const message = "Olá, Fulano, tudo bem? Entendi que você usa o carro para trabalhar.\nQuantos dias ele ficou parado?"
    const result = sanitizePitaco(
      {
        ...reply,
        points: [{ ...reply.points[0], hint: "x".repeat(161) }],
        questions: [
          { ...reply.questions[0], text: message },
          { ...reply.questions[0], text: "y".repeat(201) },
          { ...reply.questions[0], text: "  " },
          reply.questions[0]
        ]
      },
      conversation
    )
    expect(result.points[0].hint).toBe("")
    expect(result.questions).toEqual([reply.questions[0]])
  })
})

describe("generatePitaco", () => {
  it("envia a tarefa ao modelo do Pitaco com formato, provedores e política de dados", async () => {
    const { generatePitaco } = await loadService()
    const fetchMock = mockModelResponse(reply)

    const result = await generatePitaco(conversation)

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.stageNow).toBe("problema")
    expect(result.meta.model).toBe("vendor/pitaco-z")
    const body = JSON.parse(modelCalls(fetchMock)[0][1]!.body as string)
    expect(body.model).toBe("vendor/pitaco-z")
    expect(body.response_format.json_schema.name).toBe("pitaco")
    expect(body.provider).toEqual({
      require_parameters: true,
      order: ["cohere", "parasail"],
      data_collection: "deny"
    })
    expect(body.messages[0].content).toContain("Tarefa: Pitaco de condução")
    expect(body).not.toHaveProperty("stream")
  })

  it("aceita conversa só com o cliente e só com o vendedor", async () => {
    const { generatePitaco } = await loadService()
    const fetchMock = mockModelResponse({ ...reply, points: [], questions: [] })
    const onlyClient = await generatePitaco([{ id: 1, author: "cliente", text: "Oi" }])
    const onlySeller = await generatePitaco([{ id: 1, author: "vendedor", text: "Olá!", template: true }])
    expect(onlyClient.ok && onlySeller.ok).toBe(true)
    expect(modelCalls(fetchMock)).toHaveLength(2)
  })

  it("não chama a IA sem mensagens do cliente ou do vendedor", async () => {
    const { generatePitaco } = await loadService()
    const fetchMock = mockModelResponse(reply)
    const empty = await generatePitaco([])
    const systemOnly = await generatePitaco([{ id: 1, author: "sistema", text: "Bot parado" }])
    expect(empty).toMatchObject({ ok: false, error: expect.stringContaining("Ainda não há mensagens") })
    expect(systemOnly.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("com PLASMO_PUBLIC_PITACO=off, não chama a IA", async () => {
    const { generatePitaco } = await loadService({ PLASMO_PUBLIC_PITACO: "off" })
    const fetchMock = mockModelResponse(reply)
    const result = await generatePitaco(conversation)
    expect(result).toMatchObject({ ok: false, error: "O Pitaco está desativado nesta build." })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("devolve erro legível quando a resposta vem fora do formato", async () => {
    const { generatePitaco } = await loadService()
    mockModelResponse({ ...reply, stageNow: "fechamento" })
    const result = await generatePitaco(conversation)
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("stageNow") })
  })

  it("custo só no dev", async () => {
    const dev = await loadService({ NODE_ENV: "development" })
    mockModelResponse(reply)
    const devResult = await dev.generatePitaco(conversation)
    expect(devResult.meta.cost?.effective).toMatchObject({ usd: 0.0003, inputTokens: 1500, provider: "Cohere" })

    const prod = await loadService({ NODE_ENV: "production" })
    const fetchMock = mockModelResponse(reply)
    const prodResult = await prod.generatePitaco(conversation)
    expect(prodResult.meta.cost).toBeUndefined()
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/endpoints"))).toBe(false)
  })
})
