import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  downloadBotconversaAudio,
  listBotconversaChats,
  listBotconversaMessages,
  loadBotconversaMedia,
  readAuthToken,
  readCompanyId,
  resetBotIdCache,
  resetMediaCache,
  toInboxChat,
  toInboxMedia,
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

beforeEach(() => {
  resetBotIdCache()
  resetMediaCache()
})

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

describe("mídia da mensagem", () => {
  const media = (over: Record<string, unknown> = {}) => ({
    media_id: "mid-1",
    mime_type: "audio/ogg; codecs=opus",
    file_size: 1234,
    duration: 7,
    media_s3_url: "https://bucket.example/audio-1.ogg",
    ...over
  })

  const message = (mediaItems: unknown[], over: Record<string, unknown> = {}) => ({
    message_id: "wamid.A1",
    message_content: "",
    message_type: "audio",
    is_from_account: false,
    timestamp: 1791471958,
    note_id: null,
    media: mediaItems,
    ...over
  })

  it("normaliza o anexo e expõe o id que casa com o DOM", () => {
    expect(toInboxMedia(media())).toEqual({
      url: "https://bucket.example/audio-1.ogg",
      mimeType: "audio/ogg; codecs=opus",
      byteSize: 1234,
      duration: 7,
      mediaId: "mid-1"
    })
    expect(toInboxMessage(message([media()]))).toMatchObject({
      key: "wamid.A1",
      text: "[audio]",
      media: { url: "https://bucket.example/audio-1.ogg", duration: 7 }
    })
  })

  it("aceita camelCase e cai para a URL externa quando não há S3", () => {
    expect(
      toInboxMedia({ mediaId: "m2", mimeType: "audio/mp4", fileSize: 9, mediaExternalUrl: "https://cdn.example/a.m4a" })
    ).toEqual({ url: "https://cdn.example/a.m4a", mimeType: "audio/mp4", byteSize: 9, mediaId: "m2" })
  })

  it("aceita media_id numérico (o payload da inbox manda number)", () => {
    expect(toInboxMedia({ media_id: 2242648623129802, mime_type: "audio/ogg; codecs=opus" })).toEqual({
      mediaId: "2242648623129802",
      mimeType: "audio/ogg; codecs=opus"
    })
  })

  it("não inventa mídia nem id quando o payload não traz", () => {
    expect(toInboxMedia(undefined)).toBeUndefined()
    expect(toInboxMedia({})).toBeUndefined()
    const empty = toInboxMessage(message([]))
    expect(empty?.media).toBeUndefined()
    expect(empty?.key).toBe("wamid.A1")
    expect(toInboxMessage(message([media()], { message_id: undefined }))?.key).toBeUndefined()
  })
})

