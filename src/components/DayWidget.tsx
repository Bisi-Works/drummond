import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react"

import type { ChatAdapter } from "~adapters/types"
import { Wordmark } from "~components/Brand"
import { useDayTracking } from "~hooks/useDayTracking"
import { waitElapsed, waitLevel } from "~lib/tracking/level"
import {
  DEFAULT_WIDGET_POSITION,
  loadWidgetPosition,
  saveWidgetPosition,
  type WidgetPosition
} from "~lib/tracking/store"
import type { TrackedConversation, WaitLevel } from "~lib/tracking/types"

// Widget flutuante do protótipo: lista as conversas acompanhadas hoje e pinta o tempo de espera
// desde a última mensagem do cliente. É injetado no shadow DOM pelo content script (companion.tsx)
// e por isso não vaza CSS para a página. A posição é arrastável e persistida em chrome.storage.

const CARD_WIDTH = 300
const HEADER_HEIGHT = 44

/** Cores do chip de espera, no claro e no escuro (mesmo vocabulário do SuggestionCard). */
const WAIT_CHIP: Record<WaitLevel, string> = {
  verde: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  amarelo: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
  laranja: "bg-orange-100 text-orange-900 dark:bg-orange-500/15 dark:text-orange-200",
  vermelho: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200"
}

/** Contorno da linha que precisa de ação (mesmo semáforo do chip, em `ring` para não brigar com a borda base). */
const WAIT_ROW: Record<WaitLevel, string> = {
  verde: "ring-emerald-400/70 dark:ring-emerald-500/40",
  amarelo: "ring-amber-400/70 dark:ring-amber-400/40",
  laranja: "ring-orange-400/80 dark:ring-orange-500/50",
  vermelho: "ring-rose-500/80 dark:ring-rose-500/60"
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/** Duração em texto curto: "45 s", "5 min", "1 h 5 min". */
const formatDuration = (elapsedMs: number): string => {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** Tempo de espera em texto curto: "agora" abaixo de um minuto, senão igual a `formatDuration`. */
const formatWait = (elapsedMs: number): string =>
  elapsedMs < 60_000 ? "agora" : formatDuration(elapsedMs)

/** Data local YYYY-MM-DD em "DD/MM/AAAA" (sem `Date` para não escorregar de fuso). */
const formatDayLabel = (date: string): string => {
  const [year, month, day] = date.split("-")
  return year && month && day ? `${day}/${month}/${year}` : date
}

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

interface Props {
  adapter: ChatAdapter | null
}

export const DayWidget = ({ adapter }: Props) => {
  const { day, conversations, now, summary, attention, alertCount } = useDayTracking(adapter)
  const [position, setPosition] = useState<WidgetPosition>(DEFAULT_WIDGET_POSITION)
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
        </>
      )}
    </div>
  )
}
