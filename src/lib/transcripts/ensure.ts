import { sendToBackground } from "@plasmohq/messaging"

import type { ChatAdapter, ChatMessage } from "~adapters/types"
import { blobToBase64 } from "~lib/audio/base64"
import { config } from "~lib/config"
import {
  TRANSCRIBE_AUDIO,
  type TranscribeAudioRequest,
  type TranscribeAudioResponse
} from "~lib/messages"

import { applyTranscripts, audioWithoutTranscript, transcriptRefs } from "./prepare"
import { loadTranscripts, transcriptStorageKey, type TranscriptRef } from "./store"

// Prepara a conversa para os recursos de IA: carrega o cache de transcrições e transcreve somente
// os áudios que faltam. Roda no content script (tem o adapter e a página), mas a chamada ao
// Whisper é sempre do background. Falha de um áudio nunca derruba a análise.

export interface TranscriptProgress {
  total: number
  done: number
  failed: number
}

export interface PreparedConversation {
  conversation: ChatMessage[]
  /** Áudios que precisavam de transcrição. */
  total: number
  /** Áudios transcritos nesta chamada. */
  transcribed: number
  /** Áudios que já estavam no cache. */
  cached: number
  failed: number
}

/** Requisições em andamento no content script: dois recursos pedindo o mesmo áudio não duplicam. */
const inFlight = new Map<string, Promise<string | null>>()

/** Executa `fn` com no máximo `limit` promessas ao mesmo tempo, preservando a ordem dos resultados. */
const mapLimit = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const current = index++
      if (current >= items.length) return
      results[current] = await fn(items[current])
    }
  })
  await Promise.all(workers)
  return results
}

const transcribeOne = async (
  adapter: ChatAdapter,
  ref: TranscriptRef
): Promise<string | null> => {
  try {
    if (!adapter.readAudio) return null
    const source = await adapter.readAudio(ref.messageKey)
    if (!source || source.blob.size === 0 || source.blob.size > config.stt.maxBytes) return null

    const audioBase64 = await blobToBase64(source.blob)
    const response = await sendToBackground<TranscribeAudioRequest, TranscribeAudioResponse>({
      name: TRANSCRIBE_AUDIO,
      body: {
        ...ref,
        mimeType: source.mimeType,
        audioBase64,
        bytes: source.blob.size
      }
    })
    return response.ok ? response.text : null
  } catch {
    // Extensão recarregada, áudio removido da página, formato recusado etc.: a análise segue sem
    // a transcrição, com o marcador `[áudio]` que a IA já sabe que não pode interpretar.
    return null
  }
}

/**
 * Devolve a conversa com as transcrições disponíveis. `onProgress` é chamado antes de começar e a
 * cada áudio concluído, para a UI mostrar "transcrevendo X de Y".
 */
export const prepareConversation = async (
  adapter: ChatAdapter,
  conversation: ChatMessage[],
  conversationKey: string,
  onProgress?: (progress: TranscriptProgress) => void
): Promise<PreparedConversation> => {
  const refs = transcriptRefs(adapter.id, conversationKey, conversation)
  const cached = await loadTranscripts(refs)
  let next = applyTranscripts(conversation, cached)

  const missing = audioWithoutTranscript(next)
  const cachedCount = refs.length - missing.length
  if (!config.stt.enabled || !adapter.readAudio || missing.length === 0) {
    return { conversation: next, total: missing.length, transcribed: 0, cached: cachedCount, failed: 0 }
  }

  let done = 0
  let failed = 0
  const report = () => onProgress?.({ total: missing.length, done, failed })
  report()

  await mapLimit(missing, 2, async (message) => {
    const ref: TranscriptRef = {
      platform: adapter.id,
      conversationKey,
      messageKey: message.messageKey!
    }
    const key = transcriptStorageKey(ref)
    let pending = inFlight.get(key)
    if (!pending) {
      pending = transcribeOne(adapter, ref)
      inFlight.set(key, pending)
      void pending.finally(() => inFlight.delete(key))
    }

    const transcript = await pending
    done++
    if (transcript) {
      next = next.map((item) =>
        item.messageKey === message.messageKey ? { ...item, transcript } : item
      )
    } else {
      failed++
    }
    report()
  })

  return {
    conversation: next,
    total: missing.length,
    transcribed: missing.length - failed,
    cached: cachedCount,
    failed
  }
}
