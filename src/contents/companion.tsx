import { sendToBackground } from "@plasmohq/messaging"
import cssText from "data-text:~style.css"
import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import { useCallback, useEffect, useRef, useState } from "react"

import { getAdapter } from "~adapters"
import type { ReviewDraftRequest, ReviewDraftResponse } from "~background/messages/review-draft"
import { GlassesMark } from "~components/Brand"
import { Spinner } from "~components/Spinner"
import { SuggestionCard, type ReviewState } from "~components/SuggestionCard"
import { useComposerState, type Box } from "~hooks/useComposerState"
import { useTheme } from "~hooks/useTheme"
import { PROMPT_VERSION } from "~lib/ai/prompts"
import { registerBrandFont } from "~lib/brand-font"
import { config as appConfig } from "~lib/config"
import { GET_CONVERSATION, type GetConversationResponse } from "~lib/messages"
import { reviewSignal } from "~lib/tracking/signals"
import { recordReview } from "~lib/tracking/store"

// Precisa listar os mesmos domínios que os `hosts` dos adapters (o Plasmo lê este objeto estaticamente).
export const config: PlasmoCSConfig = {
  matches: ["https://app.botconversa.com.br/*"]
}

// A UI roda num shadow DOM: o CSS do Tailwind é injetado nele, isolado do CSS da página.
export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = cssText.replaceAll(":root", ":host(plasmo-csui)")
  return style
}

const adapter = getAdapter(location.hostname)
if (adapter) registerBrandFont()

// Responde ao side panel com a conversa aberta. Listener síncrono: só responde ao próprio nome.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.name !== GET_CONVERSATION || !adapter) return
  const response: GetConversationResponse = {
    platform: adapter.id,
    conversationKey: adapter.getConversationKey(),
    conversation: adapter.readConversation(appConfig.coachMessages)
  }
  sendResponse(response)
})

const CARD_MAX_WIDTH = 440
const CARD_MIN_WIDTH = 320
const CARD_GAP = 8
const BUTTON_HEIGHT = 28
const BUTTON_GAP = 8

// Na barra do campo, logo à direita da âncora (espaço livre); sem âncora, flutua acima do campo.
const buttonPosition = (frame: Box, anchor: Box | null) =>
  anchor
    ? { top: anchor.top + (anchor.height - BUTTON_HEIGHT) / 2, left: anchor.right + BUTTON_GAP }
    : { top: frame.top - BUTTON_HEIGHT - BUTTON_GAP, right: window.innerWidth - frame.right }

const APPLY_FAILED =
  "Não consegui inserir o texto no campo automaticamente. Use “Copiar” e cole a mensagem no campo."

const failure = (error: string): ReviewDraftResponse => ({
  ok: false,
  error,
  meta: { model: appConfig.review.model, promptVersion: PROMPT_VERSION, durationMs: 0 }
})

const Companion = () => {
  const { composer, frame, buttonAnchor, draft, conversationKey } = useComposerState(adapter)
  // Só lê: o tema é trocado no painel lateral e chega aqui pelo chrome.storage.
  const { theme } = useTheme()
  const [review, setReview] = useState<ReviewState>({ kind: "idle" })
  const [copied, setCopied] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  // Descarta respostas que chegam depois de trocar de conversa ou de uma nova revisão.
  const requestId = useRef(0)

  useEffect(() => {
    requestId.current++
    setReview({ kind: "idle" })
  }, [conversationKey])

  const dismiss = useCallback(() => {
    requestId.current++
    setReview({ kind: "idle" })
    setApplyError(null)
  }, [])

  useEffect(() => {
    if (review.kind === "idle") return
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && dismiss()
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [review.kind, dismiss])

  const runReview = async () => {
    if (!adapter) return
    const text = adapter.readDraft()
    if (!text.trim()) return

    // Conversa da revisão no momento do clique: se o vendedor trocar de conversa antes da
    // resposta, o sinal ainda é anexado à conversa certa.
    const key = conversationKey
    const id = ++requestId.current
    setReview({ kind: "loading" })
    setApplyError(null)
    let response: ReviewDraftResponse
    try {
      response = await sendToBackground<ReviewDraftRequest, ReviewDraftResponse>({
        name: "review-draft",
        body: { conversation: adapter.readConversation(appConfig.contextMessages), draft: text }
      })
    } catch {
      // Acontece quando a extensão é recarregada com a página aberta.
      response = failure("A extensão foi atualizada. Recarregue a página do Botconversa.")
    }
    if (id === requestId.current) setReview({ kind: "done", draft: text, response })
    // A revisão já foi feita: só se anexa o que a extensão já produziu, sem chamada de IA nova.
    if (response.ok && key) void recordReview(key, reviewSignal(response.data, Date.now()))
  }

  // Só fecha o card se o texto realmente entrou no campo; senão mantém a sugestão e explica.
  const apply = async (text: string) => {
    const applied = (await adapter?.writeDraft(text)) ?? false
    if (applied) dismiss()
    else setApplyError(APPLY_FAILED)
  }

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!adapter || !composer || !frame) return null

  const hasDraft = draft.trim().length > 0
  const cardWidth = Math.min(CARD_MAX_WIDTH, Math.max(frame.width, CARD_MIN_WIDTH))

  return (
    <div className={theme === "dark" ? "dark font-sans" : "font-sans"}>
      <button
        type="button"
        onClick={review.kind === "idle" ? runReview : dismiss}
        disabled={!hasDraft && review.kind === "idle"}
        title={hasDraft ? "Revisar a mensagem com IA" : "Digite uma mensagem para revisar"}
        style={{ position: "fixed", height: BUTTON_HEIGHT, ...buttonPosition(frame, buttonAnchor) }}
        className="flex items-center gap-1.5 rounded-full border border-black bg-black pl-2.5 pr-3 text-xs font-medium text-white shadow-sm transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-white disabled:text-gray-400 disabled:shadow-none">
        {review.kind === "loading" ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : (
          <GlassesMark className="h-[11px] w-[18px]" />
        )}
        {copied ? "Copiado ✓" : review.kind === "idle" ? "Revisar" : "Fechar"}
      </button>

      {review.kind !== "idle" && (
        <div
          style={{
            position: "fixed",
            bottom: window.innerHeight - frame.top + CARD_GAP,
            right: window.innerWidth - frame.right,
            width: cardWidth
          }}>
          <SuggestionCard
            state={review}
            currentDraft={draft}
            applyError={applyError}
            onApply={apply}
            onCopy={copy}
            onRetry={runReview}
            onDismiss={dismiss}
          />
        </div>
      )}
    </div>
  )
}

export default Companion
