import { useEffect, useMemo, useRef, useState } from "react"

import { sendToBackground } from "@plasmohq/messaging"

import type { ChatAdapter, ChatMessage } from "~adapters/types"
import { config as appConfig } from "~lib/config"
import { CLASSIFY_CLOSING, type ClassifyClosingRequest, type ClassifyClosingResponse } from "~lib/messages"
import { isClosingMessage } from "~lib/tracking/closing"
import { createClosingResolver } from "~lib/tracking/closing-resolver"
import {
  confirmContactName,
  dayKey,
  dayStart,
  rolloverDate,
  type PendingContactName
} from "~lib/tracking/level"
import { attentionQueue, summarizeDay, type AttentionItem, type DaySummary } from "~lib/tracking/summary"
import {
  applyInbox,
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
  // Encerramento do cliente não muda o estado, então o autor gravado não é o dele: não compara.
  const closing = observation.author === "cliente" && isClosingMessage(observation.text)
  if (
    existing.platform !== observation.platform ||
    existing.label !== observation.label ||
    (!closing && existing.lastMessageAuthor !== observation.author) ||
    existing.lastMessageText !== observation.text ||
    existing.messageCount !== observation.messageCount
  ) {
    return false
  }
  if (closing) return true
  // `clientSince` só muda na transição: cliente passa a aguardar, vendedor responde. Bot/sistema
  // não mexem na espera, então `existing` continua válido.
  if (observation.author === "cliente") return existing.clientSince !== null
  if (observation.author === "vendedor") return existing.clientSince === null
  return true
}

/** Situação da última leitura da inbox: `error` quando a API falhou e o tracking segue só pelo DOM. */
export interface InboxSync {
  status: "idle" | "ok" | "error"
  /** Quando a última leitura bem-sucedida terminou (epoch ms). */
  at: number | null
}

