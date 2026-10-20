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

/** Áudios de uma conversa já preparada: quantos vão para a IA com transcrição e quantos sem. */
export interface AudioSummary {
  transcribed: number
  missing: number
}

export const audioSummary = (conversation: ChatMessage[]): AudioSummary => {
  const audios = conversation.filter((message) => message.audio)
  const transcribed = audios.filter((message) => message.transcript).length
  return { transcribed, missing: audios.length - transcribed }
}

/** Texto discreto para os rodapés: "inclui 2 áudios transcritos · 1 áudio não transcrito". */
export const describeAudio = ({ transcribed, missing }: AudioSummary): string => {
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  return [
    transcribed > 0 && `inclui ${plural(transcribed, "áudio transcrito", "áudios transcritos")}`,
    missing > 0 && plural(missing, "áudio não transcrito", "áudios não transcritos")
  ]
    .filter(Boolean)
    .join(" · ")
}
