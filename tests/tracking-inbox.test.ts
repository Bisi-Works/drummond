import { describe, expect, it } from "vitest"

import type { InboxChat } from "~adapters/types"
import { buildReportInput } from "~lib/tracking/report"
import { applyInbox, emptyDay, observeConversation, toDayLog } from "~lib/tracking/store"
import { attentionQueue, conversationStatus, summarizeDay } from "~lib/tracking/summary"
import type { DayLog } from "~lib/tracking/types"

const MIN = 60_000
const T0 = Date.parse("2026-10-08T13:00:00Z")

const chat = (key: string, over: Partial<InboxChat> = {}): InboxChat => ({
  key,
  name: "Maria Souza",
  lastMessageAt: T0,
  lastFromAccount: false,
  lastKind: "message",
  preview: "Bom dia",
  ...over
})

const apply = (day: DayLog, chats: InboxChat[], now: number, complete = true) =>
  applyInbox(day, chats, { platform: "botconversa", now, complete })

const day0 = emptyDay("2026-10-08")

describe("applyInbox — conversas aguardando", () => {
  it("cria a conversa aguardando com o horário REAL da mensagem, não o da observação", () => {
    const next = apply(day0, [chat("1", { lastMessageAt: T0 })], T0 + 20 * MIN)
    const conversation = next.conversations["1"]

    expect(conversation).toMatchObject({
      key: "1",
      platform: "botconversa",
      label: "Maria Souza",
      lastMessageAuthor: "cliente",
      clientSince: T0,
      lastClientAt: T0,
      lastInboxAt: T0
    })
    const status = conversationStatus(conversation, T0 + 20 * MIN)
    expect(status).toMatchObject({ state: "aguardando", elapsedMs: 20 * MIN, level: "vermelho" })
  })

  it("o nome vem da API e substitui o rótulo antigo", () => {
    const first = apply(day0, [chat("1", { name: "" })], T0)
    expect(first.conversations["1"].label).toBe("1")
    const second = apply(first, [chat("1", { name: "Maria Souza" })], T0 + MIN)
    expect(second.conversations["1"].label).toBe("Maria Souza")
  })

  it("não cria conversa cuja última mensagem é nossa (campanha ou já resolvida)", () => {
    const next = apply(day0, [chat("1", { lastFromAccount: true, lastKind: "message" })], T0)
    expect(next.conversations["1"]).toBeUndefined()
  })

  it("nota interna ou evento de sistema não criam nem mudam o estado", () => {
    expect(apply(day0, [chat("1", { lastKind: "note" })], T0).conversations["1"]).toBeUndefined()

    const waiting = apply(day0, [chat("1")], T0)
    const afterNote = apply(waiting, [chat("1", { lastKind: "system", lastMessageAt: T0 + MIN })], T0 + 2 * MIN)
    expect(afterNote.conversations["1"]).toMatchObject({ clientSince: T0, lastMessageAuthor: "cliente" })
  })

  it("mensagens seguidas do cliente mantêm o início da espera e atualizam a última", () => {
    const first = apply(day0, [chat("1", { lastMessageAt: T0 })], T0 + MIN)
    const second = apply(first, [chat("1", { lastMessageAt: T0 + 5 * MIN })], T0 + 6 * MIN)
    expect(second.conversations["1"]).toMatchObject({ clientSince: T0, lastClientAt: T0 + 5 * MIN })
  })

  it("é idempotente: reler a mesma inbox não muda o estado", () => {
    const first = apply(day0, [chat("1")], T0 + MIN)
    const again = apply(first, [chat("1")], T0 + 2 * MIN)
    expect(again.conversations).toEqual(first.conversations)
  })
})

