import type { InboxChat, InboxMessage } from "~adapters/types"
import type { ClassifyClosingRequest, ClassifyClosingResponse } from "~lib/messages"

import { isClosingCandidate, isClosingMessage } from "./closing"

// Cascata que decide, para cada chat cuja última mensagem é do cliente, se ela é só um encerramento
// ("obrigado", "ok", 👍) e a conversa não deve contar como aguardando:
//
//   1. Só mensagens curtas e sem pergunta chegam aqui (`isClosingCandidate`); o resto aguarda.
//   2. A regra de texto (`isClosingMessage`) resolve o óbvio, de graça — exceto quando a mensagem
//      anterior do vendedor era uma PERGUNTA: aí um "ok" ou um 👍 é resposta, não despedida, e quem
//      decide é a IA, que enxerga essa mensagem.
//   3. A IA (Jev, via background) decide o resto. Dúvida, erro ou demora = continua aguardando: o
//      lado seguro é nunca esconder um cliente que espera.
//
// Cada veredito fica guardado por chat + horário da mensagem: uma releitura da inbox não repete a
// chamada, e uma falha só é repetida depois de um tempo. Sem rede nem relógio global: tudo entra
// por `deps`, para testar sem navegador.

export interface ClosingResolverDeps {
  /** Últimas mensagens do chat, da mais nova para a mais antiga; `null` quando não dá para ler. */
  recentMessages(key: string, limit: number): Promise<InboxMessage[] | null>
  /** Pergunta à IA (no background) se a mensagem é só um encerramento. */
  classify(input: ClassifyClosingRequest): Promise<ClassifyClosingResponse>
  now(): number
}

export interface ClosingResolverOptions {
  /** Chamadas simultâneas (mensagens + IA) por rodada. */
  concurrency?: number
  /** Teto de espera por rodada: o que não terminou fica como veio e o veredito entra no cache. */
  budgetMs?: number
  /** Quanto esperar para tentar de novo um chat cuja IA falhou. */
  failureTtlMs?: number
  /** Máximo de vereditos guardados. */
  cacheSize?: number
}

/** Quantas mensagens ler: a do cliente, a anterior e uma folga para notas internas no meio. */
const CONTEXT_MESSAGES = 4

const cacheKey = (chat: InboxChat) => `${chat.key}:${chat.lastMessageAt}`

/** Mensagem anterior do vendedor, quando ela é a que veio logo antes da do cliente (sem notas). */
const previousSellerMessage = (messages: InboxMessage[]): string | undefined => {
  const earlier = messages.slice(1).find((message) => message.kind === "message")
  return earlier?.fromAccount && earlier.text ? earlier.text : undefined
}

/** Resultado de decidir um chat: o veredito e se ele vale ser guardado para as próximas rodadas. */
interface Decision {
  /** `true` encerramento, `false` aguarda, `null` nada se concluiu (vale o que a inbox trazia). */
  closing: boolean | null
  cache: boolean
  /** Quando a IA falhou, o veredito seguro a usar enquanto não se tenta de novo. */
  retryAfterMs?: number
}

export const createClosingResolver = (deps: ClosingResolverDeps, options: ClosingResolverOptions = {}) => {
  const { concurrency = 4, budgetMs = 6_000, failureTtlMs = 5 * 60_000, cacheSize = 500 } = options
  const verdicts = new Map<string, boolean>()
  /** IA que falhou: até quando não insistir e qual veredito seguro vale nesse meio-tempo. */
  const failures = new Map<string, { until: number; closing: boolean | null }>()

  const remember = (id: string, closing: boolean) => {
    verdicts.set(id, closing)
    if (verdicts.size > cacheSize) verdicts.delete(verdicts.keys().next().value as string)
  }

  const decide = async (chat: InboxChat): Promise<Decision> => {
    const messages = await deps.recentMessages(chat.key, CONTEXT_MESSAGES)
    // O chat andou desde a leitura da lista (o vendedor respondeu): não há o que decidir.
    if (messages?.[0]?.fromAccount) return { closing: null, cache: false }

    const previous = messages ? previousSellerMessage(messages) : undefined
    const text = messages?.[0] && messages[0].kind === "message" && messages[0].text ? messages[0].text : chat.preview
    // Sem ler as mensagens (falha de rede) o veredito vale só desta rodada: tenta de novo na próxima.
    const cache = messages !== null

    if (!isClosingCandidate(text)) return { closing: false, cache }

    // Regra segura: encerramento óbvio e o vendedor não tinha perguntado nada.
    const questionBefore = previous?.includes("?") === true
    if (isClosingMessage(text) && !questionBefore) return { closing: true, cache }

    const answer = await deps.classify({ ...(previous ? { previous } : {}), text })
    if (answer.ok) return { closing: answer.closing, cache }
    // Falha da IA: só chegamos aqui quando a regra sozinha não bastava (havia uma pergunta do
    // vendedor, ou a regra não reconheceu a mensagem), então a conversa aguarda. Só se tenta de
    // novo depois do prazo, para uma IA fora do ar não ser chamada a cada leitura da inbox.
    return { closing: false, cache: false, retryAfterMs: failureTtlMs }
  }

  /**
   * Devolve os mesmos chats com `lastKind` ajustado: `closing` onde o cliente só encerrou e
   * `message` onde a conversa aguarda. Nunca lança nem passa de `budgetMs`.
   */
  const resolve = async (chats: InboxChat[]): Promise<InboxChat[]> => {
    const waiting = chats.filter((chat) => !chat.lastFromAccount && chat.lastKind !== "note" && chat.lastKind !== "system")
    const now = deps.now()
    const todo = waiting.filter((chat) => {
      const id = cacheKey(chat)
      return !verdicts.has(id) && (failures.get(id)?.until ?? 0) <= now
    })
    const thisRound = new Map<string, boolean | null>()

    if (todo.length > 0) {
      let next = 0
      const worker = async () => {
        while (next < todo.length) {
          const chat = todo[next++]
          const id = cacheKey(chat)
          try {
            const decision = await decide(chat)
            if (decision.closing !== null) thisRound.set(id, decision.closing)
            if (decision.cache && decision.closing !== null) remember(id, decision.closing)
            if (decision.retryAfterMs) failures.set(id, { until: deps.now() + decision.retryAfterMs, closing: decision.closing })
          } catch {
            failures.set(id, { until: deps.now() + failureTtlMs, closing: null })
          }
        }
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const budget = new Promise<void>((resolveBudget) => {
        timer = setTimeout(resolveBudget, budgetMs)
      })
      await Promise.race([Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker)), budget])
      clearTimeout(timer)
    }

    const at = deps.now()
    return chats.map((chat) => {
      const id = cacheKey(chat)
      const failure = failures.get(id)
      const verdict = verdicts.get(id) ?? thisRound.get(id) ?? (failure && failure.until > at ? failure.closing : null)
      // Sem conclusão, vale o que a leitura da inbox já trazia.
      return verdict === null || verdict === undefined ? chat : { ...chat, lastKind: verdict ? "closing" : "message" }
    })
  }

  return { resolve }
}
