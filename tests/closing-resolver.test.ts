import { describe, expect, it, vi } from "vitest"

import type { InboxChat, InboxMessage } from "~adapters/types"
import type { ClassifyClosingResponse } from "~lib/messages"
import { createClosingResolver, type ClosingResolverDeps } from "~lib/tracking/closing-resolver"

const T = Date.parse("2026-10-08T14:00:00Z")

const chat = (key: string, preview: string, over: Partial<InboxChat> = {}): InboxChat => ({
  key,
  name: "Maria",
  lastMessageAt: T,
  lastFromAccount: false,
  lastKind: "message",
  preview,
  ...over
})

const msg = (fromAccount: boolean, text: string, over: Partial<InboxMessage> = {}): InboxMessage => ({
  fromAccount,
  text,
  at: T,
  kind: "message",
  ...over
})

const setup = (
  conversation: InboxMessage[] | null,
  answer: ClassifyClosingResponse = { ok: true, closing: true, pNoReply: 0.99 }
) => {
  let clock = T
  const recentMessages = vi.fn(async () => conversation)
  const classify = vi.fn(async () => answer)
  const deps: ClosingResolverDeps = { recentMessages, classify, now: () => clock }
  return { deps, recentMessages, classify, advance: (ms: number) => (clock += ms), resolver: createClosingResolver(deps) }
}

const kinds = async (resolver: ReturnType<typeof setup>["resolver"], chats: InboxChat[]) =>
  (await resolver.resolve(chats)).map((c) => c.lastKind)

describe("cascata: regra de texto primeiro, IA só no meio-termo", () => {
  it("encerramento óbvio é resolvido pela regra, sem gastar IA", async () => {
    const { resolver, classify } = setup([msg(false, "Obrigado!"), msg(true, "Segue o contrato.")])
    expect(await kinds(resolver, [chat("1", "Obrigado!")])).toEqual(["closing"])
    expect(classify).not.toHaveBeenCalled()
  })

  it("mensagem que a regra não reconhece vai para a IA com a mensagem anterior do vendedor", async () => {
    const { resolver, classify } = setup([msg(false, "Pra você também!"), msg(true, "Tenha um ótimo dia!")])
    expect(await kinds(resolver, [chat("1", "Pra você também!")])).toEqual(["closing"])
    expect(classify).toHaveBeenCalledWith({ previous: "Tenha um ótimo dia!", text: "Pra você também!" })
  })

  it("a IA que não tem certeza deixa a conversa aguardando", async () => {
    const { resolver } = setup([msg(false, "Vou pensar"), msg(true, "O que acha da proposta?")], {
      ok: true,
      closing: false,
      pNoReply: 0.4
    })
    expect(await kinds(resolver, [chat("1", "Vou pensar")])).toEqual(["message"])
  })

  it("'ok' em resposta a uma PERGUNTA do vendedor não é encerramento: decide a IA", async () => {
    const { resolver, classify } = setup(
      [msg(false, "Ok"), msg(true, "Posso te enviar a proposta?")],
      { ok: true, closing: false, pNoReply: 0.2 }
    )
    expect(await kinds(resolver, [chat("1", "Ok", { lastKind: "closing" })])).toEqual(["message"])
    expect(classify).toHaveBeenCalledOnce()
  })

  it("se a IA falha com uma pergunta no meio, o lado seguro é aguardar (nunca esconder)", async () => {
    const { resolver } = setup([msg(false, "Ok"), msg(true, "Posso te ligar?")], { ok: false, error: "fora do ar" })
    expect(await kinds(resolver, [chat("1", "Ok", { lastKind: "closing" })])).toEqual(["message"])
  })

  it("mensagem longa, com pergunta ou mídia nunca vai à IA e continua aguardando", async () => {
    const { resolver, classify } = setup(null)
    const chats = [
      chat("1", "Obrigado, mas qual o prazo?"),
      chat("2", "Perfeito. Então me envia a proposta por favor para eu analisar com calma depois que eu voltar"),
      chat("3", "[áudio]")
    ]
    expect(await kinds(resolver, chats)).toEqual(["message", "message", "message"])
    expect(classify).not.toHaveBeenCalled()
  })

  it("chat cuja última mensagem é nossa, nota ou evento de sistema nem é consultado", async () => {
    const { resolver, recentMessages } = setup([])
    const chats = [
      chat("1", "Segue o link", { lastFromAccount: true }),
      chat("2", "Nota interna", { lastKind: "note" }),
      chat("3", "Bot parado", { lastKind: "system" })
    ]
    expect((await resolver.resolve(chats)).map((c) => c.lastKind)).toEqual(["message", "note", "system"])
    expect(recentMessages).not.toHaveBeenCalled()
  })

  it("se o vendedor já respondeu desde a leitura da lista, não decide nada e mantém o que veio", async () => {
    const { resolver, classify } = setup([msg(true, "Já te respondi"), msg(false, "Pra você também!")])
    expect(await kinds(resolver, [chat("1", "Pra você também!")])).toEqual(["message"])
    expect(classify).not.toHaveBeenCalled()
  })
})

