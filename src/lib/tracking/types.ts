import type { ChatAuthor } from "~adapters/types"

// Modelo do dia de trabalho do vendedor: o que a extensão registrou de cada conversa que ele
// abriu no Botconversa. Nada aqui chama IA — os sinais de revisão/coaching são anexados depois,
// pelas mesmas respostas que a extensão já produz hoje.

/** Semáforo do tempo desde a última mensagem do cliente. */
export type WaitLevel = "verde" | "amarelo" | "laranja" | "vermelho"

/** Última revisão de rascunho (botão "Revisar") anexada à conversa. */
export interface TrackedReviewSignal {
  /** Mesmo `status` do `DraftReview`: "ok" quando nada mudou, "ajustes" caso contrário. */
  status: "ok" | "ajustes"
  /** Resumo curto derivado das alterações/avisos da revisão. */
  summary: string
  /** Quando a revisão terminou (epoch ms). */
  at: number
}

/** Último coaching (painel lateral) anexado à conversa. */
export interface TrackedCoachingSignal {
  summary: string
  nextStep: string
  /** Quando a análise terminou (epoch ms). */
  at: number
}

/** Uma conversa acompanhada no dia, identificada por `key` dentro do `DayLog`. */
export interface TrackedConversation {
  /** `getConversationKey()` do adapter (ex.: o `chat_id` da URL). */
  key: string
  /** `id` do adapter que atendeu a plataforma (ex.: "botconversa"). */
  platform: string
  /** Rótulo curto exibido no widget; cai para a própria `key` quando não há nome disponível. */
  label: string
  /** Primeira vez que a conversa foi vista aberta no dia (nunca regride). */
  openedAt: number
  /** Última vez que a conversa foi vista aberta. */
  lastSeenAt: number
  lastMessageAuthor: ChatAuthor | null
  lastMessageText: string
  /** Epoch ms em que a última mensagem foi observada — não é o horário do adapter (ver abaixo). */
  lastMessageAt: number | null
  /**
   * Quando o cliente enviou a mensagem que está aguardando resposta, em epoch ms; `null` quando a
   * conversa não está aguardando (última mensagem é do vendedor).
   *
   * O `time` do adapter vem como "<dia> HH:MM" (ex.: "Hoje 10:32"), **sem data** — e o dia pode vir
   * escrito ("29 setembro"). Como não dá para reconstruir o instante da mensagem, o cálculo de
   * espera se apoia em `clientSince`, gravado no momento em que a extensão observa a mensagem do
   * cliente.
   */
  clientSince: number | null
  /**
   * Instante da primeira resposta do vendedor no ciclo aberto pela última mensagem do cliente, em
   * epoch ms; `null` enquanto o vendedor ainda não respondeu a esse ciclo. Uma nova mensagem do
   * cliente reabre o ciclo e zera o campo — só a primeira resposta de cada ciclo o grava.
   *
   * Dia gravado antes da Fase 02 não tem o campo no storage; `loadDay`/`toDayLog` normalizam a
   * leitura para `null`, então o código consumidor não precisa checar a ausência.
   */
  firstResponseAt: number | null
  /** Instante da última mensagem do cliente vista hoje; `null` se nenhuma foi observada. */
  lastClientAt: number | null
  /** Instante da última mensagem do vendedor vista hoje; `null` se nenhuma foi observada. */
  lastSellerAt: number | null
  /** Total de mensagens vistas na conversa ao longo do dia. */
  messageCount: number
  /** Revisões de rascunho feitas nesta conversa hoje (incrementado por `attachReview`). */
  reviewCount: number
  lastReview?: TrackedReviewSignal
  lastCoaching?: TrackedCoachingSignal
  /**
   * `last_message_datetime` da inbox já aplicado a esta conversa (epoch ms); ausente/`null` quando
   * a conversa só foi vista pelo DOM. Serve para só aplicar a prévia de mensagens mais novas que a
   * última já vista, sem desfazer o texto completo que o DOM leu.
   */
  lastInboxAt?: number | null
  /**
   * `true` quando uma varredura completa da inbox não trouxe esta conversa enquanto ela aguardava
   * (foi reatribuída, encerrada ou nunca foi do vendedor). Fica no log, mas sai de totais, fila e relatório: não é mais do
   * vendedor. Volta a `false` se a conversa reaparecer.
   */
  released?: boolean
}

/** Tudo o que a extensão registrou em um dia (uma chave `${DAY_LOG_PREFIX}${date}` no storage). */
export interface DayLog {
  /** Data local no formato YYYY-MM-DD (ver `dayKey` em `level.ts`). */
  date: string
  conversations: Record<string, TrackedConversation>
  /** Última gravação do dia (epoch ms), usada para ordenar/descartar log antigo. */
  updatedAt: number
}
