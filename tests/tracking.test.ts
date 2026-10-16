import { describe, expect, it } from "vitest"

import type { ChatMessage } from "~adapters/types"
import type { CoachingReport, DraftReview } from "~lib/ai/schemas"
import { WAIT_LIMITS_MS } from "~lib/tracking/constants"
import { confirmContactName, dayKey, rolloverDate, waitElapsed, waitLevel } from "~lib/tracking/level"
import { coachingSignal, reviewSignal, reviewSummary } from "~lib/tracking/signals"
import {
  attachCoaching,
  attachReview,
  emptyDay,
  mergeDayLogs,
  observeConversation,
  toDayLog
} from "~lib/tracking/store"
import type { ConversationObservation } from "~lib/tracking/store"
import type { DayLog, TrackedConversation } from "~lib/tracking/types"

const message = (author: ChatMessage["author"], text: string): ChatMessage => ({
  id: 1,
  author,
  text
})

describe("confirmContactName", () => {
  it("não confirma na primeira leitura: o cabeçalho pode ainda ser o da conversa anterior", () => {
    const first = confirmContactName(null, "chat-2", "Maria")
    expect(first.confirmed).toBeNull()
    expect(first.pending).toEqual({ key: "chat-2", name: "Maria" })
  })

  it("confirma quando a mesma conversa repete o mesmo nome no tick seguinte", () => {
    const first = confirmContactName(null, "chat-2", "Maria")
    expect(confirmContactName(first.pending, "chat-2", "Maria").confirmed).toBe("Maria")
  })

  it("não dá o nome da conversa anterior à conversa nova (cabeçalho atrasado)", () => {
    const old = confirmContactName(confirmContactName(null, "chat-1", "João").pending, "chat-1", "João")
    expect(old.confirmed).toBe("João")

    // URL já trocou para chat-2, mas o cabeçalho ainda mostra João: não confirma
    const stale = confirmContactName(old.pending, "chat-2", "João")
    expect(stale.confirmed).toBeNull()

    // cabeçalho atualizou: nome novo, ainda sem confirmar; só no tick seguinte vale
    const updated = confirmContactName(stale.pending, "chat-2", "Maria")
    expect(updated.confirmed).toBeNull()
    expect(confirmContactName(updated.pending, "chat-2", "Maria").confirmed).toBe("Maria")
  })

  it("zera o pendente quando não há nome na tela", () => {
    const pending = { key: "chat-1", name: "João" }
    expect(confirmContactName(pending, "chat-1", null)).toEqual({ confirmed: null, pending: null })
    expect(confirmContactName(pending, "chat-1", "")).toEqual({ confirmed: null, pending: null })
  })
})

const review = (over: Partial<DraftReview> = {}): DraftReview => ({
  status: "ajustes",
  warnings: [],
  suggestedText: "Olá!",
  changes: [],
  ...over
})

const bantItem = { status: "pendente" as const, evidence: "-", question: "?" }

const coaching = (over: Partial<CoachingReport> = {}): CoachingReport => ({
  summary: "Condução ok.",
  strengths: [],
  improvements: [],
  bant: { budget: bantItem, authority: bantItem, need: bantItem, timing: bantItem },
  nextStep: "Perguntar o prazo.",
  ...over
})

describe("reviewSummary", () => {
  it("resume a primeira alteração e conta quantas houve", () => {
    const summary = reviewSummary(
      review({
        changes: [
          { category: "tom", excerpt: "Oi", reason: "Tom mais próximo." },
          { category: "clareza", excerpt: "Ok", reason: "Frase direta." }
        ]
      })
    )
    expect(summary).toBe("2 ajustes: Tom mais próximo.")
  })

  it("usa o primeiro aviso quando não houve alteração", () => {
    expect(reviewSummary(review({ warnings: ["", "Confira o preço combinado."] }))).toBe(
      "Confira o preço combinado."
    )
  })

  it("tem um texto próprio quando não há nada a apontar", () => {
    expect(reviewSummary(review({ status: "ok" }))).toBe("Sem ajustes necessários")
  })

  it("corta resumos longos em uma linha só", () => {
    const summary = reviewSummary(review({ warnings: [`${"a".repeat(200)}\nsegunda linha`] }))
    expect(summary).toHaveLength(140)
    expect(summary.endsWith("…")).toBe(true)
    expect(summary).not.toContain("\n")
  })
})

