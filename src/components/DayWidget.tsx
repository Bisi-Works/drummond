import { sendToBackground } from "@plasmohq/messaging"
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react"

import type { ChatAdapter } from "~adapters/types"
import { Wordmark } from "~components/Brand"
import { CostPanel } from "~components/CostPanel"
import { Spinner } from "~components/Spinner"
import { useDayTracking } from "~hooks/useDayTracking"
import type { CostInfo } from "~lib/ai/cost"
import { config as appConfig } from "~lib/config"
import { WAIT_CHIP, WAIT_ROW } from "~lib/labels"
import {
  GENERATE_REPORT,
  OPEN_REPORT,
  type GenerateReportRequest,
  type GenerateReportResponse,
  type OpenReportRequest,
  type OpenReportResponse
} from "~lib/messages"
import { commitGeneratedReport, loadReportGate, type ReportGateState } from "~lib/report/gate"
import { canGenerateReport, clearReportGeneration } from "~lib/report/storage"
import { formatDayLabel, formatDuration, formatWait } from "~lib/tracking/format"
import { waitElapsed, waitLevel } from "~lib/tracking/level"
import { buildReportInput } from "~lib/tracking/report"
import {
  DEFAULT_WIDGET_POSITION,
  loadWidgetPosition,
  saveWidgetPosition,
  type WidgetPosition
} from "~lib/tracking/store"
import type { TrackedConversation } from "~lib/tracking/types"

// Widget flutuante do protótipo: lista as conversas acompanhadas hoje e pinta o tempo de espera
// desde a última mensagem do cliente. É injetado no shadow DOM pelo content script (companion.tsx)
// e por isso não vaza CSS para a página. A posição é arrastável e persistida em chrome.storage.

const CARD_WIDTH = 300
const HEADER_HEIGHT = 44

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/** Estado neutro de quem não está aguardando resposta. */
const idleLabel = (conversation: TrackedConversation): string =>
  conversation.lastMessageAuthor === "vendedor" ? "respondido" : "sem pendência"

