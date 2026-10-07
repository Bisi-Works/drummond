import type { ChatMessage } from "~adapters/types"

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
 * Data local para a qual o log deve apontar neste instante, ou `null` quando o dia não virou (a
 * `currentDate` já é a data local de `at`). Deixa a virada de dia explícita: o hook chama isto a
 * cada tick e, quando o resultado não é nulo, recarrega o dia da nova data sem tocar no anterior.
 * Puro e com `at` injetado, para testar 23:59/00:01 sem depender do relógio global.
 */
export const rolloverDate = (currentDate: string, at: number): string | null => {
  const today = dayKey(new Date(at))
  return today === currentDate ? null : today
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
 * Ordem canônica do semáforo, do mais brando ao mais urgente. É o que permite ordenar a fila de
 * atenção (vermelho primeiro) sem repetir a ordem dos níveis em cada agregação.
 */
export const WAIT_LEVEL_SEVERITY: Record<WaitLevel, number> = {
  verde: 0,
  amarelo: 1,
  laranja: 2,
  vermelho: 3
}

/**
 * Tempo desde a mensagem do cliente que aguarda resposta, em ms; `null` quando a conversa não está
 * aguardando (`clientSince` é gravado/zerado pelo store a partir da última mensagem).
 */
export const waitElapsed = (conversation: TrackedConversation, now: number): number | null =>
  conversation.clientSince === null ? null : Math.max(0, now - conversation.clientSince)

/** Tamanho máximo do rótulo exibido no widget (o cabeçalho é estreito). */
const LABEL_MAX = 40

/**
 * Rótulo curto da conversa para o widget, derivado do que a extensão já carregou — sem mapear
 * nenhum seletor novo do Botconversa (o nome do contato fica no cabeçalho, que esta fase não lê).
 * Usa o início da primeira mensagem do cliente; sem texto nenhum, cai para a própria `key`
 * (ex.: o `chat_id` da URL).
 */
export const conversationLabel = (messages: ChatMessage[], key: string): string => {
  const first = messages.find((m) => m.author === "cliente" && m.text.trim())
  const snippet = (first?.text ?? "").trim().split("\n")[0].replace(/\s+/g, " ")
  if (!snippet) return key
  return snippet.length > LABEL_MAX ? `${snippet.slice(0, LABEL_MAX - 1)}…` : snippet
}
