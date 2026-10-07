import type {
  BantCriterion,
  BantStatus,
  ChangeCategory,
  CoachingCategory,
  ImpactLevel
} from "~lib/ai/constants"
import type { WaitLevel } from "~lib/tracking/types"

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

/** Cores do chip de espera, no claro e no escuro (widget e painel usam o mesmo semáforo). */
export const WAIT_CHIP: Record<WaitLevel, string> = {
  verde: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  amarelo: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
  laranja: "bg-orange-100 text-orange-900 dark:bg-orange-500/15 dark:text-orange-200",
  vermelho: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200"
}

/** Contorno de uma linha que precisa de ação (mesmo semáforo do chip, em `ring` para não brigar com a borda base). */
export const WAIT_ROW: Record<WaitLevel, string> = {
  verde: "ring-emerald-400/70 dark:ring-emerald-500/40",
  amarelo: "ring-amber-400/70 dark:ring-amber-400/40",
  laranja: "ring-orange-400/80 dark:ring-orange-500/50",
  vermelho: "ring-rose-500/80 dark:ring-rose-500/60"
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
