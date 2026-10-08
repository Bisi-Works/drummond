import { isClosingMessage } from "~lib/tracking/closing"

import type { InboxChat, InboxMessage, InboxMessageKind, InboxResult } from "./types"

// Lista de chats do Botconversa direto da API que a própria inbox usa (mapeada em 08/10/2026).
// Dá o que o DOM não dá: o horário REAL da última mensagem, de quem foi, e todos os chats do
// vendedor de uma vez — sem abrir conversa nenhuma. É uma API interna e não documentada: tudo aqui
// é defensivo e nunca lança; o tracking pelo DOM continua valendo quando ela falha.
//
// Credencial: a inbox guarda o JWT em `localStorage.authToken` e o envia como `Bearer`. Lemos o
// token só em memória, a cada ciclo, e ele vai exclusivamente para os hosts do Botconversa abaixo.
// Nunca é gravado, logado nem repassado; se der 401 esperamos a página renovar (não usamos o
// `refreshToken`).

const BACKEND_HOST = "https://backend.botconversa.com.br"
const CHATS_HOST = "https://chats-service.botconversa.com.br"
const CHATS_URL = `${CHATS_HOST}/jwt_api/chat/get_chats/`

/** Teto de páginas por varredura (15 chats por página): limita as requisições de um ciclo. */
const MAX_PAGES = 10

const TOKEN_KEY = "authToken"

export interface BotconversaApiDeps {
  fetch: typeof fetch
  storage: Pick<Storage, "getItem">
  /** `location.pathname` da inbox: `/<companyId>/inbox`. */
  pathname: string
  /** Só para teste (`config.inboxUserId`): chats de outro membro no lugar de "meus chats". */
  userIdFilter?: number
}

/** JWT da sessão, sem aspas eventuais; `null` quando não há (deslogado) ou o storage falha. */
export const readAuthToken = (storage: Pick<Storage, "getItem">): string | null => {
  try {
    const raw = storage.getItem(TOKEN_KEY)?.trim().replace(/^"|"$/g, "")
    return raw || null
  } catch {
    return null
  }
}

/** Id da empresa: o primeiro segmento numérico do caminho (`/110105/inbox`). */
export const readCompanyId = (pathname: string): string | null =>
  /^\/(\d+)(?:\/|$)/.exec(pathname)?.[1] ?? null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

const kindOf = (messageType: unknown, fromAccount: boolean, preview: string): InboxMessageKind => {
  if (messageType === "note") return "note"
  if (messageType === "system") return "system"
  // O cliente encerrando ("obrigado", 👍) não deixa a conversa aguardando resposta.
  if (!fromAccount && messageType === "text" && isClosingMessage(preview)) return "closing"
  return "message"
}

/**
 * Normaliza um item de `results`; `null` quando falta o que o tracking precisa (id, horário válido
 * ou o flag de quem enviou) — melhor ignorar o chat do que inventar o estado dele.
 */
export const toInboxChat = (raw: unknown): InboxChat | null => {
  if (!isRecord(raw)) return null
  const { id, last_message_datetime, is_from_account } = raw
  if ((typeof id !== "number" && typeof id !== "string") || id === "") return null
  const lastMessageAt = typeof last_message_datetime === "string" ? Date.parse(last_message_datetime) : NaN
  if (!Number.isFinite(lastMessageAt) || typeof is_from_account !== "boolean") return null
  const preview = typeof raw.last_message === "string" ? raw.last_message : ""
  return {
    key: String(id),
    name: typeof raw.subscriber_full_name === "string" ? raw.subscriber_full_name.replace(/\s+/g, " ").trim() : "",
    lastMessageAt,
    lastFromAccount: is_from_account,
    lastKind: kindOf(raw.message_type, is_from_account, preview),
    preview
  }
}

type Failure = Extract<InboxResult, { ok: false }>

/** POST/GET JSON autenticado; devolve o corpo ou o motivo da falha. */
const request = async (
  deps: BotconversaApiDeps,
  token: string,
  url: string,
  body?: unknown
): Promise<{ ok: true; json: unknown } | Failure> => {
  let response: Response
  try {
    response = await deps.fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } catch {
    return { ok: false, reason: "network" }
  }
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "auth" }
  if (!response.ok) return { ok: false, reason: "unexpected" }
  try {
    return { ok: true, json: await response.json() }
  } catch {
    return { ok: false, reason: "unexpected" }
  }
}

// `bot_id` não está no storage nem na URL: vem da empresa (`bot`). Não muda durante a sessão.
const botIds = new Map<string, number>()

