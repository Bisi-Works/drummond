import type { ChatAuthor } from "~adapters/types"

import { DAY_LOG_PREFIX, WIDGET_POSITION_KEY, WIDGET_POSITION_VERSION } from "./constants"
import { dayKey } from "./level"
import type {
  DayLog,
  TrackedCoachingSignal,
  TrackedConversation,
  TrackedReviewSignal
} from "./types"

// Persistência e redutores puros do dia de trabalho. O `chrome.storage.local` guarda um `DayLog`
// por data; os redutores (`observeConversation`, `attachReview`, `attachCoaching`) não tocam no
// storage nem no relógio global — quem chama injeta `now` — para serem testáveis sem navegador.

/** Observação de uma conversa aberta, derivada pelo adapter a cada tick do hook. */
export interface ConversationObservation {
  /** `getConversationKey()` do adapter (ex.: o `chat_id` da URL). */
  key: string
  /** `id` do adapter que atendeu a plataforma (ex.: "botconversa"). */
  platform: string
  /** Rótulo curto; quando vazio, o redutor cai para a própria `key`. */
  label: string
  /** Autor da última mensagem observada; `null` quando a conversa ainda não tem mensagens. */
  author: ChatAuthor | null
  text: string
  /** Total de mensagens visíveis na conversa (nunca regride dentro do dia). */
  messageCount: number
  /** Instante da observação (epoch ms), injetado para o redutor ser puro. */
  now: number
}

/** Posição do widget flutuante, para ele voltar onde o vendedor o deixou. */
export interface WidgetPosition {
  top: number
  /** Distância da borda direita — a posição ancorada padrão; some depois que o widget é arrastado. */
  right?: number
  /** Distância da borda esquerda quando o vendedor arrastou o widget para outra posição. */
  left?: number
  minimized: boolean
}

/** Posição inicial: junto à navbar do Botconversa (topo à direita), aberta. */
export const DEFAULT_WIDGET_POSITION: WidgetPosition = { top: 64, right: 16, minimized: false }

/** Notificado a cada gravação de um dia em `chrome.storage.local` (inclusive de outra aba). */
export type DayChangeListener = (day: DayLog, date: string) => void

/**
 * `chrome.storage.local` quando existe; `null` quando a extensão foi recarregada com a página
 * aberta (o content script continua rodando, mas perde o `chrome.storage`). Quem chama trata o
 * `null` como "sem storage" e segue com um dia vazio.
 */
const localArea = (): chrome.storage.LocalStorageArea | null => {
  try {
    return typeof chrome !== "undefined" ? (chrome.storage?.local ?? null) : null
  } catch {
    return null
  }
}

/** Número finito (não `NaN`/`Infinity`); registros parciais do storage podem trazer qualquer valor. */
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

/** Número finito ou `null`, para normalizar campos numéricos opcionais na leitura. */
const numberOrNull = (value: unknown): number | null => (isFiniteNumber(value) ? value : null)

/** Dia vazio (nada registrado ainda); `updatedAt: 0` marca "sem gravação". */
export const emptyDay = (date: string): DayLog => ({ date, conversations: {}, updatedAt: 0 })

/** Registro mínimo de uma conversa que ainda não foi observada (ex.: sinais de IA antes do tick). */
const minimalConversation = (key: string, now: number): TrackedConversation => ({
  key,
  platform: "",
  label: key,
  openedAt: now,
  lastSeenAt: now,
  lastMessageAuthor: null,
  lastMessageText: "",
  lastMessageAt: null,
  clientSince: null,
  firstResponseAt: null,
  lastClientAt: null,
  lastSellerAt: null,
  messageCount: 0,
  reviewCount: 0
})

/**
 * Normaliza um registro lido do storage. Dia gravado antes da Fase 02 (ou registro parcial criado
 * por um sinal de IA antes do primeiro tick) não tem os momentos de resposta: aqui eles viram
 * `null` e os demais campos ganham um padrão seguro, para o código consumidor nunca precisar
 * checar a ausência de um campo. `lastReview`/`lastCoaching` passam como estavam.
 */
