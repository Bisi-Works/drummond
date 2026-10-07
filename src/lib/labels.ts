import type {
  BantCriterion,
  BantStatus,
  ChangeCategory,
  CoachingCategory,
  ImpactLevel
} from "~lib/ai/constants"

export const CHANGE_LABEL: Record<ChangeCategory, string> = {
  ortografia: "Ortografia",
  gramatica: "Gramática",
  clareza: "Clareza",
  tom: "Tom",
  contexto: "Contexto",
  comercial: "Comercial"
}

export const COACHING_LABEL: Record<CoachingCategory, string> = {
  escrita: "Escrita",
  clareza: "Clareza",
  escuta: "Escuta ativa",
  tom: "Tom",
  conducao: "Condução"
}

export const IMPACT_STYLE: Record<ImpactLevel, { label: string; className: string }> = {
  alto: { label: "Impacto alto", className: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200" },
  medio: { label: "Impacto médio", className: "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200" },
  baixo: { label: "Impacto baixo", className: "bg-muted text-fg-muted" }
}

export const BANT_LABEL: Record<BantCriterion, { letter: string; label: string }> = {
  budget: { letter: "B", label: "Orçamento" },
  authority: { letter: "A", label: "Autoridade" },
  need: { letter: "N", label: "Necessidade" },
  timing: { letter: "T", label: "Prazo" }
}

export const BANT_STATUS_STYLE: Record<
  BantStatus,
  { label: string; icon: string; iconClassName: string; className: string }
> = {
  cumprido: {
    label: "Cumprido",
    icon: "✓",
    iconClassName: "text-emerald-600 dark:text-emerald-400",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/20 dark:text-emerald-200"
  },
  parcial: {
    label: "Parcial",
    icon: "◐",
    iconClassName: "text-amber-600 dark:text-amber-400",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-400/20 dark:text-amber-200"
  },
  pendente: {
    label: "Pendente",
    icon: "○",
    iconClassName: "text-fg-subtle",
    className: "bg-muted text-fg-muted"
  }
}
