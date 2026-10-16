import { afterEach, describe, expect, it } from "vitest"

import { localArea, storageChanges } from "~lib/chrome-storage"

// O helper centraliza o fallback silencioso de `chrome.storage` (extensão recarregada com a página
// aberta). O ponto do teste é que o acesso à propriedade acontece dentro do `try`: um getter que
// lança deve virar `null`, não propagar a exceção para o efeito React que chamou.

const setChrome = (value: unknown) => {
  Object.defineProperty(globalThis, "chrome", { value, configurable: true, writable: true })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "chrome")
})

describe("localArea", () => {
  it("devolve a área local quando o storage existe", () => {
    const local = { get: () => {}, set: () => {}, remove: () => {} }
    setChrome({ storage: { local } })

    expect(localArea()).toBe(local)
  })

  it("devolve null sem `chrome`, sem `chrome.storage` ou sem `chrome.storage.local`", () => {
    Reflect.deleteProperty(globalThis, "chrome")
    expect(localArea()).toBeNull()

    setChrome({})
    expect(localArea()).toBeNull()

    setChrome({ storage: {} })
    expect(localArea()).toBeNull()
  })

  it("devolve null quando o acesso a `chrome.storage` lança (extensão recarregada)", () => {
    setChrome({
      get storage() {
        throw new Error("Extension context invalidated")
      }
    })

    expect(() => localArea()).not.toThrow()
    expect(localArea()).toBeNull()
  })
})

describe("storageChanges", () => {
  it("devolve a área de eventos quando existe", () => {
    const onChanged = { addListener: () => {}, removeListener: () => {} }
    setChrome({ storage: { onChanged } })

    expect(storageChanges()).toBe(onChanged)
  })

  it("devolve null sem `chrome`, sem `onChanged` ou quando o acesso lança", () => {
    Reflect.deleteProperty(globalThis, "chrome")
    expect(storageChanges()).toBeNull()

    setChrome({ storage: {} })
    expect(storageChanges()).toBeNull()

    setChrome({
      get storage() {
        throw new Error("Extension context invalidated")
      }
    })
    expect(() => storageChanges()).not.toThrow()
    expect(storageChanges()).toBeNull()
  })
})