describe("encerramento do cliente (\"obrigado\") não é espera", () => {
  const closing = (key: string, at: number) =>
    chat(key, { lastKind: "closing", lastMessageAt: at, preview: "Beleza! Muito obrigado, Edu" })

  it("chat cuja última mensagem é o encerramento do cliente não nasce aguardando", () => {
    const next = apply(day0, [closing("1", T0)], T0 + 30 * MIN)
    expect(next.conversations["1"]).toBeUndefined()
    expect(summarizeDay(next, T0 + 30 * MIN).waiting).toBe(0)
  })

  it("depois de respondida, o 'obrigado' do cliente não reabre a espera", () => {
    const waiting = apply(day0, [chat("1", { lastMessageAt: T0 })], T0)
    const answered = apply(waiting, [chat("1", { lastFromAccount: true, lastMessageAt: T0 + 2 * MIN })], T0 + 3 * MIN)
    const thanked = apply(answered, [closing("1", T0 + 5 * MIN)], T0 + 6 * MIN)

    expect(thanked.conversations["1"]).toMatchObject({ clientSince: null, lastMessageAuthor: "vendedor" })
    expect(conversationStatus(thanked.conversations["1"], T0 + 20 * MIN).state).toBe("respondido")
  })

  it("quem ainda esperava uma resposta continua esperando (o 'obrigado' não resolve a pergunta)", () => {
    const waiting = apply(day0, [chat("1", { lastMessageAt: T0 })], T0)
    const thanked = apply(waiting, [closing("1", T0 + 5 * MIN)], T0 + 6 * MIN)
    expect(thanked.conversations["1"]).toMatchObject({ clientSince: T0, lastMessageAuthor: "cliente" })
  })

  it("a espera aberta SÓ pelo 'obrigado' (DOM viu antes da IA decidir) é desfeita pela inbox", () => {
    const observed = observeConversation(day0, {
      key: "1",
      platform: "botconversa",
      label: "Maria",
      author: "cliente",
      text: "Pra você também, até mais!",
      messageCount: 3,
      now: T0 + MIN // visto depois de enviado
    })
    expect(observed.conversations["1"].clientSince).toBe(T0 + MIN) // a regra não o reconhece: aguarda

    const resolved = apply(observed, [closing("1", T0)], T0 + 2 * MIN)
    expect(resolved.conversations["1"].clientSince).toBeNull()
    expect(conversationStatus(resolved.conversations["1"], T0 + 30 * MIN).state).toBe("respondido")
  })

  it("mas não desfaz a espera de uma pergunta anterior ao 'obrigado'", () => {
    const question = observeConversation(day0, {
      key: "1",
      platform: "botconversa",
      label: "Maria",
      author: "cliente",
      text: "Vocês entregam em Curitiba",
      messageCount: 2,
      now: T0
    })
    const afterThanks = apply(question, [closing("1", T0 + 5 * MIN)], T0 + 6 * MIN)
    expect(afterThanks.conversations["1"].clientSince).toBe(T0)
  })

  it("pelo DOM: abrir um chat que termina em 'obrigado' não o deixa aguardando", () => {
    const observe = (day: DayLog, author: "cliente" | "vendedor", text: string, count: number, now: number) =>
      observeConversation(day, { key: "1", platform: "botconversa", label: "Maria", author, text, messageCount: count, now })

    const opened = observe(day0, "cliente", "Muito obrigada!", 3, T0)
    expect(conversationStatus(opened.conversations["1"], T0 + 30 * MIN).state).not.toBe("aguardando")
    expect(opened.conversations["1"]).toMatchObject({ clientSince: null, lastMessageText: "Muito obrigada!" })

    // já respondida pelo vendedor, o agradecimento seguinte mantém "respondido" e o horário da resposta
    const replied = observe(day0, "vendedor", "Segue o contrato.", 2, T0)
    const thanked = observe(replied, "cliente", "Valeu!", 3, T0 + 10 * MIN)
    expect(thanked.conversations["1"]).toMatchObject({
      clientSince: null,
      lastMessageAuthor: "vendedor",
      lastSellerAt: T0
    })
  })

  it("pelo DOM: uma pergunta do cliente continua abrindo a espera", () => {
    const next = observeConversation(day0, {
      key: "1",
      platform: "botconversa",
      label: "Maria",
      author: "cliente",
      text: "Obrigado, mas qual o prazo?",
      messageCount: 3,
      now: T0
    })
    expect(next.conversations["1"].clientSince).toBe(T0)
  })
})