const normalizeConversation = (key: string, value: unknown): TrackedConversation => {
  const stored = (value && typeof value === "object" ? value : {}) as Partial<TrackedConversation>
  return {
    ...stored,
    key: typeof stored.key === "string" && stored.key ? stored.key : key,
    platform: typeof stored.platform === "string" ? stored.platform : "",
    label: typeof stored.label === "string" && stored.label ? stored.label : key,
    openedAt: numberOrNull(stored.openedAt) ?? 0,
    lastSeenAt: numberOrNull(stored.lastSeenAt) ?? 0,
    lastMessageAuthor: stored.lastMessageAuthor ?? null,
    lastMessageText: typeof stored.lastMessageText === "string" ? stored.lastMessageText : "",
    lastMessageAt: numberOrNull(stored.lastMessageAt),
    clientSince: numberOrNull(stored.clientSince),
    firstResponseAt: numberOrNull(stored.firstResponseAt),
    lastClientAt: numberOrNull(stored.lastClientAt),
    lastSellerAt: numberOrNull(stored.lastSellerAt),
    messageCount: numberOrNull(stored.messageCount) ?? 0,
    reviewCount: numberOrNull(stored.reviewCount) ?? 0
  }
}

/** Valida o que veio do storage; qualquer valor estranho vira um dia vazio. */
export const toDayLog = (value: unknown, date: string): DayLog => {
  if (!value || typeof value !== "object") return emptyDay(date)
  const stored = value as Partial<DayLog>
  const conversations = stored.conversations
  if (!conversations || typeof conversations !== "object") return emptyDay(date)
  const normalized: Record<string, TrackedConversation> = {}
  for (const [key, conversation] of Object.entries(conversations)) {
    normalized[key] = normalizeConversation(key, conversation)
  }
  return {
    date,
    conversations: normalized,
    updatedAt: numberOrNull(stored.updatedAt) ?? 0
  }
}

/** Lê o dia da data pedida (local); sem storage ou com leitura falha, devolve um dia vazio. */
export const loadDay = async (date: string = dayKey()): Promise<DayLog> => {
  const area = localArea()
  if (!area) return emptyDay(date)
  try {
    const items = await area.get(`${DAY_LOG_PREFIX}${date}`)
    return toDayLog(items?.[`${DAY_LOG_PREFIX}${date}`], date)
  } catch {
    return emptyDay(date)
  }
}

/** Grava o dia inteiro na chave da sua data; silencioso quando não há storage. */
export const saveDay = async (day: DayLog): Promise<void> => {
  const area = localArea()
  if (!area) return
  try {
    await area.set({ [`${DAY_LOG_PREFIX}${day.date}`]: day })
  } catch {
    // Sem storage (extensão recarregada): o dia daquela aba segue só em memória.
  }
}

/** Sinal de IA mais recente entre dois registros; `undefined` quando nenhum dos dois tem. */
const latestOf = <T extends { at: number }>(a?: T, b?: T): T | undefined =>
  !a ? b : !b ? a : b.at >= a.at ? b : a

/**
 * Funde dois registros da mesma conversa sem perder o que a outra aba viu. O mais recente
 * (`lastSeenAt`) vence — inclusive `clientSince`/momentos, que refletem o estado atual da espera —
 * e os sinais de IA são unidos pelo `at` mais novo. Contadores usam `max` em vez de soma: duas abas
 * podem ter partido da mesma base, e somar duplicaria o número.
 */
const mergeConversation = (
  a: TrackedConversation,
  b: TrackedConversation
): TrackedConversation => {
  const winner = b.lastSeenAt >= a.lastSeenAt ? b : a
  const loser = winner === a ? b : a
  return {
    ...loser,
    ...winner,
    messageCount: Math.max(a.messageCount, b.messageCount),
    reviewCount: Math.max(a.reviewCount, b.reviewCount),
    lastReview: latestOf(a.lastReview, b.lastReview),
    lastCoaching: latestOf(a.lastCoaching, b.lastCoaching)
  }
}

/**
 * Junta dois logs do mesmo dia por conversa, mantendo `updatedAt` no maior. É o que evita que duas
 * abas abertas em conversas diferentes se sobrescrevam ao gravar o dia inteiro: `subscribeDay`
 * sincroniza a UI, e este merge protege o storage quando a gravação de uma chega depois da leitura
 * da outra. Nunca olha para datas vizinhas — cada dia continua na sua própria chave.
 */
