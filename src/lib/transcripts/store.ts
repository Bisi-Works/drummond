import { localArea } from "~lib/chrome-storage"

import { TRANSCRIPT_PREFIX, TRANSCRIPT_TTL_MS } from "./constants"

// Cache de transcrição por mensagem. A chave usa a `messageKey` estável da plataforma, não o `id`
// ordinal do prompt: assim o mesmo áudio é transcrito uma única vez, independentemente do recorte
// de `readConversation(limit)` ou de quantas vezes o vendedor troca de conversa e volta.

export const TRANSCRIPT_VERSION = 1 as const

export interface TranscriptRef {
  /** `id` do adapter (ex.: "botconversa"). */
  platform: string
  /** `getConversationKey()` do adapter; evita colisão de ids entre chats. */
  conversationKey: string
  /** Identificador estável da mensagem na plataforma. */
  messageKey: string
}

export interface StoredTranscript {
  version: typeof TRANSCRIPT_VERSION
  text: string
  /** Quando a transcrição foi gravada (epoch ms). */
  at: number
  /** Modelo usado (ex.: "openai/whisper-large-v3-turbo"). */
  model: string
  /** Provedor que atendeu a chamada, quando o OpenRouter informa. */
  provider?: string
  /** Mime do áudio transcrito. */
  mime?: string
  /** Tamanho do áudio em bytes. */
  bytes?: number
}

const segment = (value: string) => encodeURIComponent(value)

/** Chave única da transcrição de uma mensagem. */
export const transcriptStorageKey = ({
  platform,
  conversationKey,
  messageKey
}: TranscriptRef): string =>
  `${TRANSCRIPT_PREFIX}${segment(platform)}.${segment(conversationKey)}.${segment(messageKey)}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

/** Normaliza o que veio do storage; `null` quando o formato não é o esperado. */
export const toStoredTranscript = (value: unknown): StoredTranscript | null => {
  if (!isRecord(value)) return null
  const { version, text, at, model, provider, mime, bytes } = value
  if (version !== TRANSCRIPT_VERSION) return null
  if (typeof text !== "string" || !text.trim()) return null
  if (typeof at !== "number" || !Number.isFinite(at)) return null
  if (typeof model !== "string" || !model.trim()) return null
  return {
    version: TRANSCRIPT_VERSION,
    text: text.trim(),
    at,
    model,
    ...(typeof provider === "string" && provider.trim() && { provider }),
    ...(typeof mime === "string" && mime.trim() && { mime }),
    ...(typeof bytes === "number" && Number.isFinite(bytes) && { bytes })
  }
}

/** Lê a transcrição de uma mensagem; `null` sem storage, cache ausente ou dado corrompido. */
export const loadTranscript = async (ref: TranscriptRef): Promise<StoredTranscript | null> => {
  const area = localArea()
  if (!area) return null
  const key = transcriptStorageKey(ref)
  try {
    const items = await area.get(key)
    return toStoredTranscript(items?.[key])
  } catch {
    return null
  }
}

/**
 * Lê várias transcrições de uma vez (mesma conversa e plataforma), devolvendo um mapa por
 * `messageKey`. Mensagens sem cache ou com dado inválido simplesmente não aparecem.
 */
export const loadTranscripts = async (
  refs: TranscriptRef[]
): Promise<Record<string, string>> => {
  const area = localArea()
  if (!area || refs.length === 0) return {}

  const entries = refs
    .filter((ref) => ref.messageKey)
    .map((ref) => ({ ref, key: transcriptStorageKey(ref) }))
  if (entries.length === 0) return {}

  try {
    const items = await area.get(entries.map(({ key }) => key))
    const texts: Record<string, string> = {}
    for (const { ref, key } of entries) {
      const stored = toStoredTranscript(items?.[key])
      if (stored) texts[ref.messageKey] = stored.text
    }
    return texts
  } catch {
    return {}
  }
}

/**
 * Grava a transcrição de uma mensagem. `false` quando não há storage, o texto está vazio ou a
 * escrita falhou — quem chama não deve tratar como sucesso.
 */
export const saveTranscript = async (
  ref: TranscriptRef,
  input: Omit<StoredTranscript, "version">
): Promise<boolean> => {
  const area = localArea()
  if (!area) return false
  const stored = toStoredTranscript({ version: TRANSCRIPT_VERSION, ...input })
  if (!stored) return false
  try {
    await area.set({ [transcriptStorageKey(ref)]: stored })
    return true
  } catch {
    return false
  }
}

/**
 * Remove transcrições vencidas e entradas inválidas do namespace. Devolve quantas chaves saíram;
 * `0` quando não há storage ou a limpeza falha (não é um erro fatal).
 */
export const pruneTranscripts = async (
  now = Date.now(),
  maxAgeMs = TRANSCRIPT_TTL_MS
): Promise<number> => {
  const area = localArea()
  if (!area) return 0
  try {
    const all = await area.get(null)
    const expired = Object.entries(all ?? {})
      .filter(([key]) => key.startsWith(TRANSCRIPT_PREFIX))
      .filter(([, value]) => {
        const stored = toStoredTranscript(value)
        return !stored || stored.at < now - maxAgeMs
      })
      .map(([key]) => key)
    if (expired.length === 0) return 0
    await area.remove(expired)
    return expired.length
  } catch {
    return 0
  }
}
