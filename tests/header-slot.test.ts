// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"

import { headerSlotBox, MIN_SLOT_WIDTH } from "~hooks/useHeaderSlot"

// O happy-dom não faz layout: cada elemento recebe a caixa que o teste dá.
const at = (left: number, width: number, top = 0, height = 64) => {
  const el = document.createElement("div")
  el.getBoundingClientRect = () => new DOMRect(left, top, width, height)
  return el
}

describe("headerSlotBox", () => {
  it("é o espaço entre o título e os ícones, com respiro dos dois lados", () => {
    const box = headerSlotBox({ bar: at(72, 1840), start: at(88, 52), end: at(1740, 156) })
    expect(box).toEqual({ top: 0, bottom: 64, height: 64, left: 156, right: 1724, width: 1568 })
  })

  it("sem as pontas, usa as bordas do cabeçalho", () => {
    const box = headerSlotBox({ bar: at(72, 1000), start: null, end: null })
    expect(box).toMatchObject({ left: 88, right: 1056 })
  })

  it("devolve null sem cabeçalho visível ou sem espaço para a barra", () => {
    expect(headerSlotBox(null)).toBeNull()
    expect(headerSlotBox({ bar: at(0, 0), start: null, end: null })).toBeNull()
    const narrow = MIN_SLOT_WIDTH + 32 - 1
    expect(headerSlotBox({ bar: at(0, narrow), start: null, end: null })).toBeNull()
  })
})
