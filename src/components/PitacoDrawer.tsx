import { useEffect, useRef, useState } from "react"

import type { PitacoState } from "~hooks/usePitaco"
import { bantCriteria, spinStages, type SpinStage } from "~lib/ai/constants"
import type { Pitaco } from "~lib/ai/schemas"
import { BANT_LABEL, BANT_STATUS_STYLE, PITACO_KIND_LABEL, SPIN_LABEL, SPIN_STATUS_STYLE } from "~lib/labels"
import { describeAudio } from "~lib/transcripts/prepare"

import { LogoMark } from "./Brand"
import { CostPanel } from "./CostPanel"
import { MetaFooter } from "./MetaFooter"
import { Spinner } from "./Spinner"

interface Props {
  state: PitacoState
  /** Nome do contato, quando a plataforma mostra. */
  contactName?: string | null
  onRefresh: () => void
  onClose: () => void
}

/** Bússola do botão "Pitaco": orientação de caminho, não texto pronto. */
export const PitacoMark = ({ className = "h-3.5 w-3.5" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10.6 5.4 9 9 5.4 10.6 7 7z" fill="currentColor" />
  </svg>
)

const buttonBase =
  "rounded-md px-3 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50"

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
    {children}
  </section>
)

const Evidence = ({ ids }: { ids: number[] }) =>
  ids.length > 0 ? (
    <span className="shrink-0 text-[11px] text-fg-subtle" title="Mensagens da conversa que sustentam o ponto">
      {ids.map((id) => `#${id}`).join(" ")}
    </span>
  ) : null

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

const useCopy = (text: string) => {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return [copied, copy] as const
}

/**
 * Só perguntas e sugestões de resposta são copiáveis: conselhos e pontos são direção de raciocínio,
 * não texto para enviar.
 */
const CopyQuestion = ({ text }: { text: string }) => {
  const [copied, copy] = useCopy(text)
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Pergunta copiada" : "Copiar pergunta"}
      title="Copiar pergunta"
      className="shrink-0 rounded-md border border-line-strong px-1.5 py-0.5 text-xs text-fg-muted hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      {copied ? "✓" : "⧉"}
    </button>
  )
}

const CopyReply = ({ text }: { text: string }) => {
  const [copied, copy] = useCopy(text)
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Sugestão copiada" : "Copiar sugestão"}
      className="rounded-md border border-line-strong px-2 py-0.5 text-xs font-medium text-fg-muted hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      {copied ? "✓ Copiada" : "⧉ Copiar"}
    </button>
  )
}

interface GridItem {
  key: string
  letter: string
  label: string
  status: { label: string; icon: string; iconClassName: string }
  evidence: string
}

/**
 * Quatro casas com status (etapas do SPIN, critérios do BANT). A evidência da casa inicial já
 * aparece aberta; clicar noutra troca, clicar de novo fecha.
 */
const StatusGrid = ({
  label,
  items,
  current,
  initial = null
}: {
  label: string
  items: GridItem[]
  /** Casa em destaque (a etapa atual do SPIN). */
  current?: string | null
  initial?: string | null
}) => {
  const [selected, setSelected] = useState<string | null>(initial)
  const open = items.find((item) => item.key === selected && item.evidence.trim())

  return (
    <div className="space-y-2">
      <ol className="grid grid-cols-4 gap-1.5" aria-label={label}>
        {items.map(({ key, letter, label, status }) => {
          const isCurrent = key === current
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => setSelected(selected === key ? null : key)}
                aria-pressed={selected === key}
                aria-current={isCurrent ? "step" : undefined}
                title={`${label}: ${status.label}${isCurrent ? " (etapa atual)" : ""}`}
                className={`flex w-full flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  isCurrent ? "border-brand ring-1 ring-brand" : "border-line"
                } ${selected === key ? "bg-muted" : ""}`}>
                <span className="flex items-center gap-1 text-sm font-semibold text-fg">
                  {letter}
                  <span className={`text-xs ${status.iconClassName}`} aria-hidden="true">
                    {status.icon}
                  </span>
                </span>
                <span className="w-full truncate text-center text-[10px] text-fg-muted">{label}</span>
              </button>
            </li>
          )
        })}
      </ol>
      {open && (
        <p className="border-l-2 border-line-strong pl-2 text-xs text-fg-muted">
          <span className="font-medium text-fg">{open.label}:</span> {open.evidence.trim()}
        </p>
      )}
    </div>
  )
}

