import { sendToBackground } from "@plasmohq/messaging"
import { useCallback, useEffect, useRef, useState } from "react"

import type { ChatAdapter } from "~adapters/types"
import { PROMPT_VERSION } from "~lib/ai/prompts"
import { config } from "~lib/config"
import { GENERATE_PITACO, type GeneratePitacoRequest, type GeneratePitacoResponse } from "~lib/messages"
import { prepareConversation } from "~lib/transcripts/ensure"
import { audioSummary, type AudioSummary } from "~lib/transcripts/prepare"

export type PitacoState =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "transcribing"; done: number; total: number }
  | { kind: "generating" }
  /** A conversa não tem mensagem do cliente nem do vendedor: não há o que orientar. */
  | { kind: "empty" }
  | { kind: "done"; response: GeneratePitacoResponse; at: number; audio: AudioSummary }

// Último Pitaco de cada conversa enquanto a página está aberta: reabrir o drawer mostra o resultado
// na hora, sem nova chamada paga. O "Atualizar Pitaco" gera de novo.
const lastByConversation = new Map<string, Extract<PitacoState, { kind: "done" }>>()

const failure = (error: string): GeneratePitacoResponse => ({
  ok: false,
  error,
  meta: { model: config.pitaco.model, promptVersion: PROMPT_VERSION, durationMs: 0 }
})

/**
 * Estado do drawer do Pitaco. Gera só quando o vendedor pede (`open` sem resultado guardado ou
 * `refresh`); trocar de conversa descarta a resposta em andamento e mostra o Pitaco guardado da
 * nova conversa, se houver.
 */
export const usePitaco = (adapter: ChatAdapter | null, conversationKey: string | null) => {
  const [isOpen, setIsOpen] = useState(false)
  const [state, setState] = useState<PitacoState>({ kind: "idle" })
  // Descarta respostas que chegam depois de trocar de conversa, fechar ou atualizar de novo.
  const requestId = useRef(0)

  useEffect(() => {
    requestId.current++
    setState((conversationKey && lastByConversation.get(conversationKey)) || { kind: "idle" })
  }, [conversationKey])

  const generate = useCallback(async () => {
    if (!adapter) return
    // Conversa do clique: se o vendedor trocar de conversa antes da resposta, ela é descartada.
    const key = conversationKey
    const id = ++requestId.current
    const current = () => id === requestId.current

    setState({ kind: "reading" })
    const raw = adapter.readConversation(config.coachMessages)
    if (!raw.some((m) => m.author === "cliente" || m.author === "vendedor")) {
      setState({ kind: "empty" })
      return
    }

    let response: GeneratePitacoResponse
    let conversation = raw
    try {
      if (key) {
        const prepared = await prepareConversation(adapter, raw, key, ({ done, total }) => {
          if (current()) setState({ kind: "transcribing", done, total })
        })
        conversation = prepared.conversation
      }
      if (!current()) return
      setState({ kind: "generating" })
      response = await sendToBackground<GeneratePitacoRequest, GeneratePitacoResponse>({
        name: GENERATE_PITACO,
        body: { conversation }
      })
    } catch {
      // Acontece quando a extensão é recarregada com a página aberta.
      response = failure("A extensão foi atualizada. Recarregue a página do Botconversa.")
    }
    if (!current()) return

    const done = { kind: "done" as const, response, at: Date.now(), audio: audioSummary(conversation) }
    if (key && response.ok) lastByConversation.set(key, done)
    setState(done)
  }, [adapter, conversationKey])

  const open = useCallback(() => {
    setIsOpen(true)
    const saved = conversationKey ? lastByConversation.get(conversationKey) : undefined
    if (saved) setState(saved)
    else void generate()
  }, [conversationKey, generate])

  const close = useCallback(() => {
    setIsOpen(false)
    // Uma geração em andamento continua só se ninguém a descartar: fechar o drawer não cancela a
    // chamada (já paga), e o resultado fica guardado para a próxima abertura.
  }, [])

  return { isOpen, state, open, close, refresh: generate }
}
