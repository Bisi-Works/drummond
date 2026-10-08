// Configuração lida em tempo de build. O Plasmo só injeta variáveis com prefixo PLASMO_PUBLIC_,
// e só quando são acessadas literalmente como `process.env.NOME` — por isso nada de acesso dinâmico.
//
// A chave do OpenRouter NÃO fica aqui: este módulo é importado pelo content script e pelo side
// panel. Ela é lida só em `lib/ai/openrouter.ts`, que roda apenas no background.

const toNumber = (value: string | undefined): number | undefined => {
  const parsed = Number(value)
  return value?.trim() && Number.isFinite(parsed) ? parsed : undefined
}

const reasoningEfforts = ["minimal", "low", "medium", "high"] as const

export type Reasoning = { enabled: false } | { effort: (typeof reasoningEfforts)[number] }

// "off" desliga o raciocínio; um esforço o define; qualquer outro valor ("default") não envia nada.
const toReasoning = (value: string): Reasoning | undefined => {
  const normalized = value.trim().toLowerCase()
  if (normalized === "off") return { enabled: false }
  const effort = reasoningEfforts.find((e) => e === normalized)
  return effort ? { effort } : undefined
}

/**
 * - `json_schema`: o provedor restringe a saída ao JSON Schema (structured outputs). Preferível.
 * - `json_object`: o provedor só garante um JSON válido; o formato vem do prompt e o zod valida.
 *   Para modelos sem provedor com structured outputs (ex.: Ling 3.0 Flash).
 */
export type ResponseFormatMode = "json_schema" | "json_object"

const toResponseFormatMode = (value: string): ResponseFormatMode =>
  value.trim().toLowerCase() === "json_object" ? "json_object" : "json_schema"

// Lista de provedores separada por vírgula; "default" (ou vazio) deixa o OpenRouter escolher.
const toProviderOrder = (value: string): string[] | undefined => {
  const providers = value.split(",").map((p) => p.trim()).filter(Boolean)
  return providers.length === 0 || providers[0].toLowerCase() === "default" ? undefined : providers
}

/** Modelo e parâmetros de uma tarefa. Cada tarefa tem os seus porque o que um modelo aceita varia. */
export interface ModelConfig {
  model: string
  /**
   * Opcional: "none" = não envia. Como as requisições usam `require_parameters`, mandar
   * temperatura para um modelo que não aceita deixa o modelo sem provedor e a chamada falha com 404.
   * Use "none" e não vazio: o Plasmo ignora valores vazios e cairia no valor padrão.
   */
  temperature?: number
  /**
   * Raciocínio ("thinking") antes da resposta: "off", "minimal" | "low" | "medium" | "high", ou
   * "default" = não envia. Modelos como o DeepSeek V4 raciocinam em esforço alto por padrão:
   * milhares de tokens invisíveis que levam o coaching de ~25s para mais de 100s. Mesma ressalva da
   * temperatura: com `require_parameters`, só envie para modelos que aceitam `reasoning`.
   */
  reasoning?: Reasoning
  responseFormat: ResponseFormatMode
  /**
   * Provedores a tentar primeiro, em ordem (`provider.order`); se falharem, o OpenRouter segue
   * para os demais. Sem isso, ele prioriza os mais baratos, que podem estar degradados: no
   * DeepSeek V4 Flash, a revisão levava de 8 a 24s (e às vezes estourava o limite de 30s), contra
   * ~1,3s no Cohere (medido em 30/09/2026; ver README).
   */
  providerOrder?: string[]
  timeoutMs: number
}

/** Revisão do rascunho: roda a cada mensagem, então precisa ser rápida e barata (~1–3s). */
const review: ModelConfig = {
  model: process.env.PLASMO_PUBLIC_REVIEW_MODEL || "deepseek/deepseek-v4-flash-0731",
  temperature: toNumber(process.env.PLASMO_PUBLIC_REVIEW_TEMPERATURE ?? "0.3"),
  reasoning: toReasoning(process.env.PLASMO_PUBLIC_REVIEW_REASONING ?? "off"),
  responseFormat: toResponseFormatMode(process.env.PLASMO_PUBLIC_REVIEW_RESPONSE_FORMAT ?? "json_schema"),
  providerOrder: toProviderOrder(process.env.PLASMO_PUBLIC_REVIEW_PROVIDER_ORDER ?? "cohere,parasail"),
  timeoutMs: 30_000
}

