import { describe, expect, it } from "vitest"

import { DEFAULT_THEME, toTheme } from "~lib/theme"

describe("toTheme", () => {
  it("o padrão é o escuro", () => {
    expect(DEFAULT_THEME).toBe("dark")
  })

  it("mantém a escolha salva", () => {
    expect(toTheme("light")).toBe("light")
    expect(toTheme("dark")).toBe("dark")
  })

  it("sem nada salvo, ou com valor inválido, usa o padrão", () => {
    expect(toTheme(undefined)).toBe("dark")
    expect(toTheme("sepia")).toBe("dark")
    expect(toTheme(1)).toBe("dark")
  })
})
