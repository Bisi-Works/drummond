// Estimativa e registro de custo das chamadas (só exibidos no `pnpm dev`, ver config.showCosts).
//
// O preço de um mesmo modelo varia muito entre provedores (no DeepSeek v4.1 Flash, 20× na entrada)
// e o OpenRouter escolhe o provedor na hora da chamada, por isso a estimativa é uma FAIXA calculada
// com os provedores que atendem aos nossos requisitos. O custo efetivo vem do `usage.cost` que o
// OpenRouter devolve em toda resposta.

import type { ResponseFormatMode } from "~lib/config"

import type { PromptMessages } from "./prompts"

/** Heurística sem tokenizer: ~3,5 caracteres por token em português (acentos custam mais). */
const CHARS_PER_TOKEN = 3.5

export const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN)

/** Endpoint (provedor) de um modelo, como vem de /api/v1/models/{id}/endpoints. */
export interface ModelEndpoint {
  provider_name: string
  supported_parameters?: string[]
  /** Preços em US$ por token, como string. */
  pricing: { prompt: string; completion: string }
}

export interface PricingRange {
  /** US$ por token. */
  prompt: { min: number; max: number }
  completion: { min: number; max: number }
  providers: number
}

/**
 * Faixa de preço entre os provedores que o OpenRouter pode escolher: com `require_parameters`,
 * só os que suportam o formato de resposta (JSON Schema exige `structured_outputs`) e a
 * temperatura/o raciocínio, quando enviados. A política de dados (`data_collection: deny`) não
 * aparece nessa API, então a faixa pode incluir provedores excluídos.
 */
export const pricingRange = (
  endpoints: ModelEndpoint[],
  {
    responseFormat = "json_schema",
    needsTemperature,
    needsReasoning = false
  }: { responseFormat?: ResponseFormatMode; needsTemperature: boolean; needsReasoning?: boolean }
): PricingRange | null => {
  const required = [
    "response_format",
    ...(responseFormat === "json_schema" ? ["structured_outputs"] : []),
    ...(needsTemperature ? ["temperature"] : []),
    ...(needsReasoning ? ["reasoning"] : [])
  ]
  const eligible = endpoints.filter((e) => required.every((p) => e.supported_parameters?.includes(p)))
  if (eligible.length === 0) return null

  const prompt = eligible.map((e) => Number(e.pricing.prompt))
  const completion = eligible.map((e) => Number(e.pricing.completion))
  return {
    prompt: { min: Math.min(...prompt), max: Math.max(...prompt) },
    completion: { min: Math.min(...completion), max: Math.max(...completion) },
    providers: eligible.length
  }
}

export interface CostEstimate {
  inputTokens: number
  outputTokens: number
  minUsd: number
  maxUsd: number
  providers: number
}

/**
 * Entrada = system + user + JSON Schema (os provedores injetam o schema no prompt).
 * Saída = heurística por tarefa; não inclui tokens de raciocínio de modelos que "pensam".
 */
export const estimateCost = (
  prompt: PromptMessages,
  responseFormat: unknown,
  outputTokens: number,
  range: PricingRange
): CostEstimate => {
  const inputTokens = estimateTokens(prompt.system + prompt.user + JSON.stringify(responseFormat))
  return {
    inputTokens,
    outputTokens,
    minUsd: inputTokens * range.prompt.min + outputTokens * range.completion.min,
    maxUsd: inputTokens * range.prompt.max + outputTokens * range.completion.max,
    providers: range.providers
  }
}

/** Custo efetivo da chamada, a partir do `usage` da resposta do OpenRouter. */
export interface EffectiveCost {
  /** null quando o OpenRouter não informa (ex.: chave BYOK). */
  usd: number | null
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  provider?: string
}

export interface CostInfo {
  /** null quando não deu para buscar os preços. */
  estimate: CostEstimate | null
  /** null quando a chamada falhou antes de haver `usage`. */
  effective: EffectiveCost | null
}

/** "US$ 0,00046", "US$ 0,0118", "US$ 5,89": 2 algarismos significativos abaixo de 1 centavo. */
export const formatUsd = (value: number) => {
  const options: Intl.NumberFormatOptions =
    value >= 1
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : value >= 0.01
        ? { minimumFractionDigits: 2, maximumFractionDigits: 4 }
        : { maximumSignificantDigits: 2 }
  return `US$ ${value.toLocaleString("pt-BR", options)}`
}
