import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  listBotconversaChats,
  listBotconversaMessages,
  readAuthToken,
  readCompanyId,
  resetBotIdCache,
  toInboxChat,
  toInboxMessage,
  type BotconversaApiDeps
} from "~adapters/botconversa-api"

const SINCE = Date.parse("2026-10-08T03:00:00Z") // meia-noite em UTC-3

const raw = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  subscriber_full_name: "  Maria   Souza ",
  last_message_datetime: "2026-10-08T14:11:33Z",
  is_from_account: false,
  message_type: "text",
  last_message: "Bom dia",
  ...over
})

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

/** `fetch` falso: a empresa responde `bot`, e cada POST consome a próxima página. */
const fakeFetch = (pages: unknown[]) => {
  const bodies: unknown[] = []
  const calls: { url: string; auth: string | null }[] = []
  let index = 0
  const impl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({ url: String(url), auth: headers.get("Authorization") })
    if (String(url).includes("/companies/")) return json({ bot: 555 })
    bodies.push(JSON.parse(String(init?.body)))
    return json(pages[Math.min(index++, pages.length - 1)])
  }) as unknown as typeof fetch
  return { impl, bodies, calls }
}

const deps = (fetchImpl: typeof fetch, over: Partial<BotconversaApiDeps> = {}): BotconversaApiDeps => ({
  fetch: fetchImpl,
  storage: { getItem: (key) => (key === "authToken" ? "jwt-token" : null) },
  pathname: "/110105/inbox",
  ...over
})

beforeEach(() => resetBotIdCache())

describe("readAuthToken / readCompanyId", () => {
  it("lê o token sem aspas e devolve null quando falta ou o storage lança", () => {
    expect(readAuthToken({ getItem: () => '"abc"' })).toBe("abc")
    expect(readAuthToken({ getItem: () => null })).toBeNull()
    expect(readAuthToken({ getItem: () => "  " })).toBeNull()
    expect(
      readAuthToken({
        getItem: () => {
          throw new Error("bloqueado")
        }
      })
    ).toBeNull()
  })

  it("extrai a empresa do primeiro segmento numérico do caminho", () => {
    expect(readCompanyId("/110105/inbox")).toBe("110105")
    expect(readCompanyId("/110105")).toBe("110105")
    expect(readCompanyId("/inbox")).toBeNull()
  })
})

describe("toInboxChat", () => {
  it("normaliza nome, horário real e quem enviou por último", () => {
    expect(toInboxChat(raw(10))).toEqual({
      key: "10",
      name: "Maria Souza",
      lastMessageAt: Date.parse("2026-10-08T14:11:33Z"),
      lastFromAccount: false,
      lastKind: "message",
      preview: "Bom dia"
    })
  })

  it("classifica nota interna e evento de sistema, e trata modelo/áudio como mensagem", () => {
    expect(toInboxChat(raw(1, { message_type: "note" }))?.lastKind).toBe("note")
    expect(toInboxChat(raw(1, { message_type: "system" }))?.lastKind).toBe("system")
    expect(toInboxChat(raw(1, { message_type: "template" }))?.lastKind).toBe("message")
    expect(toInboxChat(raw(1, { message_type: "audio" }))?.lastKind).toBe("message")
  })

  it("marca como encerramento o 'obrigado' do cliente, mas não a pergunta nem a mensagem nossa", () => {
    expect(toInboxChat(raw(1, { last_message: "Beleza! Muito obrigado, Edu" }))?.lastKind).toBe("closing")
    expect(toInboxChat(raw(1, { last_message: "👍" }))?.lastKind).toBe("closing")
    expect(toInboxChat(raw(1, { last_message: "Obrigado, mas qual o prazo?" }))?.lastKind).toBe("message")
    expect(toInboxChat(raw(1, { last_message: "Ok, pode mandar" }))?.lastKind).toBe("message")
    // quem encerra com "obrigado" do nosso lado continua sendo mensagem nossa
    expect(toInboxChat(raw(1, { last_message: "Obrigado!", is_from_account: true }))?.lastKind).toBe("message")
    // só texto: o rótulo de um áudio ou anexo nunca é tratado como encerramento
    expect(toInboxChat(raw(1, { last_message: "Ok", message_type: "audio" }))?.lastKind).toBe("message")
  })

  it("descarta o que não dá para interpretar, em vez de inventar o estado", () => {
    expect(toInboxChat(null)).toBeNull()
    expect(toInboxChat(raw(1, { last_message_datetime: "ontem" }))).toBeNull()
    expect(toInboxChat(raw(1, { is_from_account: "sim" }))).toBeNull()
    expect(toInboxChat({ ...raw(1), id: undefined })).toBeNull()
  })
})

