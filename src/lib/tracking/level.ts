import { WAIT_LIMITS_MS } from "./constants"
import type { TrackedConversation, WaitLevel } from "./types"

// Funções puras do dia: data local, semáforo de espera e tempo decorrido. Ficam fora do store
// (que mexe com `chrome.storage`) para serem testáveis sem navegador nem rede.

/** Meia-noite local do dia de `at` (epoch ms): o corte "chats de hoje" da inbox. */
export const dayStart = (at: number): number => {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

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

/** Última leitura do nome do contato, guardada entre ticks para `confirmContactName`. */
export interface PendingContactName {
  key: string
  name: string
}

/**
 * Só aceita o nome do contato depois de vê-lo igual em dois ticks seguidos para a MESMA conversa.
 *
 * No Botconversa, ao trocar de conversa o `chat_id` da URL muda antes do cabeçalho: por ~200 ms a
 * conversa nova aparece com o nome do contato anterior. Uma única leitura nessa janela daria o nome
 * errado à conversa nova; como o tick é de ~1 s, a segunda leitura já vê o cabeçalho atualizado e
 * o par `key` + `name` só se repete quando o nome é de fato daquela conversa.
 *
 * Devolve `confirmed` (o nome, ou `null` enquanto não confirmado) e o `pending` a guardar para o
 * próximo tick. Sem nome na tela (`null`), zera o pendente.
 */
export const confirmContactName = (
  pending: PendingContactName | null,
  key: string,
  name: string | null
): { confirmed: string | null; pending: PendingContactName | null } => {
  if (!name) return { confirmed: null, pending: null }
  const reading = { key, name }
  const same = pending?.key === key && pending.name === name
  return { confirmed: same ? name : null, pending: reading }
}
