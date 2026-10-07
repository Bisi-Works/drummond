import "~style.css"

import { sendToContentScript } from "@plasmohq/messaging"
import { useLayoutEffect, useMemo, useState } from "react"

import type { ChatMessage } from "~adapters/types"
import { Wordmark } from "~components/Brand"
import { CoachingReport } from "~components/CoachingReport"
import { CostPanel } from "~components/CostPanel"
import { DayOverview } from "~components/DayOverview"
import { MetaFooter } from "~components/MetaFooter"
import { Spinner } from "~components/Spinner"
import { ThemeToggle } from "~components/ThemeToggle"
import { useTheme } from "~hooks/useTheme"
import { readPartialCoaching } from "~lib/ai/partial-report"
import { registerBrandFont } from "~lib/brand-font"
import { config } from "~lib/config"
import {
  COACH_PORT,
  GET_CONVERSATION,
  type CoachPortMessage,
  type CoachRequest,
  type CoachResponse,
  type GetConversationResponse
} from "~lib/messages"
import { coachingSignal } from "~lib/tracking/signals"
import { recordCoaching } from "~lib/tracking/store"

registerBrandFont()

type PanelState =
  | { kind: "idle" }
  | { kind: "loading"; step: string }
  /** `text`: o JSON do relatório recebido até agora. */
  | { kind: "streaming"; messageCount: number; text: string }
  | { kind: "error"; message: string }
  | { kind: "done"; messageCount: number; response: CoachResponse }

const readActiveConversation = async (): Promise<GetConversationResponse> => {
  try {
    const response = await sendToContentScript<unknown, GetConversationResponse>({
      name: GET_CONVERSATION
    })
    if (response) return response
  } catch {
    // Sem content script na aba ativa (outra página, ou a aba foi aberta antes da extensão).
  }
  throw new Error(
    "Não encontrei uma conversa do Botconversa na aba ativa. Abra uma conversa e, se a aba já estava aberta antes de instalar a extensão, recarregue a página."
  )
}

/**
 * Pede o coaching ao background por uma conexão própria: `onDelta` recebe cada trecho do relatório
 * e a promessa resolve com o resultado final. Se o painel fechar, a conexão cai e o background
 * cancela a chamada ao modelo.
 */
const requestCoaching = (conversation: ChatMessage[], onDelta: (text: string) => void) =>
  new Promise<CoachResponse>((resolve, reject) => {
    const port = chrome.runtime.connect({ name: COACH_PORT })
    let finished = false
    port.onMessage.addListener((message: CoachPortMessage) => {
      if (message.type === "delta") return onDelta(message.text)
      finished = true
      port.disconnect()
      resolve(message.response)
    })
    port.onDisconnect.addListener(() => {
      // Acontece quando a extensão é recarregada ou o service worker reinicia no meio da análise.
      if (!finished) reject(new Error("A conexão com a extensão caiu no meio da análise. Tente novamente."))
    })
    port.postMessage({ conversation } satisfies CoachRequest)
  })

const SidePanel = () => {
  const [state, setState] = useState<PanelState>({ kind: "idle" })
  const { theme, setTheme } = useTheme()
  const streamingText = state.kind === "streaming" ? state.text : ""
  const partial = useMemo(() => readPartialCoaching(streamingText), [streamingText])

  const analyze = async () => {
    try {
      setState({ kind: "loading", step: "Lendo a conversa…" })
      const { conversation, conversationKey } = await readActiveConversation()
      if (conversation.length === 0) {
        throw new Error("A conversa aberta não tem mensagens visíveis para analisar.")
      }

      const messageCount = conversation.length
      setState({ kind: "streaming", messageCount, text: "" })
      const response = await requestCoaching(conversation, (delta) =>
        setState((prev) =>
          prev.kind === "streaming" ? { ...prev, text: prev.text + delta } : prev
        )
      )
      setState({ kind: "done", messageCount, response })
      // A análise já foi feita: só se anexa o sinal à conversa lida, sem chamada de IA nova.
      if (response.ok && conversationKey) {
        void recordCoaching(conversationKey, coachingSignal(response.data, Date.now()))
      }
    } catch (error) {
      setState({ kind: "error", message: error instanceof Error ? error.message : String(error) })
    }
  }

  // Na raiz do documento (e não num wrapper) para a barra de rolagem acompanhar o tema. Layout
  // effect: aplica antes da primeira pintura, sem piscar o tema claro.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  const loading = state.kind === "loading" || state.kind === "streaming"

  return (
    <main className="flex min-h-screen flex-col bg-surface font-sans text-fg">
      <header className="sticky top-0 z-10 space-y-3 border-b border-line bg-black px-4 pb-4 pt-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <Wordmark as="h1" />
            <p className="text-xs text-gray-400">Coaching das mensagens enviadas na conversa aberta.</p>
          </div>
          <div className="-mr-1.5 -mt-1">
            <ThemeToggle theme={theme} onChange={setTheme} />
          </div>
        </div>
        <button
          type="button"
          onClick={analyze}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-wait disabled:opacity-70">
          {loading && <Spinner />}
          {state.kind === "done" ? "Analisar novamente" : "Analisar conversa atual"}
        </button>
      </header>

      <div className="flex-1 space-y-4 px-4 py-4">
        <DayOverview />

        <hr className="border-line" />

        {state.kind === "idle" && (
          <p className="text-sm text-fg-muted">
            Abra uma conversa no Botconversa e clique em “Analisar conversa atual”. A análise considera
            só as mensagens do vendedor e sugere melhorias prontas para usar.
          </p>
        )}
        {state.kind === "loading" && <p className="text-sm text-fg-muted">{state.step}</p>}
        {state.kind === "streaming" && (
          <>
            <p className="text-sm text-fg-muted" aria-live="polite">
              {state.text
                ? "Escrevendo a análise…"
                : `Analisando ${state.messageCount} mensagens…`}
            </p>
            <CoachingReport report={partial} streaming />
          </>
        )}
        {state.kind === "error" && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-500/15 dark:text-rose-200">{state.message}</p>
        )}
        {state.kind === "done" &&
          (state.response.ok ? (
            <CoachingReport report={state.response.data} />
          ) : (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-500/15 dark:text-rose-200">{state.response.error}</p>
          ))}
      </div>

      {state.kind === "done" && (
        <footer className="space-y-2 border-t border-line px-4 py-2">
          {config.showCosts && state.response.meta.cost && <CostPanel cost={state.response.meta.cost} />}
          <p className="text-[11px] text-fg-subtle">{state.messageCount} mensagens analisadas</p>
          <MetaFooter meta={state.response.meta} />
        </footer>
      )}
    </main>
  )
}

export default SidePanel