const SpinGrid = ({ pitaco }: { pitaco: Pitaco }) => {
  const current = pitaco.stageNow === "abertura" ? null : pitaco.stageNow
  return (
    <Section title="SPIN">
      {pitaco.stageNow === "abertura" && (
        <p className="text-xs font-medium text-fg-muted">Abertura: a descoberta ainda não começou.</p>
      )}
      <StatusGrid
        label="Etapas do SPIN"
        current={current}
        initial={current}
        items={spinStages.map((stage: SpinStage) => ({
          key: stage,
          ...SPIN_LABEL[stage],
          status: SPIN_STATUS_STYLE[pitaco.stages[stage].status],
          evidence: pitaco.stages[stage].evidence
        }))}
      />
    </Section>
  )
}

const BantGrid = ({ pitaco }: { pitaco: Pitaco }) => {
  const done = bantCriteria.filter((criterion) => pitaco.bant[criterion].status === "cumprido").length
  return (
    <Section title={`Qualificação (BANT) · ${done}/${bantCriteria.length}`}>
      <StatusGrid
        label="Critérios do BANT"
        items={bantCriteria.map((criterion) => ({
          key: criterion,
          ...BANT_LABEL[criterion],
          status: BANT_STATUS_STYLE[pitaco.bant[criterion].status],
          evidence: pitaco.bant[criterion].evidence
        }))}
      />
    </Section>
  )
}

const TOPIC_TONE = {
  fazer: {
    box: "border-emerald-200 bg-emerald-50 dark:border-emerald-400/30 dark:bg-emerald-400/10",
    title: "text-emerald-800 dark:text-emerald-300",
    mark: "text-emerald-600 dark:text-emerald-400",
    icon: "✓"
  },
  naoFazer: {
    box: "border-rose-200 bg-rose-50 dark:border-rose-400/30 dark:bg-rose-400/10",
    title: "text-rose-800 dark:text-rose-300",
    mark: "text-rose-600 dark:text-rose-400",
    icon: "✕"
  }
} as const

