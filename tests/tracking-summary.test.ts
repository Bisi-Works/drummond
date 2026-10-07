import { describe, expect, it } from "vitest"

import { WAIT_LIMITS_MS } from "~lib/tracking/constants"
import { waitLevel } from "~lib/tracking/level"
import {
  attentionQueue,
  averageFirstResponseMs,
  averageResponseMs,
  conversationStatus,
  firstResponseMs,
  responseMs,
  summarizeDay
} from "~lib/tracking/summary"
import type { ConversationMoments } from "~lib/tracking/summary"
import { emptyDay } from "~lib/tracking/store"
import type { DayLog, TrackedConversation } from "~lib/tracking/types"

// Agregações puras do dia: `now` é sempre injetado, então os limites do semáforo são exercitados
// sem navegador e sem relógio global. Aqui só entram `summary.ts`/`level.ts` — nenhum `chrome`.

const NOW = 1_800_000

/** Conversa sintética com os momentos opcionais da Fase 02 (ainda não são campos do modelo). */
type Fixture = TrackedConversation & ConversationMoments

const conversation = (over: Partial<Fixture> = {}): Fixture => ({
  key: "chat-1",
  platform: "botconversa",
  label: "Cliente",
  openedAt: 1_000,
  lastSeenAt: 1_000,
  lastMessageAuthor: "cliente",
  lastMessageText: "Boa tarde",
  lastMessageAt: 1_000,
  clientSince: 1_000,
  messageCount: 1,
  reviewCount: 0,
  ...over
})

/** Monta o dia a partir de uma lista; a ordem de inserção no objeto fica a critério do teste. */
const day = (conversations: Fixture[], date = "2026-10-07"): DayLog => ({
  date,
  conversations: Object.fromEntries(conversations.map((item) => [item.key, item])),
  updatedAt: 0
})

describe("conversationStatus", () => {
  it("aguardando: conta a espera desde o clientSince e aplica o semáforo", () => {
    const elapsed = WAIT_LIMITS_MS.laranja + 1_000
    const status = conversationStatus(conversation({ clientSince: NOW - elapsed }), NOW)
    expect(status).toEqual({
      state: "aguardando",
      level: waitLevel(elapsed),
      elapsedMs: elapsed
    })
    expect(status.level).toBe("laranja")
  })

  it("aguardando sem clientSince: estado de ação, mas sem inventar tempo nem nível", () => {
    const status = conversationStatus(
      conversation({ clientSince: null, lastMessageAuthor: "cliente" }),
      NOW
    )
    expect(status).toEqual({ state: "aguardando", level: null, elapsedMs: null })
  })

  it("respondido: o vendedor falou por último, sem espera aberta", () => {
    const status = conversationStatus(
      conversation({ clientSince: null, lastMessageAuthor: "vendedor" }),
      NOW
    )
    expect(status).toEqual({ state: "respondido", level: null, elapsedMs: null })
  })

  it("respondido depois de bot/sistema, porque eles não reabrem a espera", () => {
    const status = conversationStatus(
      conversation({ clientSince: null, lastMessageAuthor: "bot" }),
      NOW
    )
    expect(status.state).toBe("respondido")
    expect(status.level).toBeNull()
  })

  it("sem-mensagem: nada observado ainda, sem espera nem nível", () => {
    const status = conversationStatus(
      conversation({ clientSince: null, lastMessageAuthor: null }),
      NOW
    )
    expect(status).toEqual({ state: "sem-mensagem", level: null, elapsedMs: null })
  })

  it("não devolve espera negativa se o relógio andar para trás", () => {
    const status = conversationStatus(conversation({ clientSince: NOW + 5_000 }), NOW)
    expect(status.elapsedMs).toBe(0)
    expect(status.level).toBe("verde")
  })
})