describe("reviewSignal / coachingSignal", () => {
  it("anexam o status, o resumo e o instante da revisão", () => {
    const signal = reviewSignal(
      review({ status: "ok", changes: [{ category: "tom", excerpt: "Oi", reason: "Ok." }] }),
      1234
    )
    expect(signal).toEqual({ status: "ok", summary: "Ok.", at: 1234 })
  })

  it("resumem o coaching e preservam o próximo passo", () => {
    expect(coachingSignal(coaching({ summary: "  Boa escuta.  " }), 99)).toEqual({
      summary: "Boa escuta.",
      nextStep: "Perguntar o prazo.",
      at: 99
    })
  })
})

// --- Lógica pura do dia: data local, semáforo de espera e redutores do store --------------------

const conversation = (over: Partial<TrackedConversation> = {}): TrackedConversation => ({
  key: "chat-1",
  platform: "botconversa",
  label: "Cliente",
  openedAt: 1_000,
  lastSeenAt: 1_000,
  lastMessageAuthor: "cliente",
  lastMessageText: "Boa tarde",
  lastMessageAt: 1_000,
  clientSince: 1_000,
  firstResponseAt: null,
  lastClientAt: null,
  lastSellerAt: null,
  messageCount: 1,
  reviewCount: 0,
  ...over
})

const observation = (over: Partial<ConversationObservation> = {}): ConversationObservation => ({
  key: "chat-1",
  platform: "botconversa",
  label: "Cliente",
  author: "cliente",
  text: "Boa tarde",
  messageCount: 1,
  now: 1_000,
  ...over
})

describe("waitLevel", () => {
  it("é verde até o limite de 6 minutos, inclusive", () => {
    expect(waitLevel(0)).toBe("verde")
    expect(waitLevel(WAIT_LIMITS_MS.amarelo)).toBe("verde")
  })

  it("é amarelo até o limite de 12 minutos, inclusive", () => {
    expect(waitLevel(WAIT_LIMITS_MS.amarelo + 1)).toBe("amarelo")
    expect(waitLevel(WAIT_LIMITS_MS.laranja)).toBe("amarelo")
  })

  it("é laranja até o limite de 18 minutos, inclusive", () => {
    expect(waitLevel(WAIT_LIMITS_MS.laranja + 1)).toBe("laranja")
    expect(waitLevel(WAIT_LIMITS_MS.vermelho)).toBe("laranja")
  })

  it("é vermelho acima de 18 minutos, sem teto", () => {
    expect(waitLevel(WAIT_LIMITS_MS.vermelho + 1)).toBe("vermelho")
    expect(waitLevel(2 * 60 * 60_000)).toBe("vermelho")
  })
})

