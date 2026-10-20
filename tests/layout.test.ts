import { describe, expect, it } from "vitest"

import { fitCount, MIN_CHAT_WIDTH, shouldPushPage } from "~lib/layout"

describe("fitCount", () => {
  it("mostra todos quando cabem, sem reservar o +N", () => {
    expect(fitCount([100, 100, 100], 310, 5, 50)).toBe(3)
  })

  it("reserva o +N quando sobra alguém", () => {
    // 2 itens + gap + "+N" = 100 + 5 + 100 + 5 + 50 = 260
    expect(fitCount([100, 100, 100], 260, 5, 50)).toBe(2)
    expect(fitCount([100, 100, 100], 259, 5, 50)).toBe(1)
  })

  it("devolve 0 sem espaço nem para um item e o +N, e com fila vazia", () => {
    expect(fitCount([100, 100], 120, 5, 50)).toBe(0)
    expect(fitCount([], 0, 5, 50)).toBe(0)
  })
})

describe("shouldPushPage", () => {
  it("empurra só se o chat continuar com o mínimo depois de perder o drawer", () => {
    expect(shouldPushPage(MIN_CHAT_WIDTH + 400, false, 400)).toBe(true)
    expect(shouldPushPage(MIN_CHAT_WIDTH + 399, false, 400)).toBe(false)
  })

  it("já empurrado, mantém enquanto o chat atual tiver o mínimo (não oscila)", () => {
    expect(shouldPushPage(MIN_CHAT_WIDTH, true, 400)).toBe(true)
    expect(shouldPushPage(MIN_CHAT_WIDTH - 1, true, 400)).toBe(false)
  })
})