const ConversationRow = ({
  conversation,
  now,
  highlighted
}: {
  conversation: TrackedConversation
  now: number
  highlighted: boolean
}) => {
  const elapsed = waitElapsed(conversation, now)
  const level = elapsed === null ? null : waitLevel(elapsed)
  const preview = conversation.lastMessageText.trim() || "Sem mensagens ainda"
  const signal = conversation.lastCoaching
    ? `Coaching: ${conversation.lastCoaching.nextStep}`
    : conversation.lastReview
      ? `Revisão: ${conversation.lastReview.summary}`
      : null

  return (
    <li
      className={`rounded-lg border border-line bg-muted/60 px-2.5 py-2 ${
        highlighted ? `ring-1 ring-inset ${WAIT_ROW[level ?? "verde"]}` : ""
      }`}>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg" title={conversation.label}>
          {conversation.label}
        </span>
        {level && elapsed !== null ? (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${WAIT_CHIP[level]}`}>
            {formatWait(elapsed)}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-fg-subtle">
            {highlighted ? "aguardando" : idleLabel(conversation)}
          </span>
        )}
      </div>
      <p className="mt-1 truncate text-[11px] text-fg-muted" title={preview}>
        {preview}
      </p>
      {(signal || conversation.reviewCount > 0) && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-fg-subtle">
          {signal && (
            <span className="min-w-0 flex-1 truncate" title={signal}>
              {signal}
            </span>
          )}
          {conversation.reviewCount > 0 && (
            <span className="shrink-0">
              {conversation.reviewCount} revisão{conversation.reviewCount > 1 ? "ões" : ""}
            </span>
          )}
        </p>
      )}
    </li>
  )
}

/** Estado do botão "Encerrar o dia": ocioso, gerando, com erro da IA ou com o relatório pronto. */
type FinishState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; date: string; cost?: CostInfo; openFailed: boolean }

/**
 * Pede ao background para abrir a página do relatório em uma nova aba. `false` quando a aba não
 * pôde ser aberta — o relatório já está salvo e continua alcançável pelo ícone/página da extensão.
 */
const openReportPage = async (date: string): Promise<boolean> => {
  try {
    const response = await sendToBackground<OpenReportRequest, OpenReportResponse>({
      name: OPEN_REPORT,
      body: { date }
    })
    return response.ok
  } catch {
    return false
  }
}

interface Props {
  adapter: ChatAdapter | null
}

export const DayWidget = ({ adapter }: Props) => {
  const { day, conversations, now, summary, attention, alertCount } = useDayTracking(adapter)
  const [position, setPosition] = useState<WidgetPosition>(DEFAULT_WIDGET_POSITION)
  const [finish, setFinish] = useState<FinishState>({ kind: "idle" })
  // Trava diária: em produção bloqueia a segunda geração; em dev/`reportUnlimited` fica liberada.
  const [reportGate, setReportGate] = useState<ReportGateState>({ locked: false, stored: false })
  const rootRef = useRef<HTMLDivElement>(null)
  const positionRef = useRef(position)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)

  useEffect(() => {
    positionRef.current = position
  }, [position])

  useEffect(() => {
    let alive = true
    void loadWidgetPosition().then((loaded) => {
      if (!alive) return
      positionRef.current = loaded
      setPosition(loaded)
    })
    return () => {
      alive = false
    }
  }, [])

  // Recarrega a trava quando o dia vira e quando uma geração termina (`finish`), para o botão
  // refletir a cota consumida (em prod) e a existência de um relatório salvo para reabrir.
  useEffect(() => {
    let alive = true
    void loadReportGate(day.date).then((gate) => {
      if (alive) setReportGate(gate)
    })
    return () => {
      alive = false
    }
  }, [day.date, finish])

  /** Atualiza o estado e grava a posição — o widget volta onde o vendedor o deixou. */
  const persist = (next: WidgetPosition) => {
    positionRef.current = next
    setPosition(next)
    void saveWidgetPosition(next)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest("button")) return
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const rect = rootRef.current?.getBoundingClientRect()
    const width = rect?.width ?? CARD_WIDTH
    const height = rect?.height ?? HEADER_HEIGHT
    const left = clamp(event.clientX - drag.offsetX, 0, Math.max(0, window.innerWidth - width))
    const top = clamp(event.clientY - drag.offsetY, 0, Math.max(0, window.innerHeight - height))
    const next = { ...positionRef.current, top, left }
    positionRef.current = next
    setPosition(next)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    void saveWidgetPosition(positionRef.current)
  }

  const toggleMinimized = () => persist({ ...positionRef.current, minimized: !positionRef.current.minimized })

  // Fila de atenção primeiro (ordem de `attentionQueue`), depois o resto como já vinha (última vista).
  const attentionKeys = new Set(attention.map((item) => item.conversation.key))
  const ordered = [
    ...attention.map((item) => item.conversation),
    ...conversations.filter((conversation) => !attentionKeys.has(conversation.key))
  ]

  const style: CSSProperties = { position: "fixed", top: position.top }
  if (position.left !== undefined) style.left = position.left
  else style.right = position.right ?? DEFAULT_WIDGET_POSITION.right

  // `buildReportInput` descarta conversas sem nenhuma mensagem (registro mínimo criado por um sinal
  // de IA antes do primeiro tick); se nenhuma sobrar, o relatório sairia vazio, então o botão fica
  // desabilitado com a dica no `title` em vez de gastar uma chamada de IA à toa.
  const canFinishDay = buildReportInput(day, now).conversations.length > 0
  const finishBusy = finish.kind === "loading"

  /**
   * Gera o relatório do dia (no background, nunca no content script), guarda-o no storage e abre a
   * página em uma nova aba. Estados visíveis no próprio widget: "gerando", erro da IA e sucesso.
   */
  const finishDay = async () => {
    if (finishBusy || !canFinishDay) return
    const input = buildReportInput(day, Date.now())
    // Checagem antes de gastar IA: a UI já desabilita o botão, mas o estado pode ter mudado (outra
    // aba gerou o relatório) entre o render e o clique.
    if (!(await canGenerateReport(input.date))) {
      setReportGate((gate) => ({ ...gate, locked: true }))
      return
    }
    setFinish({ kind: "loading" })
    let response: GenerateReportResponse
    try {
      response = await sendToBackground<GenerateReportRequest, GenerateReportResponse>({
        name: GENERATE_REPORT,
        body: { report: input }
      })
    } catch {
      // Acontece quando a extensão é recarregada com a página aberta.
      setFinish({
        kind: "error",
        message: "A extensão foi atualizada. Recarregue a página do Botconversa."
      })
      return
    }
    // Grava o relatório e só então marca a cota (e só quando a IA respondeu `ok: true`) — o
    // invariante mora em `commitGeneratedReport`, testado sem React.
    const outcome = await commitGeneratedReport(input, response)
    if (outcome.status === "ai-failed") {
      setFinish({ kind: "error", message: outcome.error })
      return
    }
    // Sem gravação (extensão recarregada/`chrome.storage` indisponível) não há o que a página
    // abriria: avisa e para aqui, sem abrir uma aba vazia nem consumir a cota do dia.
    if (outcome.status === "save-failed") {
      setFinish({
        kind: "error",
        message:
          "O relatório foi gerado, mas não foi possível salvá-lo neste navegador. Recarregue a página do Botconversa e gere de novo."
      })
      return
    }
    const opened = await openReportPage(input.date)
    setFinish({ kind: "done", date: input.date, cost: response.meta.cost, openFailed: !opened })
  }

  /** "Abrir relatório": leva à página do relatório já salvo do dia, sem gerar de novo. */
  const openStored = async () => {
    const opened = await openReportPage(day.date)
    if (!opened) {
      setFinish({ kind: "error", message: "Não foi possível abrir a página do relatório." })
    }
  }

  /** Dev: limpa a marca do dia e gera de novo, para repetir os testes sem depender da cota. */
  const regenerate = async () => {
    await clearReportGeneration(day.date)
    setReportGate((gate) => ({ ...gate, locked: false }))
    await finishDay()
  }

  return (
    <div
      ref={rootRef}
      role="complementary"
      aria-label="Conversas acompanhadas hoje"
      style={style}
      className="z-50 flex max-h-[60vh] flex-col overflow-hidden rounded-xl border border-line bg-surface font-sans text-fg shadow-2xl"
      data-testid="day-widget">
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ height: HEADER_HEIGHT }}
        className="flex cursor-grab touch-none select-none items-center justify-between gap-2 rounded-t-xl border-b border-white/10 bg-black pl-3 pr-1.5 active:cursor-grabbing">
        <Wordmark />
        <div className="flex items-center gap-1.5">
          {alertCount > 0 && (
            <span
              className="shrink-0 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
              title={`${alertCount} conversa${alertCount > 1 ? "s" : ""} aguardando em laranja ou vermelho`}>
              {alertCount}
            </span>
          )}
          <span className="text-[11px] leading-none text-gray-400">
            {formatDayLabel(day.date)} · {conversations.length}
          </span>
          <button
            type="button"
            onClick={toggleMinimized}
            aria-label={position.minimized ? "Expandir widget" : "Minimizar widget"}
            title={position.minimized ? "Expandir" : "Minimizar"}
            className="rounded p-1.5 leading-none text-gray-400 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
            {position.minimized ? "▸" : "▾"}
          </button>
        </div>
      </div>

      {!position.minimized && (
        <>
          <div style={{ width: CARD_WIDTH }} className="flex-1 overflow-y-auto p-2.5">
            {conversations.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-fg-subtle">
                Nenhuma conversa acompanhada hoje ainda
              </p>
            ) : (
              <ul className="space-y-2">
                {ordered.map((conversation) => (
                  <ConversationRow
                    key={conversation.key}
                    conversation={conversation}
                    now={now}
                    highlighted={attentionKeys.has(conversation.key)}
                  />
                ))}
              </ul>
            )}
          </div>
          {conversations.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-2.5 py-2 text-[11px] text-fg-muted">
              <span>{summary.conversations} acompanhadas</span>
              <span>{summary.waiting} aguardando</span>
              <span>{summary.answered} respondidas</span>
              {summary.averageFirstResponseMs !== null && (
                <span title="Média do tempo até a primeira resposta do vendedor">
                  1ª resposta em {formatDuration(summary.averageFirstResponseMs)}
                </span>
              )}
            </div>
          )}

          <div className="space-y-2 border-t border-line px-2.5 py-2">
            <button
              type="button"
              onClick={finishDay}
              disabled={finishBusy || !canFinishDay || reportGate.locked}
              aria-busy={finishBusy || undefined}
              title={
                reportGate.locked
                  ? "A cota de um relatório por dia já foi usada hoje"
                  : canFinishDay
                    ? "Gerar o relatório do dia com a IA e abrir a página"
                    : "Nenhuma conversa com mensagem foi acompanhada hoje"
              }
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-muted disabled:text-fg-subtle">
              {finishBusy && <Spinner className="h-3.5 w-3.5" />}
              {finishBusy
                ? "Gerando relatório…"
                : reportGate.locked
                  ? "Relatório de hoje já gerado"
                  : "Encerrar o dia"}
            </button>

            {reportGate.locked && (
              <p className="text-[11px] text-fg-subtle">
                A cota de um relatório por dia já foi usada. Reabra o relatório de hoje abaixo.
              </p>
            )}

            {reportGate.stored && (
              <button
                type="button"
                onClick={() => void openStored()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-fg transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                Abrir relatório
              </button>
            )}

            {appConfig.showCosts && reportGate.stored && (
              <button
                type="button"
                onClick={() => void regenerate()}
                disabled={finishBusy}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line bg-surface px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed">
                Gerar novamente (dev)
              </button>
            )}

            {finish.kind === "error" && (
              <p
                role="alert"
                className="rounded-md bg-rose-50 px-2.5 py-2 text-[11px] text-rose-800 dark:bg-rose-500/15 dark:text-rose-200">
                {finish.message}
              </p>
            )}

            {finish.kind === "done" && (
              <p className="text-[11px] text-fg-subtle" aria-live="polite">
                {finish.openFailed
                  ? `Relatório de ${formatDayLabel(finish.date)} salvo, mas a página não abriu.`
                  : `Relatório de ${formatDayLabel(finish.date)} aberto em uma nova aba.`}
              </p>
            )}

            {appConfig.showCosts && finish.kind === "done" && finish.cost && (
              <CostPanel cost={finish.cost} />
            )}
          </div>
        </>
      )}
    </div>
  )
}