describe("cascata: cache e falhas", () => {
  it("o mesmo chat com a mesma mensagem é decidido uma vez só", async () => {
    const { resolver, classify, recentMessages } = setup([msg(false, "Pra você também!"), msg(true, "Bom dia!")])
    await resolver.resolve([chat("1", "Pra você também!")])
    await resolver.resolve([chat("1", "Pra você também!")])
    expect(classify).toHaveBeenCalledTimes(1)
    expect(recentMessages).toHaveBeenCalledTimes(1)
  })

  it("uma mensagem nova do cliente no mesmo chat é decidida de novo", async () => {
    const { resolver, classify } = setup([msg(false, "Pra você também!"), msg(true, "Bom dia!")])
    await resolver.resolve([chat("1", "Pra você também!", { lastMessageAt: T })])
    await resolver.resolve([chat("1", "Pra você também!", { lastMessageAt: T + 60_000 })])
    expect(classify).toHaveBeenCalledTimes(2)
  })

  it("falha da IA não é repetida a cada leitura: só depois do prazo", async () => {
    const { resolver, classify, advance } = setup([msg(false, "Pra você também!"), msg(true, "Bom dia!")], {
      ok: false,
      error: "fora do ar"
    })
    expect(await kinds(resolver, [chat("1", "Pra você também!")])).toEqual(["message"])
    expect(await kinds(resolver, [chat("1", "Pra você também!")])).toEqual(["message"])
    expect(classify).toHaveBeenCalledTimes(1)

    advance(6 * 60_000)
    await resolver.resolve([chat("1", "Pra você também!")])
    expect(classify).toHaveBeenCalledTimes(2)
  })

  it("falha ao ler as mensagens não é guardada: tenta de novo na próxima leitura", async () => {
    const { resolver, recentMessages } = setup(null)
    expect(await kinds(resolver, [chat("1", "Obrigado!")])).toEqual(["closing"]) // regra, sem contexto
    await resolver.resolve([chat("1", "Obrigado!")])
    expect(recentMessages).toHaveBeenCalledTimes(2)
  })

  it("exceção em qualquer dependência vira 'aguardando', sem derrubar a rodada", async () => {
    const deps: ClosingResolverDeps = {
      recentMessages: async () => {
        throw new Error("DOM trocando")
      },
      classify: async () => ({ ok: true, closing: true, pNoReply: 1 }),
      now: () => T
    }
    const resolver = createClosingResolver(deps)
    const result = await resolver.resolve([chat("1", "Pra você também!"), chat("2", "Obrigado!", { lastKind: "closing" })])
    expect(result.map((c) => c.lastKind)).toEqual(["message", "closing"])
  })

  it("respeita o teto de tempo: o que não terminou fica como veio", async () => {
    const deps: ClosingResolverDeps = {
      recentMessages: () => new Promise(() => {}), // nunca responde
      classify: async () => ({ ok: true, closing: true, pNoReply: 1 }),
      now: () => T
    }
    const resolver = createClosingResolver(deps, { budgetMs: 20 })
    const started = Date.now()
    const result = await resolver.resolve([chat("1", "Pra você também!")])
    expect(Date.now() - started).toBeLessThan(500)
    expect(result[0].lastKind).toBe("message")
  })
})
