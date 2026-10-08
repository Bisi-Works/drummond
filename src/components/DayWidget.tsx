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
import { clearSavedData } from "~lib/dev-reset"
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
import { buildReportInput } from "~lib/tracking/report"
import type { AttentionItem } from "~lib/tracking/summary"
import {
  DEFAULT_WIDGET_POSITION,
  loadWidgetPosition,
  saveWidgetPosition,
  type WidgetPosition
} from "~lib/tracking/store"

// Widget flutuante do protótipo: lista só as conversas que aguardam resposta (nome do contato e
// tempo de espera desde a última mensagem do cliente). É injetado no shadow DOM pelo content script (companion.tsx)
// e por isso não vaza CSS para a página. A posição é arrastável e persistida em chrome.storage.

// Literal `process.env.NODE_ENV` (e não `appConfig.showCosts`): o bundler o resolve na build e
// remove o ramo da limpeza de dados na versão de produção, em vez de só não renderizá-lo.
const IS_DEV_BUILD = process.env.NODE_ENV === "development"

const CARD_WIDTH = 300
const HEADER_HEIGHT = 44

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * Uma conversa aguardando resposta: só o nome do contato e há quanto tempo ele espera. O texto da
 * última mensagem não aparece de propósito — o que importa ao vendedor é quem e há quanto tempo.
 */
const ConversationRow = ({ item }: { item: AttentionItem }) => {
  const { conversation, status } = item
  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-lg border border-line bg-muted/60 px-2.5 py-2 ring-1 ring-inset ${
        WAIT_ROW[status.level ?? "verde"]
      }`}>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg" title={conversation.label}>
        {conversation.label}
      </span>
      {status.level && status.elapsedMs !== null ? (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${WAIT_CHIP[status.level]}`}
          title={`Aguardando há ${formatDuration(status.elapsedMs)}`}>
          {formatWait(status.elapsedMs)}
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-fg-subtle">
          aguardando
        </span>
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
  const { day, conversations, now, summary, attention, alertCount, inbox, resetDay } =
    useDayTracking(adapter)
  const [position, setPosition] = useState<WidgetPosition>(DEFAULT_WIDGET_POSITION)
  const [finish, setFinish] = useState<FinishState>({ kind: "idle" })
  // Só no dev: limpar os dados salvos exige um segundo clique, porque apaga relatórios e a cota.
  const [clearState, setClearState] = useState<
    { kind: "idle" } | { kind: "confirm" } | { kind: "done"; removed: number } | { kind: "error" }
  >({ kind: "idle" })
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
  const clearData = async () => {
    const removed = await clearSavedData()
    if (removed === null) {
      setClearState({ kind: "error" })
      return
    }
    resetDay()
    setFinish({ kind: "idle" })
    setReportGate({ locked: false, stored: false })
    setClearState({ kind: "done", removed })
  }

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
            {formatDayLabel(day.date)} · {summary.waiting} aguardando
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
            {attention.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-fg-subtle">
                {conversations.length === 0
                  ? "Nenhuma conversa acompanhada hoje ainda"
                  : "Ninguém aguardando resposta"}
              </p>
            ) : (
              <ul className="space-y-2">
                {attention.map((item) => (
                  <ConversationRow key={item.conversation.key} item={item} />
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
              {inbox.status === "error" && (
                <span
                  className="text-amber-600 dark:text-amber-300"
                  title="Não foi possível ler a inbox; só a conversa aberta está sendo acompanhada.">
                  sem sincronizar com a inbox
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

            {IS_DEV_BUILD && (
              <div className="space-y-1">
                {clearState.kind === "confirm" ? (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void clearData()}
                      className="flex-1 rounded-lg bg-rose-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                      Apagar tudo (dev)
                    </button>
                    <button
                      type="button"
                      onClick={() => setClearState({ kind: "idle" })}
                      className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setClearState({ kind: "confirm" })}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line bg-surface px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                    Limpar dados salvos (dev)
                  </button>
                )}
                {clearState.kind === "confirm" && (
                  <p className="text-[11px] text-fg-subtle">
                    Apaga os dias, os relatórios e a trava diária. Posição e tema ficam.
                  </p>
                )}
                {clearState.kind === "done" && (
                  <p className="text-[11px] text-fg-subtle" aria-live="polite">
                    {clearState.removed} registro{clearState.removed === 1 ? "" : "s"} apagado
                    {clearState.removed === 1 ? "" : "s"}.
                  </p>
                )}
                {clearState.kind === "error" && (
                  <p role="alert" className="text-[11px] text-rose-700 dark:text-rose-300">
                    Não foi possível apagar (sem acesso ao storage da extensão).
                  </p>
                )}
              </div>
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