describe("applyInbox — resposta do vendedor", () => {
  it("resposta vista pela API encerra a espera com o horário real da resposta", () => {
    const waiting = apply(day0, [chat("1", { lastMessageAt: T0 })], T0 + MIN)
    const answered = apply(
      waiting,
      [chat("1", { lastFromAccount: true, lastMessageAt: T0 + 7 * MIN, preview: "Já te respondo" })],
      T0 + 8 * MIN
    )
    expect(answered.conversations["1"]).toMatchObject({
      clientSince: null,
      lastMessageAuthor: "vendedor",
      firstResponseAt: T0 + 7 * MIN,
      lastSellerAt: T0 + 7 * MIN
    })
    expect(conversationStatus(answered.conversations["1"], T0 + 9 * MIN).state).toBe("respondido")
  })

  it("resposta de quem não estava aguardando não mexe nos tempos (ex.: modelo disparado)", () => {
    const answered = apply(
      apply(day0, [chat("1")], T0),
      [chat("1", { lastFromAccount: true, lastMessageAt: T0 + MIN })],
      T0 + 2 * MIN
    )
    const again = apply(
      answered,
      [chat("1", { lastFromAccount: true, lastMessageAt: T0 + 30 * MIN })],
      T0 + 31 * MIN
    )
    expect(again.conversations["1"].lastSellerAt).toBe(T0 + MIN)
    expect(again.conversations["1"].firstResponseAt).toBe(T0 + MIN)
  })

  it("nova mensagem do cliente depois da resposta reabre o ciclo", () => {
    const waiting = apply(day0, [chat("1", { lastMessageAt: T0 })], T0)
    const answered = apply(waiting, [chat("1", { lastFromAccount: true, lastMessageAt: T0 + 2 * MIN })], T0 + 3 * MIN)
    const reopened = apply(answered, [chat("1", { lastMessageAt: T0 + 10 * MIN })], T0 + 11 * MIN)

    expect(reopened.conversations["1"]).toMatchObject({
      clientSince: T0 + 10 * MIN,
      firstResponseAt: null,
      lastMessageAuthor: "cliente"
    })
  })
})

describe("applyInbox — conciliação com o que o DOM viu na hora", () => {
  const observeSellerReply = (day: DayLog, key: string, now: number) =>
    observeConversation(day, {
      key,
      platform: "botconversa",
      label: "Maria Souza",
      author: "vendedor",
      text: "Oi, Maria!",
      messageCount: 4,
      now
    })

  it("responder no chat atualiza NA HORA, e a inbox atrasada não desfaz a resposta", () => {
    // 1) inbox traz o chat aguardando
    const waiting = apply(day0, [chat("1", { lastMessageAt: T0 })], T0 + MIN)
    // 2) o vendedor abre e responde: o DOM registra no mesmo instante, sem nova requisição
    const replied = observeSellerReply(waiting, "1", T0 + 3 * MIN)
    expect(conversationStatus(replied.conversations["1"], T0 + 3 * MIN).state).toBe("respondido")

    // 3) a próxima leitura da inbox ainda traz a mensagem do cliente (servidor não registrou ainda)
    const stale = apply(replied, [chat("1", { lastMessageAt: T0 })], T0 + 3 * MIN + 2_000)
    expect(stale.conversations["1"]).toMatchObject({ clientSince: null, lastMessageAuthor: "vendedor" })
    expect(conversationStatus(stale.conversations["1"], T0 + 4 * MIN).state).toBe("respondido")
  })

  it("só uma mensagem do cliente POSTERIOR à resposta local reabre a espera", () => {
    const waiting = apply(day0, [chat("1", { lastMessageAt: T0 })], T0 + MIN)
    const replied = observeSellerReply(waiting, "1", T0 + 3 * MIN)
    const clientAgain = apply(replied, [chat("1", { lastMessageAt: T0 + 5 * MIN })], T0 + 6 * MIN)
    expect(clientAgain.conversations["1"]).toMatchObject({ clientSince: T0 + 5 * MIN })
  })

  it("o DOM não sobrescreve o horário real da API na primeira observação do chat aberto", () => {
    const seeded = apply(day0, [chat("1", { lastMessageAt: T0 })], T0 + 10 * MIN)
    const observed = observeConversation(seeded, {
      key: "1",
      platform: "botconversa",
      label: "Maria Souza",
      author: "cliente",
      text: "Bom dia, tudo bem?",
      messageCount: 6,
      now: T0 + 10 * MIN
    })
    expect(observed.conversations["1"]).toMatchObject({ clientSince: T0, lastClientAt: T0 })
  })
})

