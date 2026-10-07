import type { ChatMessage } from "~adapters/types"
import { config, type ModelConfig } from "~lib/config"
import type { DailyReportInput } from "~lib/tracking/report"

import { estimateCost, estimateTokens, pricingRange, type CostEstimate, type CostInfo } from "./cost"
import { chatCompletion, fetchModelEndpoints, OpenRouterError } from "./openrouter"
import { parseModelJson } from "./parse"
import {
  buildCoachPrompt,
  buildDailyReportPrompt,
  buildReviewPrompt,
  PROMPT_VERSION,
  type PromptMessages
} from "./prompts"
import {
  coachingReportSchema,
  dailyReportSchema,
  draftReviewSchema,
  limitCoaching,
  limitDailyReport,
  limitReview,
  toResponseFormat,
  type BantItem,
  type CoachingReport,
  type DailyReport,
  type DraftReview
} from "./schemas"

export interface AiMeta {
  model: string
  promptVersion: string
  durationMs: number
  /** Só no `pnpm dev` (config.showCosts) e quando houve chamada ao modelo. */
  cost?: CostInfo
}

// Resultado serializável — atravessa o messaging entre background, content script e side panel.
export type AiResult<T> = ({ ok: true; data: T } | { ok: false; error: string }) & { meta: AiMeta }

interface RunContext {
  cost?: CostInfo
}

export interface StreamOptions {
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

const run = async <T>(
  task: ModelConfig,
  fn: (ctx: RunContext) => Promise<T>
): Promise<AiResult<T>> => {
  const startedAt = Date.now()
  const ctx: RunContext = {}
  const meta = (): AiMeta => ({
    model: task.model,
    promptVersion: PROMPT_VERSION,
    durationMs: Date.now() - startedAt,
    ...(ctx.cost && { cost: ctx.cost })
  })
  try {
    return { ok: true, data: await fn(ctx), meta: meta() }
  } catch (error) {
    console.error("[drummond]", error)
    const message = error instanceof Error ? error.message : "Erro inesperado."
    return { ok: false, error: message, meta: meta() }
  }
}

const estimate = async (
  task: ModelConfig,
  prompt: PromptMessages,
  responseFormat: unknown,
  outputTokens: number
): Promise<CostEstimate | null> => {
  try {
    const range = pricingRange(await fetchModelEndpoints(task.model), {
      responseFormat: task.responseFormat,
      needsTemperature: task.temperature !== undefined,
      needsReasoning: task.reasoning !== undefined
    })
    return range ? estimateCost(prompt, responseFormat, outputTokens, range) : null
  } catch {
    return null // preço é informativo: nunca derruba a análise
  }
}

/**
 * Chama o modelo e, no dev, registra o custo no contexto: a estimativa roda em paralelo com a
 * chamada (não atrasa a resposta) e o efetivo vem do `usage` — inclusive quando a chamada falha
 * depois de cobrada (resposta vazia, JSON fora do formato).
 */
const complete = async (
  ctx: RunContext,
  task: ModelConfig,
  prompt: PromptMessages,
  responseFormat: ReturnType<typeof toResponseFormat>,
  expectedOutputTokens: number,
  stream: StreamOptions = {}
) => {
  const estimated = config.showCosts
    ? estimate(task, prompt, responseFormat, expectedOutputTokens)
    : null
  try {
    const { content, effective } = await chatCompletion({ prompt, responseFormat, task, ...stream })
    if (estimated) ctx.cost = { estimate: await estimated, effective }
    return content
  } catch (error) {
    if (estimated) {
      const effective = error instanceof OpenRouterError ? (error.effective ?? null) : null
      ctx.cost = { estimate: await estimated, effective }
    }
    throw error
  }
}

// Heurísticas de saída para a estimativa: o texto revisado tem ~o tamanho do rascunho, mais
// mudanças/alertas; o coaching é limitado a 5 melhorias + resumo + BANT + próximo passo; o
// relatório tem o resumo do dia + 4 listas de até 5 itens (por isso ~1200 tokens).
const REVIEW_OVERHEAD_TOKENS = 150
const COACHING_OUTPUT_TOKENS = 1000
const REPORT_OUTPUT_TOKENS = 1200

const reviewFormat = toResponseFormat("draft_review", draftReviewSchema, config.review.responseFormat)
const coachingFormat = toResponseFormat(
  "coaching_report",
  coachingReportSchema,
  config.coach.responseFormat
)
const reportFormat = toResponseFormat("daily_report", dailyReportSchema, config.report.responseFormat)

// Garante coerência entre status e texto: "ok" nunca altera o rascunho, e uma sugestão idêntica ao
// original é tratada como "ok" (alguns modelos marcam "ajustes" sem mudar nada).
export const normalizeReview = (review: DraftReview, draft: string): DraftReview => {
  const limited = limitReview(review)
  const unchanged = limited.suggestedText.trim() === draft.trim()
  if (limited.status === "ok" || unchanged) {
    return { ...limited, status: "ok", suggestedText: draft, changes: [] }
  }
  return limited
}

// Comparação tolerante: sem acentos, caixa, pontuação e formatação do WhatsApp.
const squash = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")

/**
 * Descarta melhorias que o modelo alucinou: de mensagem que não é texto livre do vendedor, com
 * trecho que não está na mensagem (inclui marcadores como "[áudio]") ou com sugestão igual ao
 * original. São elas que geram alertas sem sentido no painel.
 */
export const dropInvalidImprovements = (
  report: CoachingReport,
  conversation: ChatMessage[]
): CoachingReport => ({
  ...report,
  improvements: report.improvements.filter((item) => {
    const message = conversation.find((m) => m.id === item.messageId)
    if (!message || message.author !== "vendedor" || message.template) return false
    if (/^\[[^\]]*\]$/.test(message.text.trim())) return false // só anexo ([áudio], [arquivo: …])
    const excerpt = squash(item.excerpt)
    if (!excerpt || !squash(message.text).includes(excerpt)) return false
    return squash(item.suggestion) !== excerpt
  })
})

