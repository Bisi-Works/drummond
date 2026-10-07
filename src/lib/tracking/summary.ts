import { WAIT_LEVEL_SEVERITY, waitElapsed, waitLevel } from "./level"
import type { DayLog, TrackedConversation, WaitLevel } from "./types"

// Agregações puras do dia: transformam o que o tracking já registrou em números e em uma fila de
// atenção para o widget e o painel. Nada aqui chama `chrome`, IA ou o relógio global — `now` entra
// como parâmetro, no mesmo espírito de `level.ts`, para os limites serem testáveis sem navegador.

/** Estado de uma conversa acompanhada, do ponto de vista de quem precisa responder. */
export type ConversationState = "aguardando" | "respondido" | "sem-mensagem"

export interface ConversationStatus {
  state: ConversationState
  /** Semáforo de espera; `null` quando a conversa não está aguardando resposta. */
  level: WaitLevel | null
  /** Tempo desde a mensagem do cliente que aguarda resposta; `null` quando não aguarda. */
  elapsedMs: number | null
}

/** Totais do dia, montados a partir de `waitElapsed`/`waitLevel` para não duplicar a regra da espera. */
export interface DaySummary {
  /** Conversas acompanhadas hoje (tudo o que foi registrado no dia). */
  conversations: number
  /** Aguardando resposta do vendedor agora (soma de `waitingByLevel`). */
  waiting: number
  /** Aguardando em cada nível do semáforo. */
  waitingByLevel: Record<WaitLevel, number>
  /** Alerta: aguardando em laranja ou vermelho (`waitingByLevel.laranja + waitingByLevel.vermelho`). */
  alerts: number
  /** Conversas com a última palavra do vendedor — nada pendente. */
  answered: number
  /** Registros sem nenhuma mensagem observada ainda (ex.: sinal anexado antes do primeiro tick). */
  withoutMessage: number
  /** Revisões de rascunho feitas no dia (soma de `reviewCount`). */
  reviews: number
  /** Conversas com um trecho de coaching anexado (o store guarda só o último de cada uma). */
  coachings: number
  /** Média do tempo até a primeira resposta do vendedor; `null` quando não há dados suficientes. */
  averageFirstResponseMs: number | null
  /** Média do intervalo entre a última mensagem do cliente e a resposta; `null` sem dados. */
  averageResponseMs: number | null
}

/** Uma conversa que precisa de ação, com o status que a UI pinta (chip colorido + tempo de espera). */
export interface AttentionItem {
  conversation: TrackedConversation
  status: ConversationStatus
}

/**
 * Número finito ou `null`: protege as médias de um registro corrompido (`undefined`, `NaN`). Os
 * momentos de resposta já entram normalizados por `toDayLog`, então o caso comum é `number | null`.
 */
const at = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

/** Distância entre dois instantes, nunca negativa (o relógio pode andar para trás). */
const span = (from: number | null, to: number | null): number | null =>
  from === null || to === null ? null : Math.max(0, to - from)

/** Conversas do dia; a ordem do objeto não importa para nenhuma agregação daqui. */
const conversationList = (day: DayLog): TrackedConversation[] => Object.values(day.conversations)

/**
 * Estado da conversa agora. Aguardando quando ainda há espera aberta (`clientSince` gravado) ou
 * quando a última mensagem vista é do cliente; sem mensagem quando nada foi observado ainda;
 * respondido no resto — inclusive quando a última mensagem é de bot/sistema depois de uma resposta.
 */
export const conversationStatus = (
  conversation: TrackedConversation,
  now: number
): ConversationStatus => {
  if (conversation.clientSince !== null || conversation.lastMessageAuthor === "cliente") {
    const elapsedMs = waitElapsed(conversation, now)
    return {
      state: "aguardando",
      level: elapsedMs === null ? null : waitLevel(elapsedMs),
      elapsedMs
    }
  }
  if (conversation.lastMessageAuthor === null) {
    return { state: "sem-mensagem", level: null, elapsedMs: null }
  }
  return { state: "respondido", level: null, elapsedMs: null }
}

/**
 * Aproximação usada quando o dia não tem os momentos gravados pelo store: desde que a conversa foi
 * vista aberta até a resposta do vendedor. Não é o tempo real de resposta, mas é o melhor que
 * `openedAt`/`lastMessageAt` permitem — e continua `null` enquanto não houve resposta alguma.
 */