const loadBotId = async (
  deps: BotconversaApiDeps,
  token: string,
  companyId: string
): Promise<{ ok: true; botId: number } | Failure> => {
  const cached = botIds.get(companyId)
  if (cached !== undefined) return { ok: true, botId: cached }
  const result = await request(deps, token, `${BACKEND_HOST}/api/v2/companies/${companyId}/`)
  if (!result.ok) return result
  const bot = isRecord(result.json) ? result.json.bot : undefined
  if (typeof bot !== "number") return { ok: false, reason: "unexpected" }
  botIds.set(companyId, bot)
  return { ok: true, botId: bot }
}

/** Esquece o `bot_id` guardado (para os testes não vazarem estado entre si). */
export const resetBotIdCache = () => botIds.clear()

/**
 * Chats do vendedor com atividade desde `since`, do mais recente para o mais antigo, paginando pelo
 * cursor até uma página inteira ficar antes de `since` (chats fixados no topo não contam para
 * parar) ou até `MAX_PAGES`. `complete` é falso só quando o teto de páginas cortou a varredura.
 */
export const listBotconversaChats = async (
  since: number,
  deps: BotconversaApiDeps
): Promise<InboxResult> => {
  const token = readAuthToken(deps.storage)
  const companyId = readCompanyId(deps.pathname)
  if (!token || !companyId) return { ok: false, reason: "unavailable" }

  const bot = await loadBotId(deps, token, companyId)
  if (!bot.ok) return bot

  const base = {
    filters: [],
    unread_only: false,
    bot_id: bot.botId,
    with_count: false,
    ...(deps.userIdFilter === undefined ? { room: "my" } : { user_id_filter: deps.userIdFilter })
  }

  const chats = new Map<string, InboxChat>()
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await request(deps, token, CHATS_URL, cursor ? { ...base, cursor } : base)
    if (!result.ok) return result
    const json = result.json
    if (!isRecord(json) || !Array.isArray(json.results)) return { ok: false, reason: "unexpected" }

    // Uma página sem nenhum chat do dia (fixados antigos no topo não contam) significa que o resto
    // da lista, mais antigo, também não tem. Item que não entendemos não permite concluir isso.
    let inDay = false
    let unknown = false
    for (const raw of json.results) {
      const chat = toInboxChat(raw)
      if (!chat) unknown = true
      else if (chat.lastMessageAt >= since) {
        chats.set(chat.key, chat)
        inDay = true
      }
    }

    const next: unknown = json.cursor
    cursor = typeof next === "string" && next ? next : null
    if (!cursor || json.results.length === 0 || (!inDay && !unknown)) {
      return { ok: true, chats: [...chats.values()], complete: true }
    }
  }
  return { ok: true, chats: [...chats.values()], complete: false }
}

/**
 * Normaliza uma mensagem de `jwt_api/messages/<chat_id>/`; `null` quando falta o essencial. Nota
 * interna (`note_id`) e evento de sistema ficam marcados, para quem consome pular. Mídia sem texto
 * vira um marcador, para a IA saber que ali houve um anexo.
 */
export const toInboxMessage = (raw: unknown): InboxMessage | null => {
  if (!isRecord(raw) || typeof raw.is_from_account !== "boolean" || typeof raw.timestamp !== "number") return null
  const type = typeof raw.message_type === "string" ? raw.message_type : ""
  const content = typeof raw.message_content === "string" ? raw.message_content.trim() : ""
  const kind: InboxMessageKind =
    raw.note_id !== null && raw.note_id !== undefined ? "note" : type === "system" ? "system" : "message"
  return {
    fromAccount: raw.is_from_account,
    text: content || (type && type !== "text" ? `[${type}]` : ""),
    at: raw.timestamp * 1000, // a API manda em segundos
    kind
  }
}

/**
 * Últimas mensagens de um chat, da mais nova para a mais antiga. O `chat_id` precisa ser numérico:
 * ele entra no caminho da URL. Nunca lança; qualquer falha devolve `null`.
 */
export const listBotconversaMessages = async (
  chatId: string,
  limit: number,
  deps: BotconversaApiDeps
): Promise<InboxMessage[] | null> => {
  if (!/^\d+$/.test(chatId)) return null
  const token = readAuthToken(deps.storage)
  const companyId = readCompanyId(deps.pathname)
  if (!token || !companyId) return null

  const bot = await loadBotId(deps, token, companyId)
  if (!bot.ok) return null

  const query = new URLSearchParams({
    bot_id: String(bot.botId),
    limit: String(Math.max(1, Math.min(20, Math.floor(limit)))),
    show_system_messages: "false"
  })
  const result = await request(deps, token, `${CHATS_HOST}/jwt_api/messages/${chatId}/?${query}`)
  if (!result.ok || !isRecord(result.json) || !Array.isArray(result.json.messages)) return null

  const messages: InboxMessage[] = []
  for (const raw of result.json.messages) {
    const message = toInboxMessage(raw)
    if (message) messages.push(message)
  }
  // A API já manda a mais nova primeiro; ordenar garante o contrato mesmo se isso mudar.
  return messages.sort((a, b) => b.at - a.at)
}