export const mergeDayLogs = (stored: DayLog, local: DayLog): DayLog => {
  const conversations: Record<string, TrackedConversation> = { ...stored.conversations }
  for (const [key, conversation] of Object.entries(local.conversations)) {
    const previous = conversations[key]
    conversations[key] = previous ? mergeConversation(previous, conversation) : conversation
  }
  return {
    date: local.date,
    conversations,
    updatedAt: Math.max(stored.updatedAt, local.updatedAt)
  }
}

/**
 * Grava o dia preservando o que já está no storage (read-modify-write). O hook usa esta variante no
 * lugar de `saveDay` para o tick de uma aba não apagar a conversa que a outra acabou de gravar.
 * Também silencioso sem storage; nunca escreve em outra data que não a de `day`.
 */
export const saveDayMerged = async (day: DayLog): Promise<void> => {
  const area = localArea()
  if (!area) return
  try {
    const key = `${DAY_LOG_PREFIX}${day.date}`
    const items = await area.get(key)
    await area.set({ [key]: mergeDayLogs(toDayLog(items?.[key], day.date), day) })
  } catch {
    // Sem storage: o dia daquela aba segue só em memória.
  }
}

/** Apaga o dia da data pedida (descarta um log corrompido; a virada de dia preserva o anterior). */
export const clearDay = async (date: string = dayKey()): Promise<void> => {
  const area = localArea()
  if (!area) return
  try {
    await area.remove(`${DAY_LOG_PREFIX}${date}`)
  } catch {
    // Sem storage: não há nada persistido para apagar.
  }
}

/**
 * Upsert da conversa observada agora. Atualiza rótulo, plataforma, última mensagem e contagem de
 * mensagens, sem nunca regredir `openedAt`.
 *
 * O `time` do adapter vem como "<dia> HH:MM" (às vezes com o dia escrito) e **não tem data**, então
 * não dá para reconstruir o instante da mensagem. Por isso a espera se apoia em `clientSince`: ele
 * é gravado na primeira vez que a última mensagem do cliente é vista e zerado quando o vendedor
 * responde (aí a conversa não está mais aguardando).
 *
 * Além da espera, cada mensagem atualiza os momentos usados pelas métricas (`lastClientAt`,
 * `lastSellerAt`) e, na primeira resposta do vendedor de cada ciclo, `firstResponseAt`.
 */
export const observeConversation = (prev: DayLog, input: ConversationObservation): DayLog => {
  const { key, now, author } = input
  const existing = prev.conversations[key]
  const base = existing ?? minimalConversation(key, now)

  const clientSince =
    author === "vendedor" ? null : author === "cliente" ? (base.clientSince ?? now) : base.clientSince

  // Momentos por autor: a última mensagem do cliente reabre o ciclo, então zera `firstResponseAt`
  // (a próxima resposta do vendedor passa a ser a primeira do ciclo). Bot/sistema não mexem em
  // nenhum dos três — só cliente e vendedor abrem e fecham uma espera.
  const lastClientAt = author === "cliente" ? now : (base.lastClientAt ?? null)
  const lastSellerAt = author === "vendedor" ? now : (base.lastSellerAt ?? null)
  const firstResponseAt =
    author === "cliente" ? null : (base.firstResponseAt ?? (author === "vendedor" ? now : null))

  const conversation: TrackedConversation = {
    ...base,
    platform: input.platform || base.platform,
    label: input.label || base.label,
    openedAt: base.openedAt,
    lastSeenAt: now,
    lastMessageAuthor: author,
    lastMessageText: input.text,
    lastMessageAt: author ? now : base.lastMessageAt,
    clientSince,
    firstResponseAt,
    lastClientAt,
    lastSellerAt,
    messageCount: Math.max(base.messageCount, input.messageCount)
  }

  return { ...prev, conversations: { ...prev.conversations, [key]: conversation }, updatedAt: now }
}

/** Anexa a última revisão de rascunho à conversa e conta mais uma revisão do dia. */
export const attachReview = (prev: DayLog, key: string, signal: TrackedReviewSignal): DayLog => {
  const existing = prev.conversations[key] ?? minimalConversation(key, signal.at)
  const conversation: TrackedConversation = {
    ...existing,
    lastReview: signal,
    reviewCount: existing.reviewCount + 1
  }
  return { ...prev, conversations: { ...prev.conversations, [key]: conversation }, updatedAt: signal.at }
}