const observedResponseMs = (conversation: TrackedConversation): number | null =>
  conversation.lastMessageAuthor === "vendedor"
    ? span(at(conversation.openedAt), at(conversation.lastMessageAt))
    : null

/**
 * Tempo até a primeira resposta do vendedor. Com os momentos gravados, conta da mensagem do cliente
 * que abriu o ciclo (`lastClientAt`, com `openedAt` de reserva); sem eles, cai na janela observada.
 */
export const firstResponseMs = (conversation: TrackedConversation): number | null => {
  const respondedAt = at(conversation.firstResponseAt)
  if (respondedAt === null) return observedResponseMs(conversation)
  return span(at(conversation.lastClientAt) ?? at(conversation.openedAt), respondedAt)
}

/**
 * Tempo da resposta mais recente: da última mensagem do cliente até a última do vendedor. Só existe
 * quando o dia tem os dois momentos; sem eles, cai na janela observada (nunca inventa um intervalo).
 */
export const responseMs = (conversation: TrackedConversation): number | null =>
  span(at(conversation.lastClientAt), at(conversation.lastSellerAt)) ??
  observedResponseMs(conversation)

/** Média inteira das amostras; `null` quando não há nenhuma (não devolve `0` no lugar de "sem dado"). */
const averageOf = (
  conversations: TrackedConversation[],
  pick: (conversation: TrackedConversation) => number | null
): number | null => {
  const samples = conversations.map(pick).filter((value): value is number => value !== null)
  if (samples.length === 0) return null
  return Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)
}

/** Média do tempo até a primeira resposta do vendedor no dia; `null` quando não dá para medir. */
export const averageFirstResponseMs = (day: DayLog): number | null =>
  averageOf(conversationList(day), firstResponseMs)

/** Média do tempo de resposta do dia; `null` quando não dá para medir. */
export const averageResponseMs = (day: DayLog): number | null =>
  averageOf(conversationList(day), responseMs)

/** Severidade do nível; `null` (espera sem `clientSince`) conta como o mais brando. */
const severity = (level: WaitLevel | null): number =>
  level === null ? WAIT_LEVEL_SEVERITY.verde : WAIT_LEVEL_SEVERITY[level]

/** Totais do dia: acompanhadas, aguardando (por nível), respondidas, sinais anexados e médias. */
export const summarizeDay = (day: DayLog, now: number): DaySummary => {
  const conversations = conversationList(day)
  const waitingByLevel: Record<WaitLevel, number> = { verde: 0, amarelo: 0, laranja: 0, vermelho: 0 }
  let waiting = 0
  let answered = 0
  let withoutMessage = 0
  let reviews = 0
  let coachings = 0

  for (const conversation of conversations) {
    const { state, level } = conversationStatus(conversation, now)
    if (state === "aguardando") {
      waiting += 1
      if (level) waitingByLevel[level] += 1
    } else if (state === "respondido") {
      answered += 1
    } else {
      withoutMessage += 1
    }
    reviews += at(conversation.reviewCount) ?? 0
    if (conversation.lastCoaching) coachings += 1
  }

  return {
    conversations: conversations.length,
    waiting,
    waitingByLevel,
    alerts: waitingByLevel.laranja + waitingByLevel.vermelho,
    answered,
    withoutMessage,
    reviews,
    coachings,
    averageFirstResponseMs: averageOf(conversations, firstResponseMs),
    averageResponseMs: averageOf(conversations, responseMs)
  }
}

/**
 * Fila do que precisa de ação: só as conversas aguardando resposta, da mais urgente para a menos
 * (vermelho → verde) e, dentro do mesmo nível, pela espera mais longa. O desempate final pela `key`
 * mantém a ordem determinística — a fila não depende da ordem em que o objeto foi montado.
 */
export const attentionQueue = (day: DayLog, now: number): AttentionItem[] =>
  conversationList(day)
    .map((conversation) => ({ conversation, status: conversationStatus(conversation, now) }))
    .filter((item) => item.status.state === "aguardando")
    .sort(
      (a, b) =>
        severity(b.status.level) - severity(a.status.level) ||
        (b.status.elapsedMs ?? 0) - (a.status.elapsedMs ?? 0) ||
        a.conversation.key.localeCompare(b.conversation.key)
    )