/** Menor intervalo entre duas leituras extras da inbox (chat aberto que ainda não é "nosso"). */
const MIN_RESYNC_MS = 15_000
/** Quanto esperar depois de uma resposta do vendedor para reler a inbox (o servidor já a registrou). */
const RESYNC_AFTER_REPLY_MS = 4_000

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
  /** Estado da sincronização com a inbox da plataforma (ver `InboxSync`). */
  inbox: InboxSync
  /**
   * Esvazia o dia em memória e relê a inbox. Usado depois de apagar o storage (botão de dev): sem
   * isto o próximo tick regravaria o que esta aba ainda guarda.
   */
  resetDay: () => void
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
  const syncRef = useRef<() => void>(() => {})
  const [inbox, setInbox] = useState<InboxSync>({ status: "idle", at: null })

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
      void syncInbox()
    }

    // Chats do vendedor na inbox (API da plataforma). `owned` = quais chats são "nossos": quando a
    // API responde, o DOM só rastreia o chat aberto se ele estiver aqui; sem resposta (ainda ou por
    // falha) rastreia tudo, como antes. Só lê com a aba visível, para várias abas não multiplicarem
    // as requisições.
    // Decide, para as mensagens curtas do cliente, se é só um encerramento ("obrigado", 👍). A IA
    // roda no background; sem ela (ou sem como ler as mensagens do chat) vale só a regra de texto.
    const closing =
      appConfig.closing.enabled && adapter?.listRecentMessages
        ? createClosingResolver({
            recentMessages: (key, limit) => adapter.listRecentMessages!(key, limit),
            classify: async (input) => {
              try {
                return await sendToBackground<ClassifyClosingRequest, ClassifyClosingResponse>({
                  name: CLASSIFY_CLOSING,
                  body: input
                })
              } catch {
                return { ok: false, error: "background indisponível" }
              }
            },
            now: () => Date.now()
          })
        : null

    let owned: Set<string> | null = null
    let syncing = false
    let lastSyncAt = 0
    let replyTimer: ReturnType<typeof setTimeout> | undefined

    const syncInbox = async () => {
      if (cancelled || syncing || !readyRef.current || !adapter?.listMyChats) return
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      syncing = true
      lastSyncAt = Date.now()
      try {
        const result = await adapter.listMyChats(dayStart(lastSyncAt))
        if (cancelled) return
        if (!result.ok) {
          setInbox((previous) => ({ status: "error", at: previous.at }))
          return
        }
        owned = new Set(result.chats.map((chat) => chat.key))
        const chats = closing ? await closing.resolve(result.chats) : result.chats
        if (cancelled) return
        const at = Date.now()
        const next = applyInbox(dayRef.current, chats, {
          platform: adapter.id,
          now: at,
          complete: result.complete
        })
        dayRef.current = next
        setDay(next)
        setInbox({ status: "ok", at })
        void saveDayMerged(next)
      } catch {
        if (!cancelled) setInbox((previous) => ({ status: "error", at: previous.at }))
      } finally {
        syncing = false
      }
    }

    void load(dayRef.current.date)

    const unsubscribe = subscribeDay((incoming, date) => {
      if (cancelled || date !== dayRef.current.date) return
      // Inclui o eco da nossa própria gravação; como a inscrição não grava de volta, não há laço.
      dayRef.current = incoming
      setDay(incoming)
    })

    syncRef.current = () => void syncInbox()

    // Última leitura do nome do contato, para só confiar nele quando se repete (ver `confirmContactName`).
    let pendingName: PendingContactName | null = null

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

      // Só acompanhamos chats da nossa carteira. Um chat que acabou de ser atribuído ao vendedor
      // ainda não está na lista: pede uma releitura (com intervalo mínimo) em vez de ignorá-lo.
      if (owned && !owned.has(key)) {
        if (at - lastSyncAt >= MIN_RESYNC_MS) void syncInbox()
        return
      }

      let messages: ChatMessage[]
      try {
        messages = adapter.readConversation(appConfig.contextMessages)
      } catch {
        return // DOM trocando no meio do tick: tenta de novo no próximo
      }
      if (messages.length === 0) return

      // O título da conversa é o nome do contato, não o que foi dito. Enquanto o nome não se
      // confirma (conversa recém-aberta, cabeçalho ainda desatualizado) mantém o rótulo já gravado.
      let name: string | null = null
      try {
        name = adapter.getContactName?.() ?? null
      } catch {
        // cabeçalho no meio de uma troca de DOM: tratado como "sem nome" neste tick
      }
      const confirmation = confirmContactName(pendingName, key, name)
      pendingName = confirmation.pending

      const last = messages[messages.length - 1]
      const observation: ConversationObservation = {
        key,
        platform: adapter.id,
        label: confirmation.confirmed ?? dayRef.current.conversations[key]?.label ?? key,
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
      // O vendedor acabou de responder uma conversa que estava aguardando: o estado local já
      // mudou na hora; relê a inbox em seguida para ela voltar a coincidir com o servidor.
      if (observation.author === "vendedor" && current.conversations[key]?.clientSince != null) {
        clearTimeout(replyTimer)
        replyTimer = setTimeout(() => void syncInbox(), RESYNC_AFTER_REPLY_MS)
      }
      // Gravação com merge: o dia inteiro é reescrito, então juntamos com o storage para o tick
      // desta aba não apagar a conversa que outra aba gravou no meio do caminho.
      void saveDayMerged(next)
    }

    tick()
    const interval = setInterval(tick, intervalMs)
    const inboxInterval = setInterval(() => void syncInbox(), appConfig.inboxPollMs)
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncInbox()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      readyRef.current = false
      loadingRef.current = null
      clearInterval(interval)
      clearInterval(inboxInterval)
      clearTimeout(replyTimer)
      document.removeEventListener("visibilitychange", onVisible)
      unsubscribe()
    }
  }, [adapter, intervalMs])

  // Agregações memoizadas por uma assinatura estável: o objeto `day` só troca de identidade quando
  // há gravação e o relógio é arredondado ao segundo. Assim o tick de 1 s não recalcula os totais a
  // cada render — só quando o segundo vira — mas os níveis de espera seguem o tempo que passa.
  const nowSecond = Math.floor(now / 1000)
  const summary = useMemo(() => summarizeDay(day, nowSecond * 1000), [day, nowSecond])
  const attention = useMemo(() => attentionQueue(day, nowSecond * 1000), [day, nowSecond])

  const resetDay = () => {
    const empty = emptyDay(dayRef.current.date)
    dayRef.current = empty
    setDay(empty)
    syncRef.current()
  }

  const conversations = Object.values(day.conversations)
    .filter((conversation) => !conversation.released)
    .sort(byLastSeen)
  return { day, conversations, now, summary, attention, alertCount: summary.alerts, inbox, resetDay }
}