describe("listBotconversaChats", () => {
  it("lê o bot da empresa e pede 'meus chats' com o Bearer", async () => {
    const { impl, bodies, calls } = fakeFetch([{ results: [raw(1)], cursor: null }])
    const result = await listBotconversaChats(SINCE, deps(impl))

    expect(result).toMatchObject({ ok: true, complete: true })
    expect(bodies[0]).toEqual({ filters: [], unread_only: false, bot_id: 555, with_count: false, room: "my" })
    expect(calls.every((call) => call.auth === "Bearer jwt-token")).toBe(true)
    expect(calls.map((call) => new URL(call.url).host)).toEqual([
      "backend.botconversa.com.br",
      "chats-service.botconversa.com.br"
    ])
  })

  it("usa user_id_filter no lugar de room quando há um membro de teste", async () => {
    const { impl, bodies } = fakeFetch([{ results: [raw(1)], cursor: null }])
    await listBotconversaChats(SINCE, deps(impl, { userIdFilter: 2327953 }))
    expect(bodies[0]).toMatchObject({ user_id_filter: 2327953 })
    expect(bodies[0]).not.toHaveProperty("room")
  })

  it("pagina pelo cursor e para quando a página inteira é anterior ao dia", async () => {
    const old = { last_message_datetime: "2026-10-07T20:00:00Z" }
    const { impl, bodies } = fakeFetch([
      { results: [raw(1), raw(2)], cursor: "c1" },
      { results: [raw(3), raw(4, old)], cursor: "c2" },
      { results: [raw(5, old), raw(6, old)], cursor: "c3" },
      { results: [raw(7, old)], cursor: "c4" }
    ])
    const result = await listBotconversaChats(SINCE, deps(impl))

    expect(result.ok && result.chats.map((c) => c.key)).toEqual(["1", "2", "3"])
    expect(result).toMatchObject({ complete: true })
    expect(bodies).toHaveLength(3)
    expect(bodies[1]).toMatchObject({ cursor: "c1" })
    expect(bodies[0]).not.toHaveProperty("cursor")
  })

  it("chat fixado e antigo no topo não encerra a varredura", async () => {
    const old = { last_message_datetime: "2026-10-01T20:00:00Z", is_pinned: true }
    const { impl } = fakeFetch([
      { results: [raw(9, old), raw(1)], cursor: "c1" },
      { results: [raw(2)], cursor: null }
    ])
    const result = await listBotconversaChats(SINCE, deps(impl))
    expect(result.ok && result.chats.map((c) => c.key)).toEqual(["1", "2"])
  })

  it("marca a varredura como incompleta quando o teto de páginas corta", async () => {
    const { impl, bodies } = fakeFetch([{ results: [raw(1)], cursor: "mais" }])
    const result = await listBotconversaChats(SINCE, deps(impl))
    expect(result).toMatchObject({ ok: true, complete: false })
    expect(bodies).toHaveLength(10)
  })

  it("guarda o bot e não repete a chamada da empresa", async () => {
    const { impl, calls } = fakeFetch([{ results: [raw(1)], cursor: null }])
    await listBotconversaChats(SINCE, deps(impl))
    await listBotconversaChats(SINCE, deps(impl))
    expect(calls.filter((call) => call.url.includes("/companies/"))).toHaveLength(1)
  })

  it("não pede nada sem token ou sem empresa", async () => {
    const impl = vi.fn() as unknown as typeof fetch
    expect(await listBotconversaChats(SINCE, deps(impl, { storage: { getItem: () => null } }))).toEqual({
      ok: false,
      reason: "unavailable"
    })
    expect(await listBotconversaChats(SINCE, deps(impl, { pathname: "/login" }))).toEqual({
      ok: false,
      reason: "unavailable"
    })
    expect(impl).not.toHaveBeenCalled()
  })

  it.each([
    ["401", () => json({}, 401), "auth"],
    ["403", () => json({}, 403), "auth"],
    ["500", () => json({}, 500), "unexpected"],
    ["rede", () => Promise.reject(new Error("offline")), "network"],
    ["JSON inválido", () => Promise.resolve(new Response("<html>", { status: 200 })), "unexpected"]
  ])("falha com motivo em %s, sem lançar", async (_name, respond, reason) => {
    const impl = vi.fn(respond as () => Promise<Response>) as unknown as typeof fetch
    expect(await listBotconversaChats(SINCE, deps(impl))).toEqual({ ok: false, reason })
  })

  it("falha quando a resposta não tem o formato esperado", async () => {
    const impl = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("/companies/") ? await json({ bot: 1 }) : await json({ itens: [] })
    ) as unknown as typeof fetch
    expect(await listBotconversaChats(SINCE, deps(impl))).toEqual({ ok: false, reason: "unexpected" })
  })

  it("nunca manda o token para fora dos hosts do Botconversa", async () => {
    const { impl, calls } = fakeFetch([{ results: [raw(1)], cursor: null }])
    await listBotconversaChats(SINCE, deps(impl))
    expect(calls.every((call) => /\.botconversa\.com\.br$/.test(new URL(call.url).host))).toBe(true)
  })
})

