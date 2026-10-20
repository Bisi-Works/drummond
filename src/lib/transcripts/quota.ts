import { localArea } from "~lib/chrome-storage"

// Teto diário de transcrições. A reserva é feita antes da chamada ao provedor e devolvida quando a
// chamada falha, para o limite nunca ser consumido por erro; cache hit não passa por aqui. Sem
// storage a cota não bloqueia: o objetivo é evitar gasto inesperado, não derrubar o recurso.

export const TRANSCRIPTION_QUOTA_KEY = "drummond.transcript.quota.v1"

/** Limite padrão por dia (custo do Whisper é baixo; o teto existe só como trava de segurança). */
export const TRANSCRIPTION_DAILY_LIMIT = 1000

export interface TranscriptionQuota {
  /** Dia local no formato `YYYY-MM-DD`. */
  date: string
  used: number
}

export type TranscriptionReservation =
  | { ok: true; used: number; limit: number }
  | { ok: false; used: number; limit: number }

/** Dia local (o vendedor pensa em "hoje" no fuso dele, não em UTC). */
export const quotaDay = (now = Date.now()): string => {
  const date = new Date(now)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${date.getFullYear()}-${month}-${day}`
}

const toUsed = (value: unknown): number => {
  if (!value || typeof value !== "object") return 0
  const used = (value as { used?: unknown }).used
  return typeof used === "number" && Number.isFinite(used) && used > 0 ? Math.floor(used) : 0
}

const sameDay = (value: unknown, day: string): boolean =>
  !!value && typeof value === "object" && (value as { date?: unknown }).date === day

/**
 * Serializa leitura+escrita: duas transcrições concorrentes no background não podem ler o mesmo
 * contador e gravar por cima uma da outra. A fila nunca fica "envenenada": erros são absorvidos.
 */
let queue: Promise<unknown> = Promise.resolve()

const serialize = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

const readQuota = async (day: string): Promise<TranscriptionQuota> => {
  const area = localArea()
  if (!area) return { date: day, used: 0 }
  try {
    const items = await area.get(TRANSCRIPTION_QUOTA_KEY)
    const stored = items?.[TRANSCRIPTION_QUOTA_KEY]
    return { date: day, used: sameDay(stored, day) ? toUsed(stored) : 0 }
  } catch {
    return { date: day, used: 0 }
  }
}

/**
 * Reserva uma transcrição do dia. `ok: false` quando o teto já foi atingido; quem chamou deve
 * devolver a reserva com `releaseTranscription` se a chamada ao provedor falhar. Indisponibilidade
 * de storage libera (a cota é uma trava de custo, não uma dependência).
 */
export const reserveTranscription = (
  limit = TRANSCRIPTION_DAILY_LIMIT,
  now = Date.now()
): Promise<TranscriptionReservation> =>
  serialize(async () => {
    const day = quotaDay(now)
    const current = await readQuota(day)
    if (current.used >= limit) return { ok: false, used: current.used, limit }

    const used = current.used + 1
    const area = localArea()
    if (area) {
      try {
        await area.set({ [TRANSCRIPTION_QUOTA_KEY]: { date: day, used } })
      } catch {
        // Sem storage a reserva vale só em memória; não bloqueia a transcrição.
      }
    }
    return { ok: true, used, limit }
  })

/** Devolve uma reserva que não virou chamada bem-sucedida ao provedor. */
export const releaseTranscription = (now = Date.now()): Promise<void> =>
  serialize(async () => {
    const area = localArea()
    if (!area) return
    const day = quotaDay(now)
    const current = await readQuota(day)
    if (current.used <= 0) return
    try {
      await area.set({ [TRANSCRIPTION_QUOTA_KEY]: { date: day, used: current.used - 1 } })
    } catch {
      // Best-effort: perder uma devolução só custa uma unidade da cota.
    }
  })