describe("summarizeDay", () => {
  const syntheticDay = (): DayLog =>
    day([
      // Aguardando, um por nível do semáforo.
      conversation({ key: "verde", clientSince: NOW - 60_000 }),
      conversation({ key: "amarelo", clientSince: NOW - (WAIT_LIMITS_MS.amarelo + 1_000) }),
      conversation({
        key: "laranja",
        clientSince: NOW - (WAIT_LIMITS_MS.laranja + 1_000),
        reviewCount: 2
      }),
      conversation({
        key: "vermelho",
        clientSince: NOW - (WAIT_LIMITS_MS.vermelho + 1_000),
        reviewCount: 1,
        lastCoaching: { summary: "Boa escuta", nextStep: "Cobrar prazo", at: NOW }
      }),
      conversation({ key: "respondido", clientSince: null, lastMessageAuthor: "vendedor" }),
      conversation({ key: "sem-mensagem", clientSince: null, lastMessageAuthor: null })
    ])

  it("conta as conversas por estado e por nível do semáforo", () => {
    const summary = summarizeDay(syntheticDay(), NOW)
    expect(summary).toMatchObject({
      conversations: 6,
      waiting: 4,
      waitingByLevel: { verde: 1, amarelo: 1, laranja: 1, vermelho: 1 },
      alerts: 2,
      answered: 1,
      withoutMessage: 1
    })
  })

  it("soma as revisões do dia e conta as conversas com coaching anexado", () => {
    const summary = summarizeDay(syntheticDay(), NOW)
    expect(summary.reviews).toBe(3)
    expect(summary.coachings).toBe(1)
  })

  it("conta o aguardando sem clientSince em waiting, mas fora de waitingByLevel", () => {
    const partial = day([
      conversation({ key: "sem-client-since", clientSince: null, lastMessageAuthor: "cliente" })
    ])
    const summary = summarizeDay(partial, NOW)
    expect(summary.waiting).toBe(1)
    expect(summary.waitingByLevel).toEqual({ verde: 0, amarelo: 0, laranja: 0, vermelho: 0 })
    expect(summary.alerts).toBe(0)
  })

  it("dia vazio zera os totais e não devolve média inventada", () => {
    const summary = summarizeDay(emptyDay("2026-10-07"), NOW)
    expect(summary).toEqual({
      conversations: 0,
      waiting: 0,
      waitingByLevel: { verde: 0, amarelo: 0, laranja: 0, vermelho: 0 },
      alerts: 0,
      answered: 0,
      withoutMessage: 0,
      reviews: 0,
      coachings: 0,
      averageFirstResponseMs: null,
      averageResponseMs: null
    })
  })
})

describe("averageFirstResponseMs / averageResponseMs", () => {
  it("é nulo sem nenhuma amostra, em vez de devolver zero", () => {
    expect(averageFirstResponseMs(emptyDay("2026-10-07"))).toBeNull()
    expect(averageResponseMs(emptyDay("2026-10-07"))).toBeNull()
  })

  it("é nulo quando só há conversas aguardando ou sem mensagem", () => {
    const waiting = day([
      conversation({ key: "a", clientSince: NOW - 60_000 }),
      conversation({ key: "b", clientSince: null, lastMessageAuthor: null })
    ])
    expect(averageFirstResponseMs(waiting)).toBeNull()
    expect(averageResponseMs(waiting)).toBeNull()
  })

  it("usa os momentos gravados pelo store para a primeira resposta e a resposta atual", () => {
    const withMoments = day([
      conversation({ key: "a", lastClientAt: 1_000, firstResponseAt: 4_000, lastSellerAt: 4_000 }),
      conversation({ key: "b", lastClientAt: 2_000, firstResponseAt: 6_000, lastSellerAt: 5_000 })
    ])
    expect(averageFirstResponseMs(withMoments)).toBe(3_500)
    expect(averageResponseMs(withMoments)).toBe(3_000)
  })

  it("conta a primeira resposta a partir do cliente que abriu o ciclo, com openedAt de reserva", () => {
    expect(
      firstResponseMs(
        conversation({ openedAt: 1_000, lastClientAt: 2_000, firstResponseAt: 5_000 })
      )
    ).toBe(3_000)
    expect(
      firstResponseMs(conversation({ openedAt: 1_000, lastClientAt: null, firstResponseAt: 5_000 }))
    ).toBe(4_000)
  })

  it("cai na janela observada quando o dia não tem os momentos", () => {
    const answered = conversation({
      lastMessageAuthor: "vendedor",
      clientSince: null,
      openedAt: 1_000,
      lastMessageAt: 5_000
    })
    expect(firstResponseMs(answered)).toBe(4_000)
    expect(responseMs(answered)).toBe(4_000)
  })

  it("não inventa intervalo quando falta um dos momentos", () => {
    const partial = conversation({
      lastClientAt: 1_000,
      lastSellerAt: null,
      clientSince: NOW - 1_000,
      lastMessageAuthor: "cliente"
    })
    expect(responseMs(partial)).toBeNull()
  })

  it("arredonda a média para o ms inteiro", () => {
    const rounded = day([
      conversation({ key: "a", lastClientAt: 1_000, firstResponseAt: 2_000, lastSellerAt: 2_000 }),
      conversation({ key: "b", lastClientAt: 1_000, firstResponseAt: 3_001, lastSellerAt: 3_001 })
    ])
    expect(averageFirstResponseMs(rounded)).toBe(1_501)
  })
})