export const reviewDraft =(conversation: ChatMessage[], draft: string) =>
  run(config.review, async (ctx) => {
    if (!draft.trim()) throw new Error("Digite uma mensagem antes de pedir a revisão.")
    const prompt = buildReviewPrompt(conversation, draft, config.contextMessages)
    const expectedOutput = estimateTokens(draft) + REVIEW_OVERHEAD_TOKENS
    const raw = await complete(ctx, config.review, prompt, reviewFormat, expectedOutput)
    return normalizeReview(parseModelJson(raw, draftReviewSchema), draft)
  })

/**
 * Com `onDelta`, o JSON do relatório chega aos pedaços enquanto o modelo escreve (o side panel
 * mostra o relatório parcial). O resultado final é o mesmo da chamada sem streaming: validado.
 */
export const coachConversation = (conversation: ChatMessage[], stream: StreamOptions = {}) =>
  run(config.coach, async (ctx): Promise<CoachingReport> => {
    // Sem texto escrito pelo vendedor (templates não contam) não há o que avaliar — evita uma
    // chamada paga à toa.
    if (!conversation.some((m) => m.author === "vendedor" && !m.template)) {
      const pending: BantItem = { status: "pendente", evidence: "Ainda não abordado.", question: "" }
      return {
        summary: "Ainda não há mensagens do vendedor nesta conversa para analisar.",
        strengths: [],
        improvements: [],
        bant: { budget: pending, authority: pending, need: pending, timing: pending },
        nextStep: "Envie a primeira mensagem e analise novamente."
      }
    }
    const raw = await complete(
      ctx,
      config.coach,
      buildCoachPrompt(conversation),
      coachingFormat,
      COACHING_OUTPUT_TOKENS,
      stream
    )
    return limitCoaching(
      dropInvalidImprovements(parseModelJson(raw, coachingReportSchema), conversation)
    )
  })

/**
 * Relatório do dia: uma única chamada sobre o resumo do tracking (nunca as conversas completas),
 * sem streaming — roda uma vez por dia no background. `buildReportInput` já descarta as conversas
 * sem nenhuma mensagem, então uma lista vazia significa que não há o que avaliar: devolve um
 * relatório coerente sem chamar (nem pagar) o modelo, como o `coachConversation` sem mensagens do
 * vendedor.
 */
export const generateDailyReport = (input: DailyReportInput) =>
  run(config.report, async (ctx): Promise<DailyReport> => {
    if (input.conversations.length === 0) {
      return {
        resumo: "Nenhuma conversa com mensagens foi acompanhada neste dia.",
        acertos: [],
        erros: [],
        melhorias: [],
        pendencias: []
      }
    }
    const raw = await complete(
      ctx,
      config.report,
      buildDailyReportPrompt(input),
      reportFormat,
      REPORT_OUTPUT_TOKENS
    )
    return limitDailyReport(parseModelJson(raw, dailyReportSchema))
  })