/** Coaching da conversa: mais raro e mais exigente. Gera ~1000 tokens, em streaming. */
const coach: ModelConfig = {
  model: process.env.PLASMO_PUBLIC_COACH_MODEL || "deepseek/deepseek-v4-flash-0731",
  temperature: toNumber(process.env.PLASMO_PUBLIC_COACH_TEMPERATURE ?? "0.3"),
  reasoning: toReasoning(process.env.PLASMO_PUBLIC_COACH_REASONING ?? "off"),
  responseFormat: toResponseFormatMode(process.env.PLASMO_PUBLIC_COACH_RESPONSE_FORMAT ?? "json_schema"),
  providerOrder: toProviderOrder(process.env.PLASMO_PUBLIC_COACH_PROVIDER_ORDER ?? "cohere,parasail"),
  timeoutMs: 90_000
}

/** Relatório diário: roda uma vez por dia, então pode ser mais caro e demorar mais que a revisão. */
const report: ModelConfig = {
  model: process.env.PLASMO_PUBLIC_REPORT_MODEL || "deepseek/deepseek-v4-flash-0731",
  temperature: toNumber(process.env.PLASMO_PUBLIC_REPORT_TEMPERATURE ?? "0.3"),
  reasoning: toReasoning(process.env.PLASMO_PUBLIC_REPORT_REASONING ?? "off"),
  responseFormat: toResponseFormatMode(process.env.PLASMO_PUBLIC_REPORT_RESPONSE_FORMAT ?? "json_schema"),
  providerOrder: toProviderOrder(process.env.PLASMO_PUBLIC_REPORT_PROVIDER_ORDER ?? "cohere,parasail"),
  timeoutMs: 90_000
}

/**
 * Decisão "o cliente só encerrou a conversa?" (ver `lib/ai/jev.ts`): roda depois da regra de texto,
 * só para mensagens curtas que ela não resolve. Falha ou dúvida = a conversa continua aguardando.
 */
const closing = {
  /** `PLASMO_PUBLIC_CLOSING_AI=off` desliga a IA e deixa só a regra de texto. */
  enabled: process.env.PLASMO_PUBLIC_CLOSING_AI !== "off",
  model: process.env.PLASMO_PUBLIC_CLOSING_MODEL || "typesafe/jev-1.13",
  /** Só dispensa a conversa quando P(não precisa de resposta) chega a este valor (0,5 a 0,999). */
  threshold: Math.min(0.999, Math.max(0.5, toNumber(process.env.PLASMO_PUBLIC_CLOSING_THRESHOLD) ?? 0.95)),
  timeoutMs: 8_000
}

export const config = {
  review,
  coach,
  report,
  closing,
  contextMessages: toNumber(process.env.PLASMO_PUBLIC_CONTEXT_MESSAGES) ?? 20,
  /** O coaching olha a conversa inteira carregada na tela, até este limite. */
  coachMessages: 80,
  denyDataCollection: process.env.PLASMO_PUBLIC_DENY_DATA_COLLECTION !== "false",
  /** De quanto em quanto tempo a inbox é relida (só com a aba visível). */
  inboxPollMs: toNumber(process.env.PLASMO_PUBLIC_INBOX_POLL_MS) ?? 60_000,
  /**
   * Só para teste: lista os chats de outro membro da equipe (`user_id_filter`) em vez de "meus
   * chats". Serve a quem testa com uma conta de gestor, que não tem chats atribuídos.
   */
  inboxUserId: toNumber(process.env.PLASMO_PUBLIC_INBOX_USER_ID),
  /**
   * Quantos relatórios por dia o vendedor pode gerar em produção (ver `canGenerateReport`).
   * Padrão 1: um relatório por dia, que é o custo previsto do recurso.
   */
  reportLimitPerDay: toNumber(process.env.PLASMO_PUBLIC_REPORT_LIMIT_PER_DAY) ?? 1,
  /**
   * Libera a trava diária. `true` por padrão no `pnpm dev` (para repetir os testes sem consumir a
   * cota) ou quando `PLASMO_PUBLIC_REPORT_UNLIMITED=true` — que só deve existir numa build de
   * homologação, nunca na de produção dos vendedores.
   */
  reportUnlimited:
    process.env.NODE_ENV === "development" ||
    process.env.PLASMO_PUBLIC_REPORT_UNLIMITED === "true",
  /** Custo estimado/efetivo das análises: só no `pnpm dev` (NODE_ENV vem do Parcel/Plasmo). */
  showCosts: process.env.NODE_ENV === "development"
} as const
