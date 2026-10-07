import { useEffect, useState } from "react"

import type { ChatAdapter } from "~adapters/types"

export interface Box {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface ComposerState {
  composer: HTMLElement | null
  /** Caixa visual do campo na viewport; null quando não há campo visível. */
  frame: Box | null
  /** Elemento à direita do qual o botão "Revisar" fica, quando o adapter informa um. */
  buttonAnchor: Box | null
  draft: string
  conversationKey: string | null
}

const EMPTY: ComposerState = {
  composer: null,
  frame: null,
  buttonAnchor: null,
  draft: "",
  conversationKey: null
}

const toBox = (el: Element | null | undefined): Box | null => {
  const r = el?.getBoundingClientRect()
  if (!r || r.width === 0 || r.height === 0) return null
  return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b ||
  (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)

const sameState = (a: ComposerState, b: ComposerState) =>
  a.composer === b.composer &&
  a.draft === b.draft &&
  a.conversationKey === b.conversationKey &&
  sameBox(a.frame, b.frame) &&
  sameBox(a.buttonAnchor, b.buttonAnchor)

/**
 * Acompanha o campo de texto da plataforma. Usa polling leve (SPAs trocam o DOM sem aviso ao
 * mudar de conversa) somado a resize/scroll/input para o botão acompanhar o layout sem atraso.
 */
export const useComposerState = (adapter: ChatAdapter | null, intervalMs = 300) => {
  const [state, setState] = useState<ComposerState>(EMPTY)

  useEffect(() => {
    if (!adapter) return

    const tick = () => {
      const composer = adapter.getComposer()
      const frame = toBox(adapter.getComposerFrame?.() ?? composer)
      const visible = !!composer && !!frame
      const next: ComposerState = {
        composer: visible ? composer : null,
        frame: visible ? frame : null,
        buttonAnchor: visible ? toBox(adapter.getButtonAnchor?.()) : null,
        draft: visible ? adapter.readDraft() : "",
        conversationKey: adapter.getConversationKey()
      }
      setState((prev) => (sameState(prev, next) ? prev : next))
    }

    tick()
    const interval = setInterval(tick, intervalMs)
    window.addEventListener("resize", tick)
    window.addEventListener("scroll", tick, true)
    document.addEventListener("input", tick, true)
    return () => {
      clearInterval(interval)
      window.removeEventListener("resize", tick)
      window.removeEventListener("scroll", tick, true)
      document.removeEventListener("input", tick, true)
    }
  }, [adapter, intervalMs])

  return state
}
