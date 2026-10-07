// Utilitários para ler/escrever no campo de texto da página sem quebrar o estado do framework dela.

const isTextField = (el: Element): el is HTMLTextAreaElement | HTMLInputElement =>
  el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement

/** Texto de um nó com <br> virando "\n" (sem depender de layout, ao contrário do innerText). */
const textWithBreaks = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ""
  if (node.nodeName === "BR") return "\n"
  return Array.from(node.childNodes).map(textWithBreaks).join("")
}

export const readComposerText = (el: HTMLElement) => {
  if (isTextField(el)) return el.value
  // Lexical: um bloco (<p>) por parágrafo e <br> para quebras dentro dele. Lemos bloco a bloco
  // (o innerText do editor inteiro poria linhas em branco extras entre blocos) e descartamos o
  // <br> final que o Lexical adiciona em parágrafos vazios ou terminados em quebra.
  if (el.dataset.lexicalEditor === "true") {
    return Array.from(el.children)
      .map((block) => textWithBreaks(block).replace(/\n$/, ""))
      .join("\n")
  }
  return el.innerText ?? ""
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim()

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0))

// Seleciona todo o conteúdo e espera o editor da página sincronizar a seleção: editores como o
// Lexical escutam `selectionchange`, que o navegador dispara de forma assíncrona.
const selectAllContents = async (el: HTMLElement) => {
  const synced = new Promise((resolve) => {
    document.addEventListener("selectionchange", resolve, { once: true })
    setTimeout(resolve, 100)
  })
  const range = document.createRange()
  range.selectNodeContents(el)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  await synced
  await nextTask()
}

/** Simula um "colar"; retorna true se algum editor da página tratou o evento. */
const dispatchPaste = (el: HTMLElement, text: string) => {
  const data = new DataTransfer()
  data.setData("text/plain", text)
  const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  return event.defaultPrevented
}

/**
 * Substitui o conteúdo do campo como se o usuário tivesse digitado/colado. Retorna se o texto
 * realmente ficou no campo — editores ricos descartam mudanças que não reconhecem.
 *
 * - textarea/input: o content script roda num "isolated world", então `el.value = ...` chama o
 *   setter nativo sem passar pelo tracker que o React instala no elemento; o evento `input` faz o
 *   React/Vue perceberem a diferença e atualizarem o próprio estado.
 * - contenteditable: simulamos um "colar". Editores ricos (Lexical no Botconversa, Draft, Slate)
 *   tratam o paste pelo próprio pipeline, então o estado deles e o do app ficam corretos — e as
 *   quebras de linha viram quebras de verdade. NÃO usamos `execCommand("insertText")` nesses
 *   editores: o Chrome não dispara `beforeinput` para execCommand, o Lexical nunca fica sabendo e
 *   desfaz a mudança no DOM (foi o bug do "Aplicar" que não alterava o texto). Ele fica só como
 *   plano B para contenteditables simples, que não tratam paste.
 */
export const setComposerText = async (el: HTMLElement, text: string): Promise<boolean> => {
  el.focus()

  if (isTextField(el)) {
    el.value = text
    el.dispatchEvent(new Event("input", { bubbles: true }))
    el.dispatchEvent(new Event("change", { bubbles: true }))
    return sameText(el.value, text)
  }

  await selectAllContents(el)
  if (!dispatchPaste(el, text)) document.execCommand("insertText", false, text)
  await nextTask()
  return sameText(readComposerText(el), text)
}

/** Texto visível de um nó, normalizando espaços mas preservando quebras de linha. */
export const cleanText = (text: string | null | undefined) =>
  (text ?? "")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
