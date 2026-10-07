// Relatório de coaching parcial, montado a partir do JSON que ainda está chegando em streaming.
// Fica fora de `schemas.ts` para o side panel não carregar o zod no bundle.

import {
  bantCriteria,
  bantStatuses,
  coachingCategories,
  impactLevels,
  MAX_IMPROVEMENTS,
  MAX_STRENGTHS,
  type BantCriterion,
  type BantStatus,
  type CoachingCategory,
  type ImpactLevel
} from "./constants"
import { parsePartialJson } from "./partial-json"

export interface PartialImprovement {
  messageId?: number
  excerpt?: string
  issue?: string
  suggestion?: string
  category?: CoachingCategory
  impact?: ImpactLevel
}

export interface PartialBantItem {
  status?: BantStatus
  evidence?: string
  question?: string
}

/** Todo `CoachingReport` completo também é um relatório parcial válido. */
export interface PartialCoachingReport {
  summary?: string
  strengths?: string[]
  improvements?: PartialImprovement[]
  bant?: Partial<Record<BantCriterion, PartialBantItem>>
  nextStep?: string
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const text = (value: unknown) => (typeof value === "string" ? value : undefined)

// Um enum só aparece quando chegou inteiro: "pend" ainda não é "pendente".
const oneOf = <T extends string>(options: readonly T[], value: unknown) =>
  options.find((option) => option === value)

const objects = (value: unknown) => (Array.isArray(value) ? value.filter(isObject) : undefined)

const readBantItem = (item: Json): PartialBantItem => ({
  status: oneOf(bantStatuses, item.status),
  evidence: text(item.evidence),
  question: text(item.question)
})

const readImprovement = (item: Json): PartialImprovement => ({
  messageId: typeof item.messageId === "number" ? item.messageId : undefined,
  excerpt: text(item.excerpt),
  issue: text(item.issue),
  suggestion: text(item.suggestion),
  category: oneOf(coachingCategories, item.category),
  impact: oneOf(impactLevels, item.impact)
})

/**
 * Lê o que já chegou do relatório. Nada aqui é validado pelo zod: campos com tipo errado são
 * ignorados, e o relatório definitivo vem do resultado final da análise.
 */
export const readPartialCoaching = (raw: string): PartialCoachingReport => {
  const data = parsePartialJson(raw)
  if (!isObject(data)) return {}
  const bant = isObject(data.bant) ? data.bant : undefined
  return {
    summary: text(data.summary),
    strengths: Array.isArray(data.strengths)
      ? data.strengths.filter((s): s is string => typeof s === "string").slice(0, MAX_STRENGTHS)
      : undefined,
    improvements: objects(data.improvements)?.slice(0, MAX_IMPROVEMENTS).map(readImprovement),
    bant:
      bant &&
      Object.fromEntries(
        bantCriteria.flatMap((c) => (isObject(bant[c]) ? [[c, readBantItem(bant[c] as Json)]] : []))
      ),
    nextStep: text(data.nextStep)
  }
}
