import type { CoachingReport, DraftReview } from "~lib/ai/schemas"

import type { TrackedCoachingSignal, TrackedReviewSignal } from "./types"

// Derivação pura dos sinais de IA que a extensão já produz (revisão de rascunho e coaching) para o
// formato anexado à conversa do dia. Nenhuma chamada de modelo nasce aqui: estas funções apenas
// reorganizam uma resposta que o vendedor já pediu, para o widget e os alertas terem o que mostrar.

/** Tamanho máximo do resumo guardado no dia (o widget exibe um trecho em uma linha só). */
const SUMMARY_MAX = 140

/** Colapsa para a primeira linha, junta espaços repetidos e corta o que passar do limite. */
const short = (text: string): string => {
  const line = text.trim().split("\n")[0].replace(/\s+/g, " ")
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line
}

/**
 * Resumo curto da revisão para o widget: quantas alterações foram feitas e por quê (o motivo da
 * primeira delas) ou, quando o texto ficou como estava, o primeiro aviso. Nunca devolve vazio.
 */
export const reviewSummary = (review: DraftReview): string => {
  const reason = review.changes[0]?.reason
  if (reason) {
    const prefix = review.changes.length > 1 ? `${review.changes.length} ajustes: ` : ""
    return short(`${prefix}${reason}`)
  }
  const warning = review.warnings.find((item) => item.trim())
  if (warning) return short(warning)
  return review.status === "ok" ? "Sem ajustes necessários" : "Revisão concluída"
}

/** Sinal de revisão anexado ao dia (o `status` é o mesmo do `DraftReview`). */
export const reviewSignal = (review: DraftReview, at: number): TrackedReviewSignal => ({
  status: review.status,
  summary: reviewSummary(review),
  at
})

/** Sinal de coaching anexado ao dia, já resumido ao que o widget e os alertas usam. */
export const coachingSignal = (report: CoachingReport, at: number): TrackedCoachingSignal => ({
  summary: short(report.summary),
  nextStep: short(report.nextStep),
  at
})
