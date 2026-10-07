import { useEffect, useMemo, useRef, useState } from "react"

import type { ChatAdapter, ChatMessage } from "~adapters/types"
import { config as appConfig } from "~lib/config"
import { conversationLabel, dayKey, rolloverDate } from "~lib/tracking/level"
import { attentionQueue, summarizeDay, type AttentionItem, type DaySummary } from "~lib/tracking/summary"
import {
  emptyDay,
  loadDay,
  observeConversation,
  saveDayMerged,
  subscribeDay,
  type ConversationObservation
} from "~lib/tracking/store"
import type { DayLog, TrackedConversation } from "~lib/tracking/types"

// Conecta o adapter ao log do dia, no mesmo espírito de `useComposerState`: polling leve (SPAs
// trocam a conversa sem avisar) mais `chrome.storage.onChanged` para o widget refletir o que a
// outra aba gravou. Nenhuma chamada de IA nasce aqui — só se observa o que a página já mostra.

/** Conversas mais recentemente vistas primeiro (o widget lista de cima para baixo). */
const byLastSeen = (a: TrackedConversation, b: TrackedConversation) => b.lastSeenAt - a.lastSeenAt

/**
 * Verdadeiro quando observar de novo não mudaria nada que valha uma gravação. Sem isso o polling
 * reescreveria o dia a cada segundo (e dispararia `onChanged`) só para atualizar `lastSeenAt`.
 */
const sameObservation = (
  existing: TrackedConversation | undefined,
  observation: ConversationObservation
): boolean => {
  if (!existing) return false
  if (
    existing.platform !== observation.platform ||
    existing.label !== observation.label ||
    existing.lastMessageAuthor !== observation.author ||
    existing.lastMessageText !== observation.text ||
    existing.messageCount !== observation.messageCount
  ) {
    return false
  }
  // `clientSince` só muda na transição: cliente passa a aguardar, vendedor responde. Bot/sistema
  // não mexem na espera, então `existing` continua válido.
  if (observation.author === "cliente") return existing.clientSince !== null
  if (observation.author === "vendedor") return existing.clientSince === null
  return true
}

export interface DayTracking {
  day: DayLog
  conversations: TrackedConversation[]
  /** Instante do último tick, para os chips de espera e contadores avançarem sozinhos. */
  now: number
  /** Totais do dia (`summarizeDay`): acompanhadas, aguardando, respondidas e médias. */
  summary: DaySummary
  /** Fila do que precisa de ação (`attentionQueue`), da mais urgente para a menos urgente. */
  attention: AttentionItem[]
  /** Atalho de `summary.alerts`: conversas aguardando em laranja ou vermelho. */
  alertCount: number
}

/**
 * Acompanha o dia de trabalho da conversa aberta. A cada tick lê a conversa pelo adapter e alimenta
 * `observeConversation`; o resultado vai para o estado e para o `chrome.storage.local`. Nunca lança
 * para fora: uma leitura no meio de uma troca de DOM apenas é ignorada e tentada de novo no tick
 * seguinte. Sem adapter (ou sem `chat_id`), o hook só devolve o dia carregado.
 */
export const useDayTracking = (adapter: ChatAdapter | null, intervalMs = 1000): DayTracking => {
  const [day, setDay] = useState<DayLog>(() => emptyDay(dayKey()))
  const [now, setNow] = useState(() => Date.now())
  const dayRef = useRef(day)
  // Enquanto o dia está sendo lido do storage não observamos nada, para o tick não sobrescrever o
  // log com o dia vazio inicial (nem perder o que outra aba gravou). `loadingRef` evita que os
  // ticks seguintes, na mesma virada de dia, disparem leituras concorrentes da mesma data.
  const readyRef = useRef(false)
  const loadingRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async (date: string) => {
      if (loadingRef.current === date) return
      loadingRef.current = date
      readyRef.current = false
      const loaded = await loadDay(date)
      loadingRef.current = null
      if (cancelled) return
      dayRef.current = loaded
      setDay(loaded)
      readyRef.current = true
    }

    void load(dayRef.current.date)

    const unsubscribe = subscribeDay((incoming, date) => {
      if (cancelled || date !== dayRef.current.date) return
      // Inclui o eco da nossa própria gravação; como a inscrição não grava de volta, não há laço.
      dayRef.current = incoming
      setDay(incoming)
    })

    const tick = () => {
      const at = Date.now()
      setNow(at)

      // Virada do dia: recomeça na data local atual (e carrega o que outra aba já gravou nela). O
      // dia anterior continua no storage, intacto e consultável pelo relatório.
      const rolled = rolloverDate(dayRef.current.date, at)
      if (rolled) {
        void load(rolled)
        return
      }
      if (!readyRef.current || !adapter) return

      const key = adapter.getConversationKey()
      if (!key) return

      let messages: ChatMessage[]
      try {
        messages = adapter.readConversation(appConfig.contextMessages)
      } catch {
        return // DOM trocando no meio do tick: tenta de novo no próximo
      }
      if (messages.length === 0) return

      const last = messages[messages.length - 1]
      const observation: ConversationObservation = {
        key,
        platform: adapter.id,
        label: conversationLabel(messages, key),
        author: last.author,
        text: last.text,
        messageCount: messages.length,
        now: at
      }

      const current = dayRef.current
      if (sameObservation(current.conversations[key], observation)) return

      const next = observeConversation(current, observation)
      dayRef.current = next
      setDay(next)
      // Gravação com merge: o dia inteiro é reescrito, então juntamos com o storage para o tick
      // desta aba não apagar a conversa que outra aba gravou no meio do caminho.
      void saveDayMerged(next)
    }

    tick()
    const interval = setInterval(tick, intervalMs)
    return () => {
      cancelled = true
      readyRef.current = false
      loadingRef.current = null
      clearInterval(interval)
      unsubscribe()
    }
  }, [adapter, intervalMs])

  // Agregações memoizadas por uma assinatura estável: o objeto `day` só troca de identidade quando
  // há gravação e o relógio é arredondado ao segundo. Assim o tick de 1 s não recalcula os totais a
  // cada render — só quando o segundo vira — mas os níveis de espera seguem o tempo que passa.
  const nowSecond = Math.floor(now / 1000)
  const summary = useMemo(() => summarizeDay(day, nowSecond * 1000), [day, nowSecond])
  const attention = useMemo(() => attentionQueue(day, nowSecond * 1000), [day, nowSecond])

  const conversations = Object.values(day.conversations).sort(byLastSeen)
  return { day, conversations, now, summary, attention, alertCount: summary.alerts }
}