describe("dayKey", () => {
  it("usa a data local, sem passar por UTC", () => {
    // 23h59 local: com `toISOString` (UTC), no Brasil isso já cairia no dia seguinte.
    expect(dayKey(new Date(2026, 9, 7, 23, 59))).toBe("2026-10-07")
  })

  it("preenche mês e dia com zero à esquerda", () => {
    expect(dayKey(new Date(2026, 0, 5, 8, 0))).toBe("2026-01-05")
  })

  it("dá chaves distintas para 23:59 e 00:01, sem juntar os dois dias", () => {
    const antesDaMeiaNoite = new Date(2026, 9, 7, 23, 59)
    const depoisDaMeiaNoite = new Date(2026, 9, 8, 0, 1)
    expect(dayKey(antesDaMeiaNoite)).toBe("2026-10-07")
    expect(dayKey(depoisDaMeiaNoite)).toBe("2026-10-08")
    expect(dayKey(antesDaMeiaNoite)).not.toBe(dayKey(depoisDaMeiaNoite))
  })

  it("sem argumento, usa o dia local de agora", () => {
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`
    expect(dayKey()).toBe(expected)
  })
})

describe("waitElapsed", () => {
  it("conta o tempo desde a mensagem do cliente que aguarda resposta", () => {
    expect(waitElapsed(conversation({ clientSince: 1_000 }), 61_000)).toBe(60_000)
  })

  it("é nulo quando a conversa não está aguardando", () => {
    expect(waitElapsed(conversation({ clientSince: null }), 61_000)).toBeNull()
  })

  it("não devolve tempo negativo se o relógio andar para trás", () => {
    expect(waitElapsed(conversation({ clientSince: 61_000 }), 1_000)).toBe(0)
  })
})

describe("observeConversation", () => {
  it("registra uma conversa nova com o instante da primeira observação", () => {
    const day = observeConversation(emptyDay("2026-10-07"), observation({ now: 5_000 }))
    expect(day.conversations["chat-1"]).toMatchObject({
      key: "chat-1",
      platform: "botconversa",
      label: "Cliente",
      openedAt: 5_000,
      lastSeenAt: 5_000,
      lastMessageAuthor: "cliente",
      lastMessageText: "Boa tarde",
      lastMessageAt: 5_000,
      clientSince: 5_000,
      messageCount: 1
    })
    expect(day.updatedAt).toBe(5_000)
    expect(day.date).toBe("2026-10-07")
  })

  it("atualiza a mesma conversa sem regredir openedAt", () => {
    const first = observeConversation(emptyDay("2026-10-07"), observation({ now: 5_000 }))
    const second = observeConversation(
      first,
      observation({ now: 9_000, text: "Ainda aí?", messageCount: 2 })
    )
    expect(second.conversations["chat-1"].openedAt).toBe(5_000)
    expect(second.conversations["chat-1"].lastSeenAt).toBe(9_000)
    expect(second.conversations["chat-1"].lastMessageText).toBe("Ainda aí?")
    expect(second.conversations["chat-1"].messageCount).toBe(2)
  })

  it("grava clientSince só na primeira vez que a mensagem do cliente aparece", () => {
    const first = observeConversation(emptyDay("2026-10-07"), observation({ now: 5_000 }))
    const second = observeConversation(first, observation({ now: 8_000, text: "Oi de novo" }))
    expect(second.conversations["chat-1"].clientSince).toBe(5_000)
  })

  it("guarda o último instante em que cada autor falou, ignorando bot e sistema", () => {
    const first = observeConversation(emptyDay("2026-10-07"), observation({ now: 5_000 }))
    expect(first.conversations["chat-1"].lastClientAt).toBe(5_000)
    expect(first.conversations["chat-1"].lastSellerAt).toBeNull()

    const replied = observeConversation(
      first,
      observation({ now: 7_000, author: "vendedor", text: "Boa tarde!", messageCount: 2 })
    )
    expect(replied.conversations["chat-1"].lastSellerAt).toBe(7_000)
    expect(replied.conversations["chat-1"].lastClientAt).toBe(5_000)

    const withBot = observeConversation(
      replied,
      observation({ now: 8_000, author: "bot", text: "Bot parado", messageCount: 3 })
    )
    expect(withBot.conversations["chat-1"].lastClientAt).toBe(5_000)
    expect(withBot.conversations["chat-1"].lastSellerAt).toBe(7_000)
  })

  it("grava firstResponseAt só na primeira resposta do vendedor no ciclo", () => {
    const waiting = observeConversation(emptyDay("2026-10-07"), observation({ now: 5_000 }))
    expect(waiting.conversations["chat-1"].firstResponseAt).toBeNull()

    const firstReply = observeConversation(
      waiting,
      observation({ now: 7_000, author: "vendedor", text: "Boa tarde!", messageCount: 2 })
    )
    expect(firstReply.conversations["chat-1"].firstResponseAt).toBe(7_000)

    const secondReply = observeConversation(
      firstReply,
      observation({ now: 9_000, author: "vendedor", text: "Alguma dúvida?", messageCount: 3 })
    )
    expect(secondReply.conversations["chat-1"].firstResponseAt).toBe(7_000)
  })

  it("zera firstResponseAt quando o cliente abre um novo ciclo", () => {
    const firstReply = observeConversation(
      observeConversation(emptyDay("2026-10-07"), observation({ now: 5_000 })),
      observation({ now: 7_000, author: "vendedor", text: "Oi!", messageCount: 2 })
    )
    const reopened = observeConversation(
      firstReply,
      observation({ now: 9_000, author: "cliente", text: "E o prazo?", messageCount: 3 })
    )
    expect(reopened.conversations["chat-1"].firstResponseAt).toBeNull()
    expect(reopened.conversations["chat-1"].lastClientAt).toBe(9_000)
    expect(reopened.conversations["chat-1"].clientSince).toBe(9_000)
  })

  it("grava firstResponseAt na primeira mensagem do vendedor mesmo sem cliente observado", () => {
    const day = observeConversation(
      emptyDay("2026-10-07"),
      observation({ now: 5_000, author: "vendedor", text: "Bom dia" })
    )
    expect(day.conversations["chat-1"].firstResponseAt).toBe(5_000)
    expect(day.conversations["chat-1"].lastClientAt).toBeNull()
  })

  it("zera clientSince quando o vendedor responde", () => {
    const waiting = observeConversation(emptyDay("2026-10-07"), observation({ now: 5_000 }))
    const answered = observeConversation(
      waiting,
      observation({ now: 7_000, author: "vendedor", text: "Boa tarde!" })
    )
    expect(answered.conversations["chat-1"].clientSince).toBeNull()
    expect(answered.conversations["chat-1"].lastMessageAuthor).toBe("vendedor")
  })

  it("não mexe na espera em mensagem de bot ou sistema", () => {
    const waiting = observeConversation(emptyDay("2026-10-07"), observation({ now: 5_000 }))
    const withBot = observeConversation(waiting, observation({ now: 6_000, author: "bot" }))
    expect(withBot.conversations["chat-1"].clientSince).toBe(5_000)
  })

  it("não regride a contagem de mensagens nem o rótulo já conhecido", () => {
    const first = observeConversation(
      emptyDay("2026-10-07"),
      observation({ now: 5_000, messageCount: 4 })
    )
    const second = observeConversation(first, observation({ now: 6_000, messageCount: 2, label: "" }))
    expect(second.conversations["chat-1"].messageCount).toBe(4)
    expect(second.conversations["chat-1"].label).toBe("Cliente")
  })

  it("cai para a própria chave quando não há rótulo", () => {
    const day = observeConversation(emptyDay("2026-10-07"), observation({ label: "" }))
    expect(day.conversations["chat-1"].label).toBe("chat-1")
  })
})

describe("attachReview / attachCoaching", () => {
  it("anexam o sinal à conversa certa e contam mais uma revisão", () => {
    const day: DayLog = {
      ...emptyDay("2026-10-07"),
      conversations: {
        "chat-1": conversation({ key: "chat-1", reviewCount: 2 }),
        "chat-2": conversation({ key: "chat-2" })
      }
    }
    const withReview = attachReview(day, "chat-1", {
      status: "ok",
      summary: "Sem ajustes",
      at: 9_000
    })
    expect(withReview.conversations["chat-1"].lastReview).toEqual({
      status: "ok",
      summary: "Sem ajustes",
      at: 9_000
    })
    expect(withReview.conversations["chat-1"].reviewCount).toBe(3)
    expect(withReview.conversations["chat-2"].reviewCount).toBe(0)
    expect(withReview.conversations["chat-2"].lastReview).toBeUndefined()
    expect(withReview.updatedAt).toBe(9_000)
  })

  it("cria um registro mínimo quando a conversa ainda não foi observada", () => {
    const day = attachReview(emptyDay("2026-10-07"), "chat-9", {
      status: "ajustes",
      summary: "1 ajuste",
      at: 9_000
    })
    expect(day.conversations["chat-9"]).toMatchObject({
      key: "chat-9",
      openedAt: 9_000,
      reviewCount: 1
    })
  })

  it("anexam o coaching sem contar revisão", () => {
    const day = attachCoaching(emptyDay("2026-10-07"), "chat-1", {
      summary: "Boa escuta",
      nextStep: "Perguntar o prazo",
      at: 9_000
    })
    expect(day.conversations["chat-1"].lastCoaching).toEqual({
      summary: "Boa escuta",
      nextStep: "Perguntar o prazo",
      at: 9_000
    })
    expect(day.conversations["chat-1"].reviewCount).toBe(0)
  })

  it("registra a revisão e o coaching na mesma conversa", () => {
    const withReview = attachReview(emptyDay("2026-10-07"), "chat-1", {
      status: "ok",
      summary: "ok",
      at: 1_000
    })
    const withBoth = attachCoaching(withReview, "chat-1", {
      summary: "ok",
      nextStep: "seguir",
      at: 2_000
    })
    expect(withBoth.conversations["chat-1"].lastReview).toBeDefined()
    expect(withBoth.conversations["chat-1"].lastCoaching).toBeDefined()
    expect(withBoth.conversations["chat-1"].reviewCount).toBe(1)
    expect(withBoth.updatedAt).toBe(2_000)
  })
})

describe("toDayLog", () => {
  it("normaliza registro parcial preenchendo os momentos ausentes com null", () => {
    const day = toDayLog(
      {
        conversations: {
          "chat-1": { key: "chat-1", openedAt: 1_000, clientSince: 1_000, messageCount: 1 }
        },
        updatedAt: 2_000
      },
      "2026-10-07"
    )
    expect(day.date).toBe("2026-10-07")
    expect(day.updatedAt).toBe(2_000)
    expect(day.conversations["chat-1"]).toMatchObject({
      key: "chat-1",
      firstResponseAt: null,
      lastClientAt: null,
      lastSellerAt: null,
      clientSince: 1_000,
      messageCount: 1
    })
  })

  it("preserva os momentos já gravados e cai para a chave quando falta o rótulo", () => {
    const day = toDayLog(
      {
        conversations: {
          "chat-1": { firstResponseAt: 4_000, lastClientAt: 1_000, lastSellerAt: 5_000 }
        }
      },
      "2026-10-07"
    )
    expect(day.conversations["chat-1"]).toMatchObject({
      key: "chat-1",
      label: "chat-1",
      firstResponseAt: 4_000,
      lastClientAt: 1_000,
      lastSellerAt: 5_000
    })
    expect(day.updatedAt).toBe(0)
  })

  it("devolve um dia vazio para valor que não é um log", () => {
    expect(toDayLog(null, "2026-10-07")).toEqual(emptyDay("2026-10-07"))
    expect(toDayLog({ conversations: "nope" }, "2026-10-07")).toEqual(emptyDay("2026-10-07"))
  })
})

describe("virada de dia", () => {
  it("mantém cada dia na sua própria data, sem misturar conversas", () => {
    const day1 = observeConversation(emptyDay("2026-10-07"), observation({ now: 1_000 }))
    const day2 = observeConversation(
      emptyDay("2026-10-08"),
      observation({ now: 2_000, text: "Bom dia" })
    )
    expect(day1.date).toBe("2026-10-07")
    expect(day2.date).toBe("2026-10-08")
    expect(day1.conversations["chat-1"].lastMessageText).toBe("Boa tarde")
    expect(day2.conversations["chat-1"].lastMessageText).toBe("Bom dia")
    expect(day1.updatedAt).toBe(1_000)
    expect(day2.updatedAt).toBe(2_000)
  })

  it("o dia seguinte começa do zero para a mesma conversa", () => {
    const day1 = observeConversation(
      emptyDay("2026-10-07"),
      observation({ now: 1_000, messageCount: 5 })
    )
    const day2 = observeConversation(emptyDay("2026-10-08"), observation({ now: 2_000 }))
    expect(day1.conversations["chat-1"].messageCount).toBe(5)
    expect(day2.conversations["chat-1"]).toMatchObject({
      messageCount: 1,
      reviewCount: 0,
      clientSince: 2_000
    })
  })
})

describe("rolloverDate", () => {
  it("é nulo enquanto a data local não muda", () => {
    expect(rolloverDate("2026-10-07", new Date(2026, 9, 7, 23, 59).getTime())).toBeNull()
  })

  it("devolve a nova data um minuto depois da meia-noite", () => {
    expect(rolloverDate("2026-10-07", new Date(2026, 9, 8, 0, 1).getTime())).toBe("2026-10-08")
  })

  it("reconhece a virada de ano", () => {
    expect(rolloverDate("2026-12-31", new Date(2027, 0, 1, 0, 1).getTime())).toBe("2027-01-01")
  })

  it("detecta a virada assim que o relógio cruza a meia-noite", () => {
    expect(rolloverDate("2026-10-07", new Date(2026, 9, 8, 0, 0, 1).getTime())).toBe("2026-10-08")
  })
})

describe("mergeDayLogs", () => {
  const dayWith = (
    date: string,
    conversations: Record<string, Partial<TrackedConversation>>,
    updatedAt = 0
  ): DayLog => ({
    date,
    updatedAt,
    conversations: Object.fromEntries(
      Object.entries(conversations).map(([key, over]) => [key, conversation({ key, ...over })])
    )
  })

  it("junta conversas diferentes das duas gravações sem perder nenhuma", () => {
    const stored = dayWith("2026-10-07", { "chat-1": { lastSeenAt: 1_000 } }, 1_000)
    const local = dayWith("2026-10-07", { "chat-2": { lastSeenAt: 2_000 } }, 2_000)
    const merged = mergeDayLogs(stored, local)
    expect(Object.keys(merged.conversations).sort()).toEqual(["chat-1", "chat-2"])
    expect(merged.updatedAt).toBe(2_000)
    expect(merged.date).toBe("2026-10-07")
  })

  it("na mesma conversa, o registro visto mais recentemente vence", () => {
    const stored = dayWith(
      "2026-10-07",
      { "chat-1": { lastSeenAt: 1_000, lastMessageText: "antigo", clientSince: 1_000 } },
      1_000
    )
    const local = dayWith(
      "2026-10-07",
      { "chat-1": { lastSeenAt: 3_000, lastMessageText: "novo", clientSince: null } },
      3_000
    )
    const merged = mergeDayLogs(stored, local)
    expect(merged.conversations["chat-1"].lastMessageText).toBe("novo")
    expect(merged.conversations["chat-1"].clientSince).toBeNull()
  })

  it("não regride contadores e preserva a revisão mais recente", () => {
    const stored = dayWith("2026-10-07", {
      "chat-1": {
        lastSeenAt: 3_000,
        messageCount: 5,
        reviewCount: 2,
        lastReview: { status: "ok", summary: "antiga", at: 1_000 }
      }
    })
    const local = dayWith("2026-10-07", {
      "chat-1": {
        lastSeenAt: 2_000,
        messageCount: 1,
        reviewCount: 1,
        lastReview: { status: "ajustes", summary: "nova", at: 2_000 }
      }
    })
    const merged = mergeDayLogs(stored, local)
    expect(merged.conversations["chat-1"].messageCount).toBe(5)
    expect(merged.conversations["chat-1"].reviewCount).toBe(2)
    expect(merged.conversations["chat-1"].lastReview?.summary).toBe("nova")
  })

  it("mantém o coaching que só existe de um lado", () => {
    const stored = dayWith("2026-10-07", {
      "chat-1": { lastSeenAt: 1_000, lastCoaching: { summary: "escuta", nextStep: "seguir", at: 900 } }
    })
    const local = dayWith("2026-10-07", { "chat-1": { lastSeenAt: 2_000 } })
    const merged = mergeDayLogs(stored, local)
    expect(merged.conversations["chat-1"].lastCoaching?.nextStep).toBe("seguir")
  })
})