describe("loadBotconversaMedia", () => {
  const audioRow = (id: string, url: string | null, over: Record<string, unknown> = {}) => ({
    message_id: id,
    message_content: "",
    message_type: "audio",
    is_from_account: false,
    timestamp: 1791471958,
    note_id: null,
    media: [{ media_s3_url: url, mime_type: "audio/ogg", file_size: 10, duration: 3 }],
    ...over
  })

  const wire = (messages: unknown[]) => {
    const calls: string[] = []
    const impl = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url))
      return String(url).includes("/companies/") ? json({ bot: 555 }) : json({ messages })
    }) as unknown as typeof fetch
    return { impl, calls }
  }

  const withChat = { chatId: "38100790" }

  it("casa pelo message_id e devolve a mídia do áudio", async () => {
    const { impl, calls } = wire([audioRow("wamid.OTHER", "https://s3/other.ogg"), audioRow("wamid.A2", "https://s3/a2.ogg")])
    const found = await loadBotconversaMedia("wamid.A2", deps(impl, withChat))

    expect(found).toMatchObject({ url: "https://s3/a2.ogg", mimeType: "audio/ogg", duration: 3 })
    const url = new URL(calls.at(-1)!)
    expect(url.host).toBe("chats-service.botconversa.com.br")
    expect(url.pathname).toBe("/jwt_api/messages/38100790/")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      bot_id: "555",
      limit: "25",
      show_system_messages: "false"
    })
  })

  it("reaproveita a listagem para vários áudios da mesma conversa", async () => {
    const { impl, calls } = wire([audioRow("wamid.A1", "https://s3/a1.ogg"), audioRow("wamid.A2", "https://s3/a2.ogg")])
    const api = deps(impl, withChat)

    expect((await loadBotconversaMedia("wamid.A1", api))?.url).toBe("https://s3/a1.ogg")
    expect((await loadBotconversaMedia("wamid.A2", api))?.url).toBe("https://s3/a2.ogg")
    expect(calls.filter((url) => url.includes("/jwt_api/messages/"))).toHaveLength(1)
  })

  it("devolve null sem chat_id, com id fora do padrão, mensagem ausente ou mídia sem URL", async () => {
    const { impl } = wire([audioRow("wamid.A1", null), audioRow("wamid.A2", "https://s3/a2.ogg")])
    expect(await loadBotconversaMedia("wamid.A1", deps(impl))).toBeNull()
    expect(await loadBotconversaMedia("wamid.A1", deps(impl, { chatId: "../x" }))).toBeNull()
    expect(await loadBotconversaMedia("", deps(impl, withChat))).toBeNull()
    expect(await loadBotconversaMedia("wamid.A1", deps(impl, withChat))).toBeNull()
    expect((await loadBotconversaMedia("wamid.A2", deps(impl, withChat)))?.url).toBe("https://s3/a2.ogg")
    expect(await loadBotconversaMedia("wamid.NAO-EXISTE", deps(impl, withChat))).toBeNull()
  })

  it("devolve null em falha de autenticação ou de rede, sem lançar", async () => {
    const unauthorized = vi.fn(async () => new Response("{}", { status: 401 })) as unknown as typeof fetch
    expect(await loadBotconversaMedia("wamid.A1", deps(unauthorized, withChat))).toBeNull()

    const offline = vi.fn(async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch
    expect(await loadBotconversaMedia("wamid.A1", deps(offline, withChat))).toBeNull()

    expect(
      await loadBotconversaMedia("wamid.A1", deps(unauthorized, { ...withChat, storage: { getItem: () => null } }))
    ).toBeNull()
  })
})

describe("downloadBotconversaAudio", () => {
  const media = { mediaId: "2242648623129802", mimeType: "audio/ogg; codecs=opus" }

  it("baixa o arquivo por bot_id/media_id com Bearer e usa o mime da resposta", async () => {
    const calls: { url: string; auth: string | null }[] = []
    const impl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("Authorization") })
      if (String(url).includes("/companies/")) return json({ bot: 555 })
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/ogg" }
      })
    }) as unknown as typeof fetch

    const result = await downloadBotconversaAudio(media, deps(impl))

    expect(result?.mimeType).toBe("audio/ogg")
    expect(result?.blob.size).toBe(3)
    const url = new URL(calls.at(-1)!.url)
    expect(url.pathname).toBe("/jwt_api/chat/get_media_url/")
    expect(Object.fromEntries(url.searchParams)).toEqual({ bot_id: "555", media_id: media.mediaId })
    expect(calls.at(-1)!.auth).toBe("Bearer jwt-token")
  })

  it("devolve null sem media_id, sem token, em erro HTTP ou de rede", async () => {
    const impl = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("/companies/") ? json({ bot: 1 }) : new Response("", { status: 404 })
    ) as unknown as typeof fetch

    expect(await downloadBotconversaAudio({ mimeType: "audio/ogg" }, deps(impl))).toBeNull()
    expect(await downloadBotconversaAudio(media, deps(impl, { storage: { getItem: () => null } }))).toBeNull()
    expect(await downloadBotconversaAudio(media, deps(impl))).toBeNull()

    const offline = vi.fn(async () => Promise.reject(new Error("offline"))) as unknown as typeof fetch
    expect(await downloadBotconversaAudio(media, deps(offline))).toBeNull()
  })
})
