// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { readComposerText, setComposerText } from "~adapters/dom"

// O happy-dom não implementa execCommand; no Chrome ele existe (e não dispara beforeinput).
beforeEach(() => {
  Object.defineProperty(document, "execCommand", { value: () => false, configurable: true, writable: true })
})

afterEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

// Imita um editor rico (Lexical): trata o paste pelo próprio pipeline e ignora mudanças externas.
const mountRichEditor = (initial: string) => {
  document.body.innerHTML = `<div contenteditable="true" data-lexical-editor="true"><p>${initial}</p></div>`
  const editor = document.querySelector<HTMLElement>("[data-lexical-editor]")!
  editor.addEventListener("paste", (event) => {
    event.preventDefault()
    const text = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? ""
    editor.innerHTML = `<p>${text.split("\n").join("<br>")}</p>`
  })
  return editor
}

describe("setComposerText", () => {
  it("textarea: define o valor e dispara input para o React/Vue da página", async () => {
    document.body.innerHTML = "<textarea>antigo</textarea>"
    const textarea = document.querySelector("textarea")!
    const onInput = vi.fn()
    textarea.addEventListener("input", onInput)

    expect(await setComposerText(textarea, "novo texto")).toBe(true)
    expect(textarea.value).toBe("novo texto")
    expect(onInput).toHaveBeenCalled()
  })

  it("editor rico: substitui via paste, com quebras de linha, sem usar execCommand", async () => {
    const editor = mountRichEditor("ola tudo bem")
    const execCommand = vi.spyOn(document, "execCommand")

    expect(await setComposerText(editor, "Olá, tudo bem?\n\nSegunda linha.")).toBe(true)
    expect(readComposerText(editor)).toBe("Olá, tudo bem?\n\nSegunda linha.")
    expect(execCommand).not.toHaveBeenCalled()
  })

  it("contenteditable simples (não trata paste): cai no execCommand", async () => {
    document.body.innerHTML = '<div contenteditable="true">antigo</div>'
    const el = document.querySelector<HTMLElement>("[contenteditable]")!
    const execCommand = vi.spyOn(document, "execCommand").mockImplementation((_cmd, _ui, value) => {
      el.textContent = String(value)
      return true
    })

    expect(await setComposerText(el, "novo")).toBe(true)
    expect(execCommand).toHaveBeenCalledWith("insertText", false, "novo")
  })

  it("avisa quando o texto não ficou no campo (editor desfez a mudança)", async () => {
    document.body.innerHTML = '<div contenteditable="true">antigo</div>'
    const el = document.querySelector<HTMLElement>("[contenteditable]")!
    vi.spyOn(document, "execCommand").mockReturnValue(true) // "funcionou", mas nada mudou

    expect(await setComposerText(el, "novo")).toBe(false)
  })
})

describe("readComposerText", () => {
  it("lê quebras de linha do Lexical (<br> dentro do parágrafo)", () => {
    document.body.innerHTML =
      '<div data-lexical-editor="true"><p><span>a</span><br><br><span>b</span></p></div>'
    const editor = document.querySelector<HTMLElement>("[data-lexical-editor]")!
    expect(readComposerText(editor)).toBe("a\n\nb")
  })
})
