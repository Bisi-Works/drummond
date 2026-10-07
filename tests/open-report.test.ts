import { afterEach, describe, expect, it, vi } from "vitest"

import handler from "~background/messages/open-report"

// A rota `open-report` existe porque `chrome.tabs` não chega ao content script: o widget só manda a
// data e o background abre `tabs/report.html`. O teste trava o contrato (URL montada, validação da
// data e falha do navegador) com um `chrome` de mentira, sem navegador nem build.

interface FakeChrome {
  create: ReturnType<typeof vi.fn>
  getURL: ReturnType<typeof vi.fn>
}

const installChrome = (createImpl?: (properties: { url: string }) => Promise<unknown>): FakeChrome => {
  const getURL = vi.fn((path: string) => `chrome-extension://drummond/${path}`)
  const create = vi.fn(createImpl ?? (async () => ({})))
  Object.defineProperty(globalThis, "chrome", {
    value: { runtime: { getURL }, tabs: { create } },
    configurable: true,
    writable: true
  })
  return { create, getURL }
}

/** `res` mínimo: só o `send` que o handler usa. */
const responder = <T,>() => {
  const send = vi.fn<(body: T) => void>()
  return { res: { send } as unknown as Parameters<typeof handler>[1], send }
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "chrome")
  vi.restoreAllMocks()
})

describe("open-report", () => {
  it("abre tabs/report.html com a data no ?date=", async () => {
    const { create, getURL } = installChrome()
    const { res, send } = responder()

    await handler({ body: { date: "2026-10-07" } } as never, res)

    expect(getURL).toHaveBeenCalledWith("tabs/report.html?date=2026-10-07")
    expect(create).toHaveBeenCalledWith({ url: "chrome-extension://drummond/tabs/report.html?date=2026-10-07" })
    expect(send).toHaveBeenCalledWith({ ok: true })
  })

  it("data fora do formato cai para o último relatório (sem ?date=)", async () => {
    const { create } = installChrome()
    const { res, send } = responder()

    await handler({ body: { date: "ontem" } } as never, res)

    expect(create).toHaveBeenCalledWith({ url: "chrome-extension://drummond/tabs/report.html" })
    expect(send).toHaveBeenCalledWith({ ok: true })
  })

  it("sem corpo, não quebra e abre a página sem data", async () => {
    const { create } = installChrome()
    const { res, send } = responder()

    await handler({} as never, res)

    expect(create).toHaveBeenCalledWith({ url: "chrome-extension://drummond/tabs/report.html" })
    expect(send).toHaveBeenCalledWith({ ok: true })
  })

  it("navegador recusando a aba devolve ok:false com a mensagem", async () => {
    installChrome(async () => {
      throw new Error("aba bloqueada")
    })
    const { res, send } = responder()

    await handler({ body: { date: "2026-10-07" } } as never, res)

    expect(send).toHaveBeenCalledWith({ ok: false, error: "aba bloqueada" })
  })
})
