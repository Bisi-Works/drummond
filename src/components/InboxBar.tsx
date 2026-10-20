import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject
} from "react"

import type { ChatAdapter } from "~adapters/types"
import { LogoMark } from "~components/Brand"
import type { Box } from "~hooks/useComposerState"
import { useDayTracking } from "~hooks/useDayTracking"
import { clearSavedData } from "~lib/dev-reset"
import { WAIT_CHIP } from "~lib/labels"
import { fitCount } from "~lib/layout"
import { formatDayLabel, formatDuration, formatWait } from "~lib/tracking/format"
import type { AttentionItem } from "~lib/tracking/summary"

// Barra do dia, presa ao cabeçalho do Botconversa (no espaço livre entre o título e os ícones):
// marca, totais do dia e as conversas aguardando resposta como chips que abrem a conversa. O resto
// (resumo, avisos, ferramentas de dev) fica no menu "⋯". O "Encerrar o dia" saiu por enquanto: os
// vendedores não geram mais o relatório (a rota e a página continuam na extensão). É injetada no
// shadow DOM pelo content script (companion.tsx) e por isso não vaza CSS para a página.
// Sem cabeçalho (a plataforma mudou ou a página não tem um), a barra flutua no canto inferior.

// Literal `process.env.NODE_ENV` (e não `appConfig.showCosts`): o bundler o resolve na build e
// remove o ramo da limpeza de dados na versão de produção, em vez de só não renderizá-lo.
const IS_DEV_BUILD = process.env.NODE_ENV === "development"

const BAR_HEIGHT = 40
/** Sem cabeçalho: canto inferior esquerdo, ao lado da barra de navegação do Botconversa. */
const FLOATING_OFFSET = { left: 88, bottom: 16 }
const FLOATING_MAX_WIDTH = 720

const CHIP_MAX_WIDTH = 176
/** `gap-1.5` entre os chips. */
const CHIP_GAP = 6
/** Largura do botão "+N" antes de ele existir na tela (reservada ao decidir quantos chips cabem). */
const MORE_BUTTON_WIDTH = 52
/** Abaixo disso os totais saem da barra (continuam no menu "⋯"). */
const STATS_MIN_BAR_WIDTH = 1100

const focusRing = "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1"

/** Fecha um popover ao clicar fora dele (o clique no próprio botão que o abre não conta). */
const useDismiss = (open: boolean, refs: RefObject<HTMLElement>[], onClose: () => void) => {
  useEffect(() => {
    if (!open) return
    // O alvo do evento é o host do shadow DOM; o `composedPath` enxerga os nós de dentro.
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath()
      if (refs.some((ref) => ref.current && path.includes(ref.current))) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown, true)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown, true)
    }
  }, [open, refs, onClose])
}

const waitTitle = (item: AttentionItem) =>
  item.status.elapsedMs !== null ? `Aguardando há ${formatDuration(item.status.elapsedMs)}` : "Aguardando resposta"

/** Tempo de espera no semáforo; sem nível (espera desconhecida), só "aguardando". */
const WaitTime = ({ item }: { item: AttentionItem }) =>
  item.status.level && item.status.elapsedMs !== null ? (
    <span className="shrink-0 font-semibold tabular-nums">{formatWait(item.status.elapsedMs)}</span>
  ) : (
    <span className="shrink-0">aguardando</span>
  )

const chipColor = (item: AttentionItem) =>
  item.status.level ? WAIT_CHIP[item.status.level] : "bg-muted text-fg-subtle"

interface ConversationProps {
  item: AttentionItem
  active: boolean
  onOpen?: (key: string) => void
}

/**
 * Uma conversa aguardando resposta, como chip: nome do contato e há quanto tempo ele espera, na cor
 * do semáforo. Clicar abre a conversa; a que está aberta ganha um contorno.
 */
