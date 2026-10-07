import { useState } from "react"

import { bantCriteria } from "~lib/ai/constants"
import type { PartialBantItem, PartialCoachingReport } from "~lib/ai/partial-report"
import { BANT_LABEL, BANT_STATUS_STYLE, COACHING_LABEL, IMPACT_STYLE } from "~lib/labels"

const Section = ({
  title,
  aside,
  children
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) => (
  <section className="space-y-2">
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      {aside}
    </div>
    {children}
  </section>
)

/** Lugar reservado para um conteúdo que ainda não chegou do streaming. */
const Skeleton = ({ lines = 1 }: { lines?: number }) => (
  <div className="space-y-1.5" aria-hidden="true">
    {Array.from({ length: lines }, (_, i) => (
      <div
        key={i}
        className={`h-3 animate-pulse rounded bg-muted ${lines > 1 && i === lines - 1 ? "w-2/3" : ""}`}
      />
    ))}
  </div>
)

const CopyButton = ({ text, label = "Copiar sugestão" }: { text: string; label?: string }) => {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="rounded-md border border-line-strong px-2 py-1 text-xs font-medium text-fg-muted hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      {copied ? "Copiado ✓" : label}
    </button>
  )
}

const BantRow = ({
  criterion,
  item = {},
  streaming
}: {
  criterion: keyof typeof BANT_LABEL
  item?: PartialBantItem
  streaming: boolean
}) => {
  const status = item.status && BANT_STATUS_STYLE[item.status]
  const { letter, label } = BANT_LABEL[criterion]
  const question = item.status === "cumprido" ? "" : (item.question?.trim() ?? "")
  return (
    <li className="flex gap-2.5 p-3">
      <span
        className={`w-4 shrink-0 text-center text-sm leading-5 ${status?.iconClassName ?? "animate-pulse text-fg-subtle"}`}
        aria-hidden="true">
        {status?.icon ?? "○"}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-fg">
            <span className="mr-1.5 font-semibold">{letter}</span>
            {label}
          </span>
          {status ? (
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${status.className}`}>
              {status.label}
            </span>
          ) : (
            streaming && <span className="h-4 w-14 animate-pulse rounded bg-muted" aria-hidden="true" />
          )}
        </div>
        {item.evidence ? (
          <p className="text-sm text-fg-muted">{item.evidence}</p>
        ) : (
          streaming && <Skeleton />
        )}
        {question && (
          <>
            <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100">{question}</div>
            {!streaming && (
              <div className="flex justify-end">
                <CopyButton text={question} label="Copiar pergunta" />
              </div>
            )}
          </>
        )}
      </div>
    </li>
  )
}

const BantChecklist = ({
  bant = {},
  streaming
}: {
  bant?: PartialCoachingReport["bant"]
  streaming: boolean
}) => {
  const done = bantCriteria.filter((criterion) => bant[criterion]?.status === "cumprido").length
  return (
    <Section
      title="Checklist BANT"
      aside={
        <span
          className="text-xs font-medium text-fg-subtle"
          title={`${done} de ${bantCriteria.length} critérios cumpridos`}>
          {done}/{bantCriteria.length}
        </span>
      }>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {bantCriteria.map((criterion) => (
          <BantRow key={criterion} criterion={criterion} item={bant[criterion]} streaming={streaming} />
        ))}
      </ul>
    </Section>
  )
}

/**
 * Relatório de coaching. Com `streaming`, o relatório ainda está chegando: cada seção aparece
 * conforme o modelo a escreve (em qualquer ordem — alguns provedores reordenam as chaves), e o
 * que falta fica como espaço reservado. Os botões de copiar só aparecem com o texto completo.
 */
export const CoachingReport = ({
  report,
  streaming = false
}: {
  report: PartialCoachingReport
  streaming?: boolean
}) => {
  const strengths = report.strengths ?? []
  const improvements = report.improvements ?? []
  return (
    <div className="space-y-5" aria-busy={streaming}>
      {report.summary ? (
        <p className="text-sm leading-relaxed text-fg">{report.summary}</p>
      ) : (
        streaming && <Skeleton lines={2} />
      )}

      <BantChecklist bant={report.bant} streaming={streaming} />

      {(strengths.length > 0 || streaming) && (
        <Section title="Pontos fortes">
          {strengths.length > 0 ? (
            <ul className="space-y-1.5">
              {strengths.map((strength, i) => (
                <li key={i} className="flex gap-2 text-sm text-fg-muted">
                  <span className="text-emerald-600 dark:text-emerald-400" aria-hidden="true">
                    ✓
                  </span>
                  {strength}
                </li>
              ))}
            </ul>
          ) : (
            <Skeleton lines={2} />
          )}
        </Section>
      )}

      {(improvements.length > 0 || streaming) && (
        <Section title="O que melhorar">
          {improvements.length > 0 ? (
            <ol className="space-y-3">
              {improvements.map((item, i) => (
                <li key={i} className="space-y-2 rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                    {item.impact && (
                      <span className={`rounded px-1.5 py-0.5 ${IMPACT_STYLE[item.impact].className}`}>
                        {IMPACT_STYLE[item.impact].label}
                      </span>
                    )}
                    {item.category && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-fg">
                        {COACHING_LABEL[item.category]}
                      </span>
                    )}
                    {item.messageId !== undefined && (
                      <span className="text-fg-subtle">mensagem #{item.messageId}</span>
                    )}
                  </div>
                  {item.excerpt && (
                    <blockquote className="border-l-2 border-line pl-2 text-sm italic text-fg-subtle">
                      {item.excerpt}
                    </blockquote>
                  )}
                  {item.issue && <p className="text-sm text-fg-muted">{item.issue}</p>}
                  {item.suggestion && (
                    <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100">
                      {item.suggestion}
                    </div>
                  )}
                  {!streaming && item.suggestion && (
                    <div className="flex justify-end">
                      <CopyButton text={item.suggestion} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <Skeleton lines={3} />
          )}
        </Section>
      )}

      {(report.nextStep || streaming) && (
        <Section title="Próximo passo">
          {report.nextStep ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-fg">{report.nextStep}</p>
          ) : (
            <Skeleton lines={2} />
          )}
        </Section>
      )}
    </div>
  )
}