const Topics = ({ tone, title, items }: { tone: keyof typeof TOPIC_TONE; title: string; items: string[] }) => {
  const style = TOPIC_TONE[tone]
  return (
    <section className={`rounded-lg border px-3 py-3 ${style.box}`} aria-label={title}>
      <h3 className={`mb-2 flex items-center gap-1.5 text-sm font-semibold ${style.title}`}>
        <span aria-hidden="true">{style.icon}</span>
        {title}
      </h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm leading-snug text-fg">
            <span className={`w-3 shrink-0 text-center ${style.mark}`} aria-hidden="true">
              •
            </span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Visão inicial: conselhos do que fazer e do que não fazer agora, e sugestões de resposta. O modelo
 * escreve esse resumo por último, depois de passar pelo SPIN, pelo BANT e pelos fatos a confirmar,
 * que ficam no modo Avançado.
 * Se o resumo vier vazio (o service descarta tópico longo demais), o caminho faz as vezes do Fazer.
 */
const SimpleBody = ({ pitaco }: { pitaco: Pitaco }) => {
  const doNow = pitaco.doNow.length > 0 ? pitaco.doNow : pitaco.path
  return (
    <>
      {doNow.length > 0 && <Topics tone="fazer" title="Fazer" items={doNow} />}
      {pitaco.avoid.length > 0 && <Topics tone="naoFazer" title="Não fazer" items={pitaco.avoid} />}
      {pitaco.replies.length > 0 && (
        <Section title="Sugestões de respostas">
          <p className="text-xs text-fg-muted">Para enviar por texto ou falar em áudio. Ajuste ao seu jeito antes.</p>
          <ul className="space-y-2">
            {pitaco.replies.map((reply, i) => (
              <li key={i} className="space-y-2 rounded-lg border border-line p-3">
                <p className="text-sm leading-relaxed text-fg">{reply}</p>
                <div className="flex justify-end">
                  <CopyReply text={reply} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}

const AdvancedBody = ({ pitaco }: { pitaco: Pitaco }) => (
  <>
    <SpinGrid pitaco={pitaco} />
    <BantGrid pitaco={pitaco} />

    <p className="text-sm leading-relaxed text-fg">{pitaco.diagnosis}</p>

    {pitaco.path.length > 0 && (
      <Section title="Caminho">
        <ol className="space-y-1.5">
          {pitaco.path.map((step, i) => (
            <li key={i} className="flex gap-2 text-sm text-fg">
              <span className="w-4 shrink-0 text-right font-semibold text-fg-subtle">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </Section>
    )}

    {pitaco.points.length > 0 && (
      <Section title="Pontos a abordar">
        <ul className="space-y-2">
          {pitaco.points.map((point, i) => (
            <li key={i} className="space-y-1 rounded-lg border border-line p-3">
              <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-fg-muted">
                <span>
                  <span className="font-semibold text-fg">{SPIN_LABEL[point.stage].letter}</span> ·{" "}
                  {PITACO_KIND_LABEL[point.kind]}
                </span>
                <Evidence ids={point.evidence} />
              </div>
              <p className="text-sm font-medium text-fg">{point.title}</p>
              <p className="text-xs text-fg-muted">{point.why}</p>
              {point.hint && <p className="text-xs text-fg-subtle">→ {point.hint}</p>}
            </li>
          ))}
        </ul>
      </Section>
    )}

    {pitaco.questions.length > 0 && (
      <Section title="Perguntas">
        <ul className="space-y-2">
          {pitaco.questions.map((question, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                className="w-4 shrink-0 text-center text-xs font-semibold leading-5 text-fg-subtle"
                title={SPIN_LABEL[question.stage].label}>
                {SPIN_LABEL[question.stage].letter}
              </span>
              <p className="min-w-0 flex-1 text-sm text-fg">{question.text}</p>
              <CopyQuestion text={question.text} />
            </li>
          ))}
        </ul>
      </Section>
    )}

    {pitaco.warnings.length > 0 && (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-400/30 dark:bg-amber-400/10">
        <p className="mb-1 text-xs font-semibold text-amber-900 dark:text-amber-200">Confirme antes de falar</p>
        <ul className="list-disc space-y-0.5 pl-4 text-sm text-amber-900 dark:text-amber-100">
          {pitaco.warnings.map((warning, i) => (
            <li key={i}>{warning}</li>
          ))}
        </ul>
      </div>
    )}
  </>
)

const progressText = (state: PitacoState) => {
  switch (state.kind) {
    case "reading":
      return "Lendo a conversa…"
    case "transcribing":
      return `Transcrevendo áudios ${Math.min(state.done + 1, state.total)} de ${state.total}…`
    case "generating":
      return "Gerando o Pitaco…"
    default:
      return null
  }
}

const generatedAt = (at: number) =>
  new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

export const PitacoDrawer = ({ state, contactName, onRefresh, onClose }: Props) => {
  const panel = useRef<HTMLElement>(null)
  const busy = state.kind === "reading" || state.kind === "transcribing" || state.kind === "generating"
  const progress = progressText(state)
  // Abre sempre na visão simples (o drawer é desmontado ao fechar); "Atualizar" mantém a escolha.
  const [advanced, setAdvanced] = useState(false)
  const hasView = busy || (state.kind === "done" && state.response.ok)

  // O drawer recebe o foco ao abrir, para o leitor de tela anunciar e o Esc funcionar de imediato.
  useEffect(() => panel.current?.focus(), [])

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-labelledby="pitaco-title"
      className="flex h-full flex-col overflow-hidden border-l border-black bg-surface font-sans text-fg shadow-2xl focus:outline-none">
      <header className="flex items-center justify-between gap-2 border-b border-line bg-black py-2 pl-4 pr-2">
        {/* Só o retrato, não o "Drummond by BW": no drawer estreito o nome quebrava ao lado do título. */}
        <div className="flex min-w-0 items-center gap-2.5 text-white">
          <LogoMark className="h-[30px] w-5 shrink-0" />
          <div className="min-w-0 leading-tight">
            <h2 id="pitaco-title" className="text-[15px] font-semibold tracking-tight">
              Pitaco
              {advanced && <span className="font-normal text-gray-400"> · Avançado</span>}
            </h2>
            {contactName && <p className="truncate text-[11px] text-gray-400">{contactName}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {hasView && (
            <button
              type="button"
              onClick={() => setAdvanced(!advanced)}
              title={advanced ? "Voltar ao resumo: o que fazer e o que não fazer" : "Ver a análise completa: SPIN, BANT, caminho e perguntas"}
              className="rounded-md border border-white/25 px-2 py-1 text-[11px] font-medium text-gray-200 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              {advanced ? "Simples" : "Avançado"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar o Pitaco"
            className="rounded p-1.5 leading-none text-gray-400 hover:bg-white/10 hover:text-white">
            ✕
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <p aria-live="polite" className={progress ? "flex items-center gap-2 text-sm text-fg-muted" : "sr-only"}>
          {progress && <Spinner />}
          {progress ?? (state.kind === "done" ? "Pitaco pronto." : "")}
        </p>

        {busy &&
          (advanced ? (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
                {spinStages.map((stage) => (
                  <div key={stage} className="h-11 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
              <Skeleton lines={2} />
              <Skeleton lines={3} />
            </div>
          ) : (
            <div className="space-y-4" aria-hidden="true">
              <div className="h-32 animate-pulse rounded-lg bg-muted" />
              <div className="h-24 animate-pulse rounded-lg bg-muted" />
              <Skeleton lines={3} />
            </div>
          ))}

        {state.kind === "idle" && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-fg-muted">O Pitaco desta conversa ainda não foi gerado.</p>
            <button type="button" onClick={onRefresh} className={`${buttonBase} bg-brand text-white hover:bg-brand-dark`}>
              Gerar Pitaco
            </button>
          </div>
        )}

        {state.kind === "empty" && (
          <p className="py-6 text-center text-sm text-fg-muted">
            Ainda não há mensagens do cliente ou do vendedor nesta conversa. Assim que a conversa
            começar, o Pitaco sugere por onde seguir.
          </p>
        )}

        {state.kind === "done" &&
          (state.response.ok ? (
            advanced ? (
              // `key`: um Pitaco novo reabre o stepper na etapa atual dele.
              <AdvancedBody key={state.at} pitaco={state.response.data} />
            ) : (
              <SimpleBody pitaco={state.response.data} />
            )
          ) : (
            <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-500/15 dark:text-rose-200">
              {state.response.error}
            </p>
          ))}
      </div>

      {(state.kind === "done" || state.kind === "empty") && (
        <footer className="space-y-2 border-t border-line px-4 py-3">
          {state.kind === "done" && state.response.meta.cost && <CostPanel cost={state.response.meta.cost} />}
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-[11px] text-fg-subtle">
              {state.kind === "done" ? (
                [`Gerado às ${generatedAt(state.at)}`, describeAudio(state.audio)].filter(Boolean).join(" · ")
              ) : (
                "Nada para analisar ainda."
              )}
            </p>
            <button
              type="button"
              onClick={onRefresh}
              disabled={busy}
              className={`${buttonBase} shrink-0 ${
                state.kind === "done" && !state.response.ok
                  ? "bg-fg text-surface hover:opacity-90"
                  : "bg-brand text-white hover:bg-brand-dark"
              }`}>
              {state.kind === "done" && !state.response.ok ? "Tentar de novo" : "Atualizar Pitaco"}
            </button>
          </div>
          {state.kind === "done" && <MetaFooter meta={state.response.meta} />}
        </footer>
      )}
    </aside>
  )
}
