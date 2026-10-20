import type { ChatMessage } from "~adapters/types"

import type { TranscriptRef } from "./store"

// Funções puras de preparação da conversa. Ficam separadas do `ensure.ts` (que importa o messaging
// e o adapter) para serem testáveis sem navegador.

/** Mensagens de áudio que ainda não têm transcrição em cache nem no próprio objeto. */
export const audioWithoutTranscript = (conversation: ChatMessage[]): ChatMessage[] =>
  conversation.filter((message) => message.audio && message.messageKey && !message.transcript)

/** Referências de cache para os áudios que precisam ser transcritos. */
export const transcriptRefs = (
  platform: string,
  conversationKey: string,
  conversation: ChatMessage[]
): TranscriptRef[] =>
  audioWithoutTranscript(conversation).map((message) => ({
    platform,
    conversationKey,
    messageKey: message.messageKey!
  }))

/** Aplica o mapa `messageKey -> texto` sem tocar nas outras mensagens. */
export const applyTranscripts = (
  conversation: ChatMessage[],
  transcripts: Record<string, string>
): ChatMessage[] =>
  conversation.map((message) => {
    if (!message.messageKey || message.transcript) return message
    const transcript = transcripts[message.messageKey]
    if (!transcript) return message
    return { ...message, transcript }
  })
