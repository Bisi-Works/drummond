// Constantes compartilhadas entre prompts, schemas e UI. Ficam fora de `schemas.ts` para que o
// content script (que importa os prompts) não carregue o zod no bundle.

export const MAX_CHANGES = 5
export const MAX_IMPROVEMENTS = 5
export const MAX_STRENGTHS = 3
// O relatório diário roda uma vez por dia sobre o resumo do tracking: cada lista fica curta para
// caber no widget/painel e para o custo da chamada não crescer com o número de conversas.
export const MAX_REPORT_ITEMS = 5

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

// Seções do relatório diário, nesta ordem na UI. "pendencias" é o que ficou em aberto para amanhã.
export const reportSections = ["acertos", "erros", "melhorias", "pendencias"] as const

// Qualificação do lead no coaching: Budget, Authority, Need, Timing — nesta ordem na UI.
export const bantCriteria = ["budget", "authority", "need", "timing"] as const
export const bantStatuses = ["cumprido", "parcial", "pendente"] as const

// Pitaco: orientação de condução pelo SPIN Selling — Situação, Problema, Implicação, Necessidade
// (de solução), nesta ordem na UI. "abertura" é a conversa que ainda não começou a descoberta.
export const spinStages = ["situacao", "problema", "implicacao", "necessidade"] as const
export const pitacoStages = ["abertura", ...spinStages] as const
export const spinStatuses = ["coberta", "parcial", "pendente"] as const
// O que cada ponto pede do vendedor: descobrir algo novo, aprofundar o que o cliente já disse,
// confirmar um entendimento, tratar uma objeção ou avançar para o próximo passo.
export const pitacoPointKinds = ["descobrir", "aprofundar", "confirmar", "objecao", "avancar"] as const

// Listas curtas para caber no drawer e para o vendedor ler antes de responder.
export const MAX_PITACO_PATH = 4
export const MAX_PITACO_POINTS = 4
export const MAX_PITACO_QUESTIONS = 5
export const MAX_PITACO_AVOID = 3
export const MAX_PITACO_WARNINGS = 3
// Resumo da visão simples: o que fazer e o que não fazer agora.
export const MAX_PITACO_DO = 4
/** Tópico do resumo acima disso (ou com quebra de linha) virou parágrafo: é descartado. */
export const MAX_PITACO_TOPIC_CHARS = 160
/** Pergunta maior que isso deixa de ser pergunta e vira mensagem pronta: é descartada. */
export const MAX_PITACO_QUESTION_CHARS = 200
/** A dica é direção de raciocínio; acima disso (ou com quebra de linha) ela é descartada. */
export const MAX_PITACO_HINT_CHARS = 160

export type ChangeCategory = (typeof changeCategories)[number]
export type CoachingCategory = (typeof coachingCategories)[number]
export type ImpactLevel = (typeof impactLevels)[number]
export type ReportSection = (typeof reportSections)[number]
export type BantCriterion = (typeof bantCriteria)[number]
export type BantStatus = (typeof bantStatuses)[number]
export type SpinStage = (typeof spinStages)[number]
export type PitacoStage = (typeof pitacoStages)[number]
export type SpinStatus = (typeof spinStatuses)[number]
export type PitacoPointKind = (typeof pitacoPointKinds)[number]
