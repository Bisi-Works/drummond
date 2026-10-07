// Constantes compartilhadas entre prompts, schemas e UI. Ficam fora de `schemas.ts` para que o
// content script (que importa os prompts) não carregue o zod no bundle.

export const MAX_CHANGES = 5
export const MAX_IMPROVEMENTS = 5
export const MAX_STRENGTHS = 3

export const changeCategories = [
  "ortografia",
  "gramatica",
  "clareza",
  "tom",
  "contexto",
  "comercial"
] as const

export const coachingCategories = ["escrita", "clareza", "escuta", "tom", "conducao"] as const

export const impactLevels = ["alto", "medio", "baixo"] as const

// Qualificação do lead no coaching: Budget, Authority, Need, Timing — nesta ordem na UI.
export const bantCriteria = ["budget", "authority", "need", "timing"] as const
export const bantStatuses = ["cumprido", "parcial", "pendente"] as const

export type ChangeCategory = (typeof changeCategories)[number]
export type CoachingCategory = (typeof coachingCategories)[number]
export type ImpactLevel = (typeof impactLevels)[number]
export type BantCriterion = (typeof bantCriteria)[number]
export type BantStatus = (typeof bantStatuses)[number]
