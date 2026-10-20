import type { PlasmoMessaging } from "@plasmohq/messaging"

import { transcribeAudio } from "~lib/ai/openrouter"
import { audioFormatFromMime } from "~lib/audio/format"
import { config } from "~lib/config"
import type {
  TranscribeAudioMeta,
  TranscribeAudioRequest,
  TranscribeAudioResponse
} from "~lib/messages"
import {
  loadTranscript,
  saveTranscript,
  transcriptStorageKey,
  type TranscriptRef
} from "~lib/transcripts/store"
import { releaseTranscription, reserveTranscription } from "~lib/transcripts/quota"

// O background é o dono da cache e da chamada ao Whisper: o content script só busca o áudio na
// página (blob/URL da sessão) e manda os bytes. Duas abas pedindo o mesmo áudio compartilham a
// mesma promessa — uma única chamada ao provedor.
const inFlight = new Map<string, Promise<TranscribeAudioResponse>>()

const meta = (
  startedAt: number,
  cached: boolean,
  cost?: TranscribeAudioMeta["cost"]
): TranscribeAudioMeta => ({
  model: config.stt.model,
  durationMs: Date.now() - startedAt,
  cached,
  ...(cost && { cost })
})

const failure = (startedAt: number, error: string): TranscribeAudioResponse => ({
  ok: false,
  error,
  meta: meta(startedAt, false)
})

const transcribe = async (request: TranscribeAudioRequest): Promise<TranscribeAudioResponse> => {
  const startedAt = Date.now()
  if (!config.stt.enabled) {
    return failure(startedAt, "A transcrição de áudio está desativada nesta build.")
  }

  const { platform, conversationKey, messageKey, mimeType, audioBase64, bytes } = request
  if (!platform || !conversationKey || !messageKey || !audioBase64) {
    return failure(startedAt, "Pedido de transcrição incompleto.")
  }
  if (typeof audioBase64 !== "string" || audioBase64.length === 0) {
    return failure(startedAt, "O áudio chegou vazio.")
  }

  const ref: TranscriptRef = { platform, conversationKey, messageKey }
  const key = transcriptStorageKey(ref)
  const pending = inFlight.get(key)
  if (pending) return pending

  const task = (async (): Promise<TranscribeAudioResponse> => {
    const cached = await loadTranscript(ref)
    if (cached) {
      return { ok: true, text: cached.text, meta: meta(startedAt, true) }
    }

    const format = audioFormatFromMime(mimeType ?? "")
    if (!format) {
      return failure(
        startedAt,
        `Formato de áudio não suportado: ${mimeType?.trim() || "desconhecido"}.`
      )
    }

    // O base64 ocupa ~4/3 do áudio original; `bytes` é mais preciso quando o content script manda.
    const approxBytes = bytes ?? Math.ceil(audioBase64.length * 0.75)
    if (approxBytes > config.stt.maxBytes) {
      return failure(
        startedAt,
        `Áudio grande demais para transcrever (${Math.ceil(approxBytes / 1024)} KB; limite ${Math.ceil(config.stt.maxBytes / 1024)} KB).`
      )
    }

    // A reserva entra antes da chamada (duas abas não passam do teto juntas) e volta se o provedor
    // falhar; cache hit e validações acima não consomem cota.
    const reservation = await reserveTranscription(config.stt.dailyLimit)
    if (!reservation.ok) {
      return failure(
        startedAt,
        `Limite diário de ${reservation.limit} transcrições atingido. Tente novamente amanhã.`
      )
    }

    try {
      const result = await transcribeAudio({ audioBase64, format })
      await saveTranscript(ref, {
        text: result.text,
        at: Date.now(),
        model: config.stt.model,
        ...(result.effective?.provider && { provider: result.effective.provider }),
        mime: mimeType,
        bytes: approxBytes
      })
      const cost = config.showCosts
        ? { estimate: null, effective: result.effective }
        : undefined
      return { ok: true, text: result.text, meta: meta(startedAt, false, cost) }
    } catch (error) {
      await releaseTranscription()
      return failure(
        startedAt,
        error instanceof Error ? error.message : "Erro inesperado ao transcrever o áudio."
      )
    }
  })()

  inFlight.set(key, task)
  try {
    return await task
  } finally {
    inFlight.delete(key)
  }
}

const handler: PlasmoMessaging.MessageHandler<
  TranscribeAudioRequest,
  TranscribeAudioResponse
> = async (req, res) => {
  res.send(await transcribe(req.body ?? ({} as TranscribeAudioRequest)))
}

export default handler
