import { sendToBackground } from "@plasmohq/messaging"
import cssText from "data-text:~style.css"
import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import { useCallback, useEffect, useRef, useState } from "react"

import { getAdapter } from "~adapters"
import type { ReviewDraftRequest, ReviewDraftResponse } from "~background/messages/review-draft"
import { GlassesMark } from "~components/Brand"
import { DayWidget } from "~components/DayWidget"
import { PitacoDrawer, PitacoMark } from "~components/PitacoDrawer"
import { Spinner } from "~components/Spinner"
import { SuggestionCard, type ReviewState } from "~components/SuggestionCard"
import { useComposerState, type Box } from "~hooks/useComposerState"
import { usePitaco } from "~hooks/usePitaco"
import { useTheme } from "~hooks/useTheme"
import { PROMPT_VERSION } from "~lib/ai/prompts"
import { registerBrandFont } from "~lib/brand-font"
import { config as appConfig } from "~lib/config"
import { GET_CONVERSATION, type GetConversationResponse } from "~lib/messages"
import { reviewSignal } from "~lib/tracking/signals"
import { recordReview } from "~lib/tracking/store"
import { prepareConversation } from "~lib/transcripts/ensure"

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
/**
 * Drawer do Pitaco: preso à direita, na altura inteira. Ocupa o espaço à direita do campo de texto
 * (o painel "Perfil" do Botconversa) para não cobrir o botão de enviar, entre o mínimo e o máximo
 * abaixo, e nunca passa da tela menos a margem.
 */
const DRAWER_WIDTH = 400
const DRAWER_MIN_WIDTH = 320
const DRAWER_GAP = 8
const DRAWER_MARGIN = 32

const drawerWidth = (frame: Box | null) => {
  const room = frame ? window.innerWidth - frame.right - DRAWER_GAP : DRAWER_WIDTH
  const width = Math.min(DRAWER_WIDTH, Math.max(DRAWER_MIN_WIDTH, room))
  return Math.min(width, window.innerWidth - DRAWER_MARGIN)
}

const pillBase =
  "flex items-center gap-1.5 rounded-full border pl-2.5 pr-3 text-xs font-medium shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"

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
  const pitaco = usePitaco(adapter, conversationKey)

  useEffect(() => {
    requestId.current++
    setReview({ kind: "idle" })
  }, [conversationKey])

  const dismiss = useCallback(() => {
    requestId.current++
    setReview({ kind: "idle" })
    setApplyError(null)
  }, [])

  // Esc fecha o que estiver aberto (o card do Revisar e o drawer do Pitaco nunca abrem juntos).
  // Clicar fora não fecha o drawer: o vendedor consulta o Pitaco enquanto escreve no campo.
  const closePitaco = pitaco.close
  useEffect(() => {
    if (review.kind === "idle" && !pitaco.isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      dismiss()
      closePitaco()
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [review.kind, pitaco.isOpen, dismiss, closePitaco])

  const togglePitaco = () => {
    if (pitaco.isOpen) return pitaco.close()
    dismiss()
    pitaco.open()
  }

  const runReview = async () => {
    if (!adapter) return
    const text = adapter.readDraft()
    if (!text.trim()) return
    pitaco.close()

    // Conversa da revisão no momento do clique: se o vendedor trocar de conversa antes da
    // resposta, o sinal ainda é anexado à conversa certa.
    const key = conversationKey
    const id = ++requestId.current
    setReview({ kind: "loading" })
    setApplyError(null)
    let response: ReviewDraftResponse
    try {
      // A revisão também enxerga o conteúdo dos áudios: o cache por mensagem evita transcrever o
      // mesmo áudio de novo em cada clique.
      const rawConversation = adapter.readConversation(appConfig.contextMessages)
      const prepared = key ? await prepareConversation(adapter, rawConversation, key) : null
      if (id !== requestId.current) return
      response = await sendToBackground<ReviewDraftRequest, ReviewDraftResponse>({
        name: "review-draft",
        body: { conversation: prepared?.conversation ?? rawConversation, draft: text }
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

  // Só o adapter é indispensável: o widget do dia existe mesmo sem conversa aberta (o campo de
  // texto pode não estar montado). O botão "Revisar" e o card continuam presos ao campo.
  if (!adapter) return null

  const composerFrame = composer && frame
  const hasDraft = draft.trim().length > 0
  const cardWidth = composerFrame
    ? Math.min(CARD_MAX_WIDTH, Math.max(composerFrame.width, CARD_MIN_WIDTH))
    : CARD_MAX_WIDTH

  return (
    <div className={theme === "dark" ? "dark font-sans" : "font-sans"}>
      <DayWidget adapter={adapter} />

      {composerFrame && (
        <>
          <div
            style={{
              position: "fixed",
              height: BUTTON_HEIGHT,
              ...buttonPosition(composerFrame, buttonAnchor)
            }}
            className="flex items-stretch gap-1.5">
            <button
              type="button"
              onClick={review.kind === "idle" ? runReview : dismiss}
              disabled={!hasDraft && review.kind === "idle"}
              title={hasDraft ? "Revisar a mensagem com IA" : "Digite uma mensagem para revisar"}
              className={`${pillBase} border-black bg-black text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-white disabled:text-gray-400 disabled:shadow-none`}>
              {review.kind === "loading" ? (
                <Spinner className="h-3.5 w-3.5" />
              ) : (
                <GlassesMark className="h-[11px] w-[18px]" />
              )}
              {copied ? "Copiado ✓" : review.kind === "idle" ? "Revisar" : "Fechar"}
            </button>
            <button
              type="button"
              onClick={togglePitaco}
              aria-pressed={pitaco.isOpen}
              title={pitaco.isOpen ? "Fechar o Pitaco" : "Pitaco: por onde seguir a conversa (SPIN)"}
              className={`${pillBase} border-black ${
                pitaco.isOpen ? "bg-black text-white hover:bg-gray-800" : "bg-white text-black hover:bg-gray-100"
              }`}>
              <PitacoMark />
              Pitaco
            </button>
          </div>

          {review.kind !== "idle" && (
            <div
              style={{
                position: "fixed",
                bottom: window.innerHeight - composerFrame.top + CARD_GAP,
                right: window.innerWidth - composerFrame.right,
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
        </>
      )}

      {/* Acima do widget do dia (z-50): enquanto o drawer está aberto, ele cobre o widget sem mexer
          na posição salva pelo vendedor. */}
      {pitaco.isOpen && (
        <div
          className="z-[60]"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: drawerWidth(composerFrame || null)
          }}>
          <PitacoDrawer
            state={pitaco.state}
            contactName={adapter.getContactName?.()}
            onRefresh={pitaco.refresh}
            onClose={pitaco.close}
          />
        </div>
      )}
    </div>
  )
}

export default Companion