const ConversationChip = ({ item, active, onOpen }: ConversationProps) => (
  <button
    type="button"
    onClick={onOpen && (() => onOpen(item.conversation.key))}
    disabled={!onOpen}
    aria-current={active || undefined}
    title={`${item.conversation.label} · ${waitTitle(item)}${onOpen ? " · abrir a conversa" : ""}`}
    style={{ maxWidth: CHIP_MAX_WIDTH }}
    className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs transition hover:brightness-95 disabled:cursor-default dark:hover:brightness-125 ${focusRing} ${chipColor(item)} ${
      active ? "ring-2 ring-inset ring-current" : ""
    }`}>
    <span className="min-w-0 truncate font-medium">{item.conversation.label}</span>
    <WaitTime item={item} />
  </button>
)

/** A mesma conversa, como linha da lista do "+N". */
const ConversationRow = ({ item, active, onOpen }: ConversationProps) => (
  <li>
    <button
      type="button"
      onClick={onOpen && (() => onOpen(item.conversation.key))}
      disabled={!onOpen}
      aria-current={active || undefined}
      title={waitTitle(item)}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent ${focusRing} ${
        active ? "bg-muted" : ""
      }`}>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-fg">{item.conversation.label}</span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${chipColor(item)}`}>
        <WaitTime item={item} />
      </span>
    </button>
  </li>
)

/** Popover preso abaixo do botão que o abre (ou acima, quando a barra flutua no rodapé). */
const Popover = ({
  above,
  align,
  label,
  children
}: {
  above: boolean
  align: "left" | "right"
  label: string
  children: ReactNode
}) => (
  <div
    role="dialog"
    aria-label={label}
    className={`absolute z-10 w-80 overflow-hidden rounded-xl border border-line bg-surface text-fg shadow-2xl ${
      above ? "bottom-full mb-2" : "top-full mt-2"
    } ${align === "right" ? "right-0" : "left-0"}`}>
    <div className="max-h-[60vh] overflow-y-auto">{children}</div>
  </div>
)

interface Props {
  adapter: ChatAdapter
  /** Espaço livre do cabeçalho da plataforma (`useHeaderSlot`); `null` faz a barra flutuar. */
  slot: Box | null
  /** Conversa aberta agora, para destacar o chip dela. */
  activeKey: string | null
}

