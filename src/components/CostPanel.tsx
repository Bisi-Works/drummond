import { formatUsd, type CostInfo } from "~lib/ai/cost"

const tokens = (n: number) => n.toLocaleString("pt-BR")

const Row = ({ label, value, detail }: { label: string; value: string; detail?: string }) => (
  <div className="grid grid-cols-[4.5rem_1fr] gap-x-2">
    <dt className="text-fg-subtle">{label}</dt>
    <dd className="font-medium tabular-nums text-fg">{value}</dd>
    {detail && <dd className="col-start-2 text-[11px] text-fg-subtle">{detail}</dd>}
  </div>
)

/** Custo estimado × efetivo de uma análise. Só é renderizado no `pnpm dev`. */
export const CostPanel = ({ cost }: { cost: CostInfo }) => {
  const { estimate, effective } = cost

  const estimateValue = !estimate
    ? "indisponível"
    : estimate.minUsd === estimate.maxUsd
      ? formatUsd(estimate.minUsd)
      : `${formatUsd(estimate.minUsd)} – ${formatUsd(estimate.maxUsd).replace("US$ ", "")}`

  const effectiveValue =
    effective?.usd != null
      ? `${formatUsd(effective.usd)} (≈ ${formatUsd(effective.usd * 1000)} / mil análises)`
      : effective
        ? "não informado pelo OpenRouter"
        : "sem cobrança registrada"

  return (
    <section className="rounded-lg border border-dashed border-amber-300 bg-amber-50/60 px-3 py-2 text-xs dark:border-amber-400/40 dark:bg-amber-400/10">
      <h2 className="mb-1.5 flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
        Custo desta análise
        <span className="rounded bg-amber-200 px-1 dark:bg-amber-400/30 text-[10px] uppercase tracking-wide">dev</span>
      </h2>
      <dl className="space-y-1.5">
        <Row
          label="Estimado"
          value={estimateValue}
          detail={
            estimate
              ? `~${tokens(estimate.inputTokens)} tokens de entrada + ~${tokens(estimate.outputTokens)} de saída (sem raciocínio) · faixa entre ${estimate.providers} provedor(es)`
              : undefined
          }
        />
        <Row
          label="Efetivo"
          value={effectiveValue}
          detail={
            effective
              ? `${tokens(effective.inputTokens)} entrada + ${tokens(effective.outputTokens)} saída` +
                (effective.reasoningTokens ? ` (${tokens(effective.reasoningTokens)} de raciocínio)` : "") +
                (effective.provider ? ` · ${effective.provider}` : "")
              : undefined
          }
        />
      </dl>
    </section>
  )
}