describe("attentionQueue", () => {
  const keys = (log: DayLog): string[] =>
    attentionQueue(log, NOW).map((item) => item.conversation.key)

  const ordered = (): Fixture[] => [
    conversation({ key: "verde", clientSince: NOW - 1_000 }),
    conversation({ key: "vermelho-curto", clientSince: NOW - (WAIT_LIMITS_MS.vermelho + 1_000) }),
    conversation({ key: "laranja", clientSince: NOW - (WAIT_LIMITS_MS.laranja + 1_000) }),
    conversation({ key: "vermelho-longo", clientSince: NOW - (WAIT_LIMITS_MS.vermelho + 60_000) }),
    conversation({ key: "amarelo", clientSince: NOW - (WAIT_LIMITS_MS.amarelo + 1_000) })
  ]

  it("ordena por severidade (vermelho → verde) e, no mesmo nível, pela espera mais longa", () => {
    expect(keys(day(ordered()))).toEqual([
      "vermelho-longo",
      "vermelho-curto",
      "laranja",
      "amarelo",
      "verde"
    ])
  })

  it("carrega o status de cada item (nível e tempo de espera) para a UI", () => {
    const [first] = attentionQueue(day(ordered()), NOW)
    expect(first.conversation.key).toBe("vermelho-longo")
    expect(first.status.state).toBe("aguardando")
    expect(first.status.level).toBe("vermelho")
    expect(first.status.elapsedMs).toBe(WAIT_LIMITS_MS.vermelho + 60_000)
  })

  it("não depende da ordem de inserção no objeto do dia", () => {
    const items = ordered()
    expect(keys(day([...items].reverse()))).toEqual(keys(day(items)))
  })

  it("deixa de fora quem já foi respondido e quem ainda não tem mensagem", () => {
    const mixed = day([
      ...ordered(),
      conversation({ key: "respondido", clientSince: null, lastMessageAuthor: "vendedor" }),
      conversation({ key: "sem-mensagem", clientSince: null, lastMessageAuthor: null })
    ])
    expect(keys(mixed)).not.toContain("respondido")
    expect(keys(mixed)).not.toContain("sem-mensagem")
  })

  it("coloca o registro sem clientSince no fim: severidade mais branda e espera zero", () => {
    const partial = day([
      conversation({ key: "sem-client-since", clientSince: null, lastMessageAuthor: "cliente" }),
      conversation({ key: "verde", clientSince: NOW - 1_000 })
    ])
    expect(keys(partial)).toEqual(["verde", "sem-client-since"])
  })

  it("desempata pela key quando nível e tempo são iguais (ordem determinística)", () => {
    const tied = day([
      conversation({ key: "chat-b", clientSince: NOW - 10_000 }),
      conversation({ key: "chat-a", clientSince: NOW - 10_000 })
    ])
    expect(keys(tied)).toEqual(["chat-a", "chat-b"])
  })
})