export const InboxBar = ({ adapter, slot, activeKey }: Props) => {
  const { day, conversations, summary, attention, alertCount, inbox, resetDay } = useDayTracking(adapter)
  // Só no dev: limpar os dados salvos exige um segundo clique, porque apaga relatórios e a cota.
  const [clearState, setClearState] = useState<
    { kind: "idle" } | { kind: "confirm" } | { kind: "done"; removed: number } | { kind: "error" }
  >({ kind: "idle" })
  const [popover, setPopover] = useState<"more" | "menu" | null>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const morePanelRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const chipsAreaRef = useRef<HTMLDivElement>(null)
  const waitingLabelRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [capacity, setCapacity] = useState(0)
  const popoverRefs = useMemo(() => [moreRef, morePanelRef, menuRef], [])
  const closePopover = useCallback(() => setPopover(null), [])
  useDismiss(popover !== null, popoverRefs, closePopover)

  // Quantos chips cabem: mede a fila inteira numa linha invisível (os nomes e tempos mudam a
  // largura de cada chip) contra o espaço da área dos chips, a cada render e quando a área muda de
  // tamanho. `setCapacity` com o mesmo valor não re-renderiza, então não entra em laço.
  const measureChips = useCallback(() => {
    const area = chipsAreaRef.current
    const measure = measureRef.current
    if (!area || !measure) return
    const padding = parseFloat(getComputedStyle(area).paddingLeft) + parseFloat(getComputedStyle(area).paddingRight)
    const label = waitingLabelRef.current?.offsetWidth ?? 0
    const available = area.clientWidth - padding - label - CHIP_GAP
    const widths = Array.from(measure.children, (chip) => (chip as HTMLElement).offsetWidth)
    setCapacity(fitCount(widths, available, CHIP_GAP, MORE_BUTTON_WIDTH))
  }, [])
  useLayoutEffect(measureChips)
  useEffect(() => {
    const area = chipsAreaRef.current
    if (!area) return
    const observer = new ResizeObserver(measureChips)
    observer.observe(area)
    return () => observer.disconnect()
  }, [measureChips])

  /** Dev: apaga o que a extensão salvou e recomeça o dia em memória, para repetir os testes. */
  const clearData = async () => {
    const removed = await clearSavedData()
    if (removed === null) {
      setClearState({ kind: "error" })
      return
    }
    resetDay()
    setClearState({ kind: "done", removed })
  }

  const openConversation = adapter.openConversation
    ? (key: string) => {
        if (adapter.openConversation?.(key)) setPopover(null)
      }
    : undefined

  const floating = slot === null
  const barWidth = slot?.width ?? Math.min(FLOATING_MAX_WIDTH, window.innerWidth - FLOATING_OFFSET.left * 2)
  const showStats = barWidth >= STATS_MIN_BAR_WIDTH
  const chips = attention.slice(0, capacity)
  const overflow = attention.slice(capacity)

  const style: CSSProperties = slot
    ? { position: "fixed", top: slot.top + (slot.height - BAR_HEIGHT) / 2, left: slot.left, width: slot.width }
    : { position: "fixed", ...FLOATING_OFFSET, width: barWidth }

  const togglePopover = (name: "more" | "menu") => setPopover((open) => (open === name ? null : name))

  const totals = (
    <>
      <span>{summary.conversations} acompanhadas</span>
      <span>{summary.answered} respondidas</span>
      {summary.averageFirstResponseMs !== null && (
        <span title="Média do tempo até a primeira resposta do vendedor">
          1ª resposta em {formatDuration(summary.averageFirstResponseMs)}
        </span>
      )}
    </>
  )

  const syncWarning = inbox.status === "error" && (
    <span
      className="text-amber-600 dark:text-amber-300"
      title="Não foi possível ler a inbox; só a conversa aberta está sendo acompanhada.">
      sem sincronizar com a inbox
    </span>
  )

  return (
    <div
      role="region"
      aria-label="Drummond: conversas do dia"
      style={style}
      className="z-50 font-sans text-fg"
      data-testid="inbox-bar">
      <div
        style={{ height: BAR_HEIGHT }}
        className={`flex items-stretch rounded-xl border border-line bg-surface ${floating ? "shadow-2xl" : "shadow-sm"}`}>
        <div className="flex shrink-0 items-center gap-2 rounded-l-[11px] bg-black pl-2.5 pr-3 text-white dark:border-r dark:border-line">
          <LogoMark className="h-[26px] w-[17px] shrink-0" />
          <span className="text-[13px] font-semibold leading-none tracking-tight">Drummond</span>
        </div>

        {showStats && (
          <div className="flex shrink-0 items-center gap-3 whitespace-nowrap border-r border-line px-3 text-[11px] text-fg-muted">
            {totals}
            {syncWarning}
          </div>
        )}

        <div ref={chipsAreaRef} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden px-3">
          <span ref={waitingLabelRef} className="flex shrink-0 items-center gap-1.5 pr-1 text-xs font-semibold text-fg">
            {summary.waiting} aguardando
            {alertCount > 0 && (
              <span
                className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
                title={`${alertCount} conversa${alertCount > 1 ? "s" : ""} aguardando em laranja ou vermelho`}>
                {alertCount}
              </span>
            )}
          </span>

          {attention.length === 0 ? (
            <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-fg-subtle">
              {conversations.length > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />}
              {conversations.length === 0 ? "Nenhuma conversa acompanhada hoje ainda" : "Ninguém aguardando resposta"}
            </span>
          ) : (
            chips.map((item) => (
              <ConversationChip
                key={item.conversation.key}
                item={item}
                active={item.conversation.key === activeKey}
                onOpen={openConversation}
              />
            ))
          )}

          {overflow.length > 0 && (
            <div ref={moreRef} className="shrink-0">
              <button
                type="button"
                onClick={() => togglePopover("more")}
                aria-expanded={popover === "more"}
                aria-haspopup="dialog"
                title={`Mais ${overflow.length} aguardando`}
                className={`flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-xs font-medium text-fg-muted transition hover:bg-muted ${focusRing}`}>
                +{overflow.length}
                <span aria-hidden="true" className="text-[10px]">
                  ▾
                </span>
              </button>
            </div>
          )}
        </div>

        <div ref={menuRef} className="relative flex shrink-0 items-center border-l border-line px-1.5">
          <button
            type="button"
            onClick={() => togglePopover("menu")}
            aria-expanded={popover === "menu"}
            aria-haspopup="dialog"
            aria-label="Mais opções do dia"
            title="Resumo do dia"
            className={`flex h-7 w-7 items-center justify-center rounded-lg text-base leading-none text-fg-muted transition hover:bg-muted hover:text-fg ${focusRing}`}>
            ⋯
          </button>

          {popover === "menu" && (
            <Popover above={floating} align="right" label="Resumo do dia">
              <div className="space-y-2 p-3 text-[11px] text-fg-muted">
                <p className="text-xs font-semibold text-fg">Hoje, {formatDayLabel(day.date)}</p>
                <p className="flex flex-wrap gap-x-3 gap-y-1">
                  {totals}
                  <span>{summary.waiting} aguardando</span>
                </p>
                {syncWarning && <p>{syncWarning}</p>}
              </div>

              {IS_DEV_BUILD && (
                <div className="space-y-1 border-t border-line p-3">
                  {clearState.kind === "confirm" ? (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void clearData()}
                        className={`flex-1 rounded-lg bg-rose-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-rose-700 ${focusRing}`}>
                        Apagar tudo (dev)
                      </button>
                      <button
                        type="button"
                        onClick={() => setClearState({ kind: "idle" })}
                        className={`rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-muted ${focusRing}`}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setClearState({ kind: "confirm" })}
                      className={`flex w-full items-center justify-center rounded-lg border border-dashed border-line bg-surface px-3 py-2 text-xs font-medium text-fg-muted transition hover:bg-muted ${focusRing}`}>
                      Limpar dados salvos (dev)
                    </button>
                  )}
                  {clearState.kind === "confirm" && (
                    <p className="text-[11px] text-fg-subtle">
                      Apaga os dias, os relatórios e a trava diária. O tema fica.
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
            </Popover>
          )}
        </div>
      </div>

      {/* Régua dos chips: a fila inteira, invisível e fora do fluxo, só para medir a largura. */}
      <div ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 flex">
        {attention.map((item) => (
          <ConversationChip key={item.conversation.key} item={item} active={false} />
        ))}
      </div>

      {/* Fora da área dos chips, que corta o que transborda; alinhada ao botão "+N". O `offsetLeft`
          do botão já é relativo à raiz da barra (`fixed`, o ancestral posicionado mais próximo). */}
      {popover === "more" && overflow.length > 0 && (
        <div
          ref={morePanelRef}
          className="absolute"
          style={{ left: moreRef.current?.offsetLeft ?? 0, top: floating ? 0 : BAR_HEIGHT }}>
          <Popover above={floating} align="left" label="Mais conversas aguardando">
            <ul className="space-y-0.5 p-1.5">
              {overflow.map((item) => (
                <ConversationRow
                  key={item.conversation.key}
                  item={item}
                  active={item.conversation.key === activeKey}
                  onOpen={openConversation}
                />
              ))}
            </ul>
          </Popover>
        </div>
      )}
    </div>
  )
}

