import { WAIT_LIMITS_MS } from "./constants"
import type { TrackedConversation, WaitLevel } from "./types"

// Funções puras do dia: data local, semáforo de espera e tempo decorrido. Ficam fora do store
// (que mexe com `chrome.storage`) para serem testáveis sem navegador nem rede.

/**
 * Data local no formato YYYY-MM-DD. Não usamos `toISOString()`: ele formata em UTC e no Brasil
 * (UTC-3) a virada do dia aconteceria às 21h, jogando a noite inteira no dia seguinte.
 */
export const dayKey = (at: Date = new Date()): string => {
  const year = at.getFullYear()
  const month = String(at.getMonth() + 1).padStart(2, "0")
  const day = String(at.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * Nível do semáforo para o tempo de espera: verde até 6 min, amarelo até 12, laranja até 18 e
 * vermelho acima disso.
 */
export const waitLevel = (elapsedMs: number): WaitLevel => {
  if (elapsedMs <= WAIT_LIMITS_MS.amarelo) return "verde"
  if (elapsedMs <= WAIT_LIMITS_MS.laranja) return "amarelo"
  if (elapsedMs <= WAIT_LIMITS_MS.vermelho) return "laranja"
  return "vermelho"
}

/**
 * Tempo desde a mensagem do cliente que aguarda resposta, em ms; `null` quando a conversa não está
 * aguardando (`clientSince` é gravado/zerado pelo store a partir da última mensagem).
 */
export const waitElapsed = (conversation: TrackedConversation, now: number): number | null =>
  conversation.clientSince === null ? null : Math.max(0, now - conversation.clientSince)
