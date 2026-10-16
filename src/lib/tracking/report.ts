import type { ChatAuthor } from "~adapters/types"

import { formatDayLabel, formatDuration } from "./format"
import {
  conversationStatus,
  summarizeDay,
  type ConversationStatus,
  type DaySummary
} from "./summary"
import type {
  DayLog,
  TrackedCoachingSignal,
  TrackedConversation,
  TrackedReviewSignal
} from "./types"

// Payload compacto do dia que entra no prompt do relatório de IA. Nada aqui chama `chrome` nem o
// modelo: as funções são puras e recebem o dia já carregado e o `now` injetado, como `summary.ts`
// e `level.ts`, para serem testáveis sem navegador. A regra de ouro é o custo: o relatório roda uma
// vez por dia sobre o resumo do tracking, então a conversa completa nunca sai daqui — só a última
// mensagem truncada e os sinais que a extensão já anexou.

/** Tamanho máximo da prévia da última mensagem (a conversa inteira nunca vai para a IA). */
export const REPORT_MESSAGE_MAX = 200

/** Uma conversa no payload: identificação, estado do dia e sinais, sem o histórico completo. */
export interface ReportConversationInput {
  /** `key` do adapter (ex.: o `chat_id`), para o modelo citar a conversa. */
  key: string
  label: string
  platform: string
  /** Autor da última mensagem observada; `null` quando nenhuma foi vista. */
  lastMessageAuthor: ChatAuthor | null
  /** Última mensagem observada, em uma linha e truncada em `REPORT_MESSAGE_MAX`. */
  lastMessage: string
  messageCount: number
  /** Estado agora (aguardando/respondido/sem-mensagem), com tempo de espera e nível do semáforo. */
  status: ConversationStatus
  lastReview?: TrackedReviewSignal
  lastCoaching?: TrackedCoachingSignal
}

/** Payload serializável que vai para a IA e fica guardado junto do relatório gerado. */
export interface DailyReportInput {
  /** Data local YYYY-MM-DD do dia relatado. */
  date: string
  totals: DaySummary
  conversations: ReportConversationInput[]
}

/** Colapsa para uma linha e corta no limite; devolve `""` quando não há texto. */
const preview = (text: string): string => {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > REPORT_MESSAGE_MAX ? `${line.slice(0, REPORT_MESSAGE_MAX - 1)}…` : line
}

/**
 * Conversas "sem nenhuma mensagem" (registro mínimo criado por um sinal de IA antes do primeiro
 * tick) ficam de fora do relatório: não há o que a IA avalie e elas só inflariam o prompt.
 */
const hasMessage = (conversation: TrackedConversation): boolean =>
  conversation.messageCount > 0 ||
  conversation.lastMessageAuthor !== null ||
  conversation.lastMessageText.trim() !== ""

/**
 * Monta o payload do relatório a partir do dia. A ordem é "vista por último primeiro" (desempate
 * pela `key`), então o prompt é determinístico — a ordem de inserção no objeto do `DayLog` não
 * muda o texto enviado ao modelo.
 */
export const buildReportInput = (day: DayLog, now: number): DailyReportInput => ({
  date: day.date,
  totals: summarizeDay(day, now),
  conversations: Object.values(day.conversations)
    .filter((conversation) => !conversation.released && hasMessage(conversation))
    .map((conversation) => ({ conversation, status: conversationStatus(conversation, now) }))
    .sort(
      (a, b) =>
        b.conversation.lastSeenAt - a.conversation.lastSeenAt ||
        a.conversation.key.localeCompare(b.conversation.key)
    )
    .map(({ conversation, status }) => ({
      key: conversation.key,
      label: conversation.label,
      platform: conversation.platform,
      lastMessageAuthor: conversation.lastMessageAuthor,
      lastMessage: preview(conversation.lastMessageText),
      messageCount: conversation.messageCount,
      status,
      ...(conversation.lastReview && { lastReview: conversation.lastReview }),
      ...(conversation.lastCoaching && { lastCoaching: conversation.lastCoaching })
    }))
})

/** Rótulos do estado no texto do prompt (o JSON guarda o valor cru, que a UI já conhece). */
const STATE_LABEL: Record<ConversationStatus["state"], string> = {
  aguardando: "aguardando resposta",
  respondido: "respondido",
  "sem-mensagem": "sem mensagem"
}

const AUTHOR_LABEL: Record<ChatAuthor, string> = {
  cliente: "cliente",
  vendedor: "vendedor",
  bot: "bot",
  sistema: "sistema"
}

/** Duração legível para o prompt; `null` vira "sem dado" em vez de zero inventado. */
const duration = (ms: number | null): string => (ms === null ? "sem dado" : formatDuration(ms))

/** Impede que um texto do dia "feche" o bloco de dados e injete instruções fora dele. */
const neutralize = (text: string): string => text.replace(/<\s*\/?\s*dia\s*>/gi, "")

/** Uma linha por conversa, com estado, espera e os sinais anexados (nunca o histórico inteiro). */
const conversationLine = (conversation: ReportConversationInput): string[] => {
  const state = STATE_LABEL[conversation.status.state]
  const wait =
    conversation.status.state === "aguardando"
      ? `, espera ${duration(conversation.status.elapsedMs)}${
          conversation.status.level ? ` (nível ${conversation.status.level})` : ""
        }`
      : ""
  const lines = [
    `- ${neutralize(conversation.label)} [${conversation.key}] (${conversation.platform}) — ${state}${wait}, ${conversation.messageCount} mensagens`
  ]
  if (conversation.lastMessage) {
    const author = conversation.lastMessageAuthor
      ? `${AUTHOR_LABEL[conversation.lastMessageAuthor]}`
      : "desconhecido"
    lines.push(`  Última mensagem (${author}): "${neutralize(conversation.lastMessage)}"`)
  }
  if (conversation.lastReview) {
    lines.push(
      `  Revisão: ${conversation.lastReview.status} — "${neutralize(conversation.lastReview.summary)}"`
    )
  }
  if (conversation.lastCoaching) {
    lines.push(
      `  Coaching: "${neutralize(conversation.lastCoaching.summary)}" (próximo passo: "${neutralize(
        conversation.lastCoaching.nextStep
      )}")`
    )
  }
  return lines
}

/**
 * Texto delimitado que entra no prompt. Tudo o que estiver dentro de `<dia>` é dado, não instrução
 * — por isso textos vindos do dia têm as tags `<dia>` neutralizadas antes de serem escritos.
 */
export const formatReportInput = (input: DailyReportInput): string => {
  const { totals } = input
  const levels = totals.waitingByLevel
  const counts = [
    `Conversas acompanhadas: ${totals.conversations}`,
    `Aguardando: ${totals.waiting} (verde: ${levels.verde}, amarelo: ${levels.amarelo}, laranja: ${levels.laranja}, vermelho: ${levels.vermelho})`,
    `Respondidas: ${totals.answered}`,
    `Sem mensagem: ${totals.withoutMessage}`,
    `Revisões: ${totals.reviews}`,
    `Coachings: ${totals.coachings}`,
    `Tempo médio de 1ª resposta: ${duration(totals.averageFirstResponseMs)}`,
    `Tempo médio de resposta: ${duration(totals.averageResponseMs)}`
  ]
  const lines = [
    `<dia>`,
    `Data: ${formatDayLabel(input.date)}`,
    counts.join(" | "),
    "",
    input.conversations.length === 0
      ? "Conversas: nenhuma conversa acompanhada no dia."
      : ["Conversas:", ...input.conversations.flatMap(conversationLine)].join("\n"),
    `</dia>`
  ]
  return lines.join("\n")
}