describe("applyInbox — conversas que deixam de ser nossas", () => {
  it("libera a conversa aguardando que sumiu de uma varredura completa", () => {
    const waiting = apply(day0, [chat("1"), chat("2")], T0 + MIN)
    const next = apply(waiting, [chat("2")], T0 + 2 * MIN)

    expect(next.conversations["1"].released).toBe(true)
    expect(summarizeDay(next, T0 + 3 * MIN).waiting).toBe(1)
    expect(attentionQueue(next, T0 + 3 * MIN).map((item) => item.conversation.key)).toEqual(["2"])
    expect(buildReportInput(next, T0 + 3 * MIN).conversations.map((c) => c.key)).toEqual(["2"])
  })

  it("não libera nada quando a varredura foi cortada pelo teto de páginas", () => {
    const waiting = apply(day0, [chat("1"), chat("2")], T0 + MIN)
    const next = apply(waiting, [chat("2")], T0 + 2 * MIN, false)
    expect(next.conversations["1"].released).toBeFalsy()
  })

  it("mantém conversas já respondidas no histórico do dia", () => {
    const waiting = apply(day0, [chat("1")], T0)
    const answered = apply(waiting, [chat("1", { lastFromAccount: true, lastMessageAt: T0 + MIN })], T0 + 2 * MIN)
    const later = apply(answered, [], T0 + 3 * MIN)
    expect(later.conversations["1"].released).toBeFalsy()
    expect(summarizeDay(later, T0 + 4 * MIN).answered).toBe(1)
  })

  it("a conversa volta quando reaparece na lista", () => {
    const waiting = apply(day0, [chat("1")], T0)
    const released = apply(waiting, [], T0 + MIN)
    expect(released.conversations["1"].released).toBe(true)
    const back = apply(released, [chat("1")], T0 + 2 * MIN)
    expect(back.conversations["1"].released).toBe(false)
    expect(summarizeDay(back, T0 + 3 * MIN).waiting).toBe(1)
  })
})

describe("persistência dos campos da inbox", () => {
  it("round-trip pelo toDayLog preserva lastInboxAt e released", () => {
    const released = apply(apply(day0, [chat("1")], T0), [], T0 + MIN)
    const loaded = toDayLog(JSON.parse(JSON.stringify(released)), "2026-10-08")
    expect(loaded.conversations["1"]).toMatchObject({ lastInboxAt: T0, released: true })
  })

  it("dia antigo, sem os campos, continua válido e sem campos inventados", () => {
    const loaded = toDayLog({ conversations: { "1": { key: "1", label: "Ana" } }, updatedAt: 1 }, "2026-10-08")
    expect(loaded.conversations["1"]).not.toHaveProperty("released")
    expect(loaded.conversations["1"]).not.toHaveProperty("lastInboxAt")
  })

  it("valores inválidos no storage são descartados", () => {
    const loaded = toDayLog({ conversations: { "1": { key: "1", released: "sim", lastInboxAt: "ontem" } } }, "2026-10-08")
    expect(loaded.conversations["1"]).not.toHaveProperty("released")
    expect(loaded.conversations["1"]).not.toHaveProperty("lastInboxAt")
  })
})