/**
 * Anexa o último coaching à conversa. Não incrementa `reviewCount`, que conta revisões de rascunho
 * (ver `types.ts`) — coaching e revisão são sinais diferentes.
 */
export const attachCoaching = (prev: DayLog, key: string, signal: TrackedCoachingSignal): DayLog => {
  const existing = prev.conversations[key] ?? minimalConversation(key, signal.at)
  const conversation: TrackedConversation = { ...existing, lastCoaching: signal }
  return { ...prev, conversations: { ...prev.conversations, [key]: conversation }, updatedAt: signal.at }
}

/**
 * Anexa a revisão ao dia em que ela terminou. Atalho para quem só tem o sinal em mãos (o content
 * script): carrega o dia, aplica `attachReview` e grava. Nunca lança — o tracking não pode
 * interferir na revisão.
 */
export const recordReview = async (key: string, signal: TrackedReviewSignal): Promise<void> => {
  try {
    await saveDay(attachReview(await loadDay(dayKey(new Date(signal.at))), key, signal))
  } catch {
    // Sem storage ou dado corrompido: o sinal simplesmente não entra no dia.
  }
}

/**
 * Anexa o coaching ao dia em que ele terminou. Mesmo atalho de `recordReview`, para o painel
 * lateral, que não tem o hook de tracking. Nunca lança.
 */
export const recordCoaching = async (key: string, signal: TrackedCoachingSignal): Promise<void> => {
  try {
    await saveDay(attachCoaching(await loadDay(dayKey(new Date(signal.at))), key, signal))
  } catch {
    // Sem storage ou dado corrompido: o sinal simplesmente não entra no dia.
  }
}

/**
 * Avisa a cada gravação de dia no `chrome.storage.local`, inclusive feita por outra aba — é o que
 * mantém widget e painel coerentes. Devolve a função para cancelar a escuta.
 */
export const subscribeDay = (onChange: DayChangeListener): (() => void) => {
  let onChanged: typeof chrome.storage.onChanged | null = null
  try {
    onChanged = typeof chrome !== "undefined" ? (chrome.storage?.onChanged ?? null) : null
  } catch {
    onChanged = null
  }
  if (!onChanged) return () => {}

  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: chrome.storage.AreaName
  ) => {
    if (areaName !== "local") return
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(DAY_LOG_PREFIX)) continue
      const date = key.slice(DAY_LOG_PREFIX.length)
      onChange(toDayLog(change.newValue, date), date)
    }
  }

  onChanged.addListener(listener)
  return () => onChanged.removeListener(listener)
}

/** Valida a posição salva; valor ausente, de outra versão ou corrompido cai na posição padrão. */
export const toWidgetPosition = (value: unknown): WidgetPosition => {
  if (!value || typeof value !== "object") return DEFAULT_WIDGET_POSITION
  const stored = value as Partial<WidgetPosition> & { version?: unknown }
  if (stored.version !== WIDGET_POSITION_VERSION || !isFiniteNumber(stored.top)) {
    return DEFAULT_WIDGET_POSITION
  }
  const position: WidgetPosition = { top: stored.top, minimized: stored.minimized === true }
  if (isFiniteNumber(stored.right)) position.right = stored.right
  if (isFiniteNumber(stored.left)) position.left = stored.left
  return position
}

/** Posição salva do widget; sem storage ou com dados ruins, devolve a posição padrão. */
export const loadWidgetPosition = async (): Promise<WidgetPosition> => {
  const area = localArea()
  if (!area) return DEFAULT_WIDGET_POSITION
  try {
    const items = await area.get(WIDGET_POSITION_KEY)
    return toWidgetPosition(items?.[WIDGET_POSITION_KEY])
  } catch {
    return DEFAULT_WIDGET_POSITION
  }
}

/** Grava a posição do widget com a versão do formato, para permitir migração depois. */
export const saveWidgetPosition = async (position: WidgetPosition): Promise<void> => {
  const area = localArea()
  if (!area) return
  try {
    await area.set({ [WIDGET_POSITION_KEY]: { version: WIDGET_POSITION_VERSION, ...position } })
  } catch {
    // Sem storage: o widget volta à posição padrão na próxima abertura.
  }
}