describe("toInboxMessage", () => {
  const message = (over: Record<string, unknown> = {}) => ({
    message_content: "  Bom dia  ",
    message_type: "text",
    is_from_account: false,
    timestamp: 1791471958,
    note_id: null,
    ...over
  })

  it("normaliza texto, autor e converte o timestamp de segundos para ms", () => {
    expect(toInboxMessage(message())).toEqual({
      fromAccount: false,
      text: "Bom dia",
      at: 1791471958_000,
      kind: "message"
    })
  })

  it("marca nota interna e sistema, e dá um marcador à mídia sem texto", () => {
    expect(toInboxMessage(message({ note_id: 7 }))?.kind).toBe("note")
    expect(toInboxMessage(message({ message_type: "system" }))?.kind).toBe("system")
    expect(toInboxMessage(message({ message_content: "", message_type: "document" }))?.text).toBe("[document]")
    expect(toInboxMessage(message({ message_content: "", message_type: "text" }))?.text).toBe("")
  })

  it("descarta o que não tem autor ou horário", () => {
    expect(toInboxMessage(message({ is_from_account: undefined }))).toBeNull()
    expect(toInboxMessage(message({ timestamp: "ontem" }))).toBeNull()
    expect(toInboxMessage(null)).toBeNull()
  })
})

describe("listBotconversaMessages", () => {
  const page = (messages: unknown[]) => ({ messages, next_cursor: null, previous_cursor: null })
  const wire = (messages: unknown[]) => {
    const calls: string[] = []
    const impl = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url))
      return String(url).includes("/companies/") ? json({ bot: 555 }) : json(page(messages))
    }) as unknown as typeof fetch
    return { impl, calls }
  }
  const row = (at: number, fromAccount: boolean, text: string) => ({
    message_content: text,
    message_type: "text",
    is_from_account: fromAccount,
    timestamp: at,
    note_id: null
  })

  it("lê as últimas mensagens do chat, da mais nova para a mais antiga", async () => {
    const { impl, calls } = wire([row(100, true, "antiga"), row(300, false, "nova"), row(200, true, "meio")])
    const result = await listBotconversaMessages("36887046", 3, deps(impl))

    expect(result?.map((m) => m.text)).toEqual(["nova", "meio", "antiga"])
    const url = new URL(calls.at(-1)!)
    expect(url.host).toBe("chats-service.botconversa.com.br")
    expect(url.pathname).toBe("/jwt_api/messages/36887046/")
    expect(Object.fromEntries(url.searchParams)).toEqual({ bot_id: "555", limit: "3", show_system_messages: "false" })
  })

  it("só aceita chat_id numérico, para o id não escapar do caminho da URL", async () => {
    const { impl } = wire([])
    for (const id of ["../../x", "123/../9", "12a", "", "1 2"]) {
      expect(await listBotconversaMessages(id, 3, deps(impl))).toBeNull()
    }
    expect(impl).not.toHaveBeenCalled()
  })

  it("limita o número de mensagens pedido", async () => {
    const { impl, calls } = wire([])
    await listBotconversaMessages("1", 999, deps(impl))
    expect(new URL(calls.at(-1)!).searchParams.get("limit")).toBe("20")
  })

  it("devolve null (sem lançar) em falha de token, de rede ou de formato", async () => {
    expect(await listBotconversaMessages("1", 3, deps(wire([]).impl, { storage: { getItem: () => null } }))).toBeNull()
    const offline = vi.fn(async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch
    expect(await listBotconversaMessages("1", 3, deps(offline))).toBeNull()
    const odd = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("/companies/") ? await json({ bot: 1 }) : await json({ itens: [] })
    ) as unknown as typeof fetch
    expect(await listBotconversaMessages("1", 3, deps(odd))).toBeNull()
  })
})
