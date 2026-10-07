import { cleanText, readComposerText, setComposerText } from "./dom"
import type { ChatAdapter, ChatAuthor, ChatMessage } from "./types"

// Mapeamento do DOM do Botconversa (inbox), feito em 29/09/2026.
//
// O app usa CSS Modules: as classes vêm como `_chatInput_kvmgj_16`, onde o hash muda a cada deploy.
// Por isso casamos só o prefixo estável (`_chatInput_`) via `mod()`. Se o Botconversa mudar a UI,
// este é o único arquivo a ajustar — e tests/botconversa.test.ts tem a fixture de referência.
//
// Estrutura relevante:
//   _chatArea_ … _scrollableContent_          lista rolável
//     div (uma seção por dia)
//       _date_                                  "29 setembro", "Hoje"…
//       _root_ (flex column-reverse)            grupos em ordem INVERTIDA
//         _group_ (flex column-reverse)         mensagens em ordem INVERTIDA
//           _wrapper_ > [data-message-id]._fromMe_ | ._toMe_
//         _group_._systemGroup_ > … _chip_       eventos ("Bot parado por bot", "X atribuído por…")
//   [data-message-id][data-note-id]             nota interna (também tem _fromMe_!)
//   _chatInput_ … [data-lexical-editor]         campo de texto (editor Lexical)

/** Seletor para um elemento que tem uma classe de CSS Module com este nome. */
const mod = (name: string) => `:is([class^="_${name}_"], [class*=" _${name}_"])`

const hasMod = (el: Element, name: string) =>
  Array.from(el.classList).some((c) => c.startsWith(`_${name}_`))

const SELECTORS = {
  chatArea: mod("chatArea"),
  composer: `${mod("chatInput")} [data-lexical-editor="true"][contenteditable="true"]`,
  timelineItem: `[data-message-id], ${mod("systemGroup")} ${mod("chip")}, ${mod("date")}`,
  quoted: mod("quotedMessage"),
  meta: mod("default"),
  body: ".paragraph-small",
  small: ".paragraph-xsmall",
  fileName: ".label-small"
}

const TIME = /^\d{1,2}:\d{2}$/
const QUOTE_PREVIEW_LENGTH = 80

const isReversed = (el: Element) => {
  const style = getComputedStyle(el)
  return style.display.includes("flex") && style.flexDirection.endsWith("reverse")
}

/**
 * Elementos que casam com `selector` na ordem em que aparecem NA TELA. O Botconversa inverte a
 * ordem com `flex-direction: column-reverse`, então a ordem do DOM não é cronológica. Só olhamos o
 * estilo dos ancestrais dos itens, o que mantém isso barato.
 */
export const visualOrder = (root: Element, selector: string): Element[] => {
  const items = new Set(root.querySelectorAll(selector))
  const ancestors = new Set<Element>()
  for (const item of items) {
    for (let p = item.parentElement; p && p !== root && !ancestors.has(p); p = p.parentElement) {
      ancestors.add(p)
    }
  }

  const ordered: Element[] = []
  const visit = (el: Element) => {
    const children = Array.from(el.children).filter((c) => items.has(c) || ancestors.has(c))
    if (isReversed(el)) children.reverse()
    for (const child of children) {
      if (items.has(child)) ordered.push(child)
      else visit(child)
    }
  }
  visit(root)
  return ordered
}

const outsideQuote = (el: Element) => !el.closest(SELECTORS.quoted)

/** Texto do corpo sem o bloco de horário/status, convertendo negrito/itálico de volta p/ WhatsApp. */
const bodyText = (el: Element): string => {
  let out = ""
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent
      return
    }
    if (!(node instanceof Element) || node.matches(SELECTORS.meta) || node.tagName === "svg") return
    const inner = bodyText(node)
    switch (node.tagName) {
      case "BR":
        out += "\n"
        break
      case "STRONG":
      case "B":
        out += inner.trim() ? `*${inner}*` : inner
        break
      case "EM":
      case "I":
        out += inner.trim() ? `_${inner}_` : inner
        break
      case "S":
      case "DEL":
        out += inner.trim() ? `~${inner}~` : inner
        break
      default:
        out += inner
    }
  })
  return out
}

// O player de áudio mostra a velocidade ("1x", "1.5x") num .label-small e a duração ("00:04") num
// .paragraph-xsmall — nenhum dos dois é nome de arquivo nem horário da mensagem.
const PLAYBACK_SPEED = /^\d+(?:[.,]\d+)?\s*x$/i

const readFileLabel = (el: Element) =>
  Array.from(el.querySelectorAll(SELECTORS.fileName))
    .filter(outsideQuote)
    .map((l) => l.textContent?.trim() ?? "")
    .find(Boolean)

const isAudio = (el: Element) => {
  if (el.querySelector(`audio, ${mod("audioWaveform")}`)) return true
  const label = readFileLabel(el)
  return !!label && PLAYBACK_SPEED.test(label)
}

/**
 * Horário da mensagem. Em áudios o player também exibe a duração no mesmo formato: o horário real
 * é o último valor; se só houver um, é a duração, e é melhor ficar sem horário do que errado.
 */
const findTime = (el: Element) => {
  const times = Array.from(el.querySelectorAll(SELECTORS.small))
    .filter(outsideQuote)
    .map((t) => t.textContent?.trim() ?? "")
    .filter((t) => TIME.test(t))
  if (isAudio(el)) return times.length > 1 ? times[times.length - 1] : undefined
  return times[0]
}

/** Marcador de anexo: sem nome inventado, para a IA saber que ali houve um anexo. */
const mediaMarker = (el: Element) => {
  if (isAudio(el)) return "[áudio]"
  const file = readFileLabel(el)
  if (file) return `[arquivo: ${file}]`
  if (el.querySelector("video")) return "[vídeo]"
  if (el.querySelector("img")) return "[imagem]"
  return "[mídia]"
}

const readMessage = (el: Element): Omit<ChatMessage, "id"> | null => {
  const isNote = el.hasAttribute("data-note-id")
  const author: ChatAuthor = isNote ? "sistema" : hasMod(el, "fromMe") ? "vendedor" : "cliente"
  const template = !isNote && !!el.querySelector(mod("hasButtons"))

  const [body, ...rest] = Array.from(el.querySelectorAll(SELECTORS.body)).filter(outsideQuote)
  let text = body ? cleanText(bodyText(body)) : ""

  if (!text) text = mediaMarker(el)

  if (template && rest.length > 0) {
    const buttons = rest.map((b) => cleanText(b.textContent)).filter(Boolean)
    if (buttons.length) text += `\n[botões: ${buttons.join(" | ")}]`
  }

  const quoted = el.querySelector(SELECTORS.quoted)
  if (quoted) {
    const preview = cleanText(quoted.querySelector(SELECTORS.small)?.textContent).replace(/\s+/g, " ")
    if (preview) {
      const cut = preview.length > QUOTE_PREVIEW_LENGTH ? `${preview.slice(0, QUOTE_PREVIEW_LENGTH)}…` : preview
      text = `(em resposta a: "${cut}") ${text}`
    }
  }

  if (isNote) text = `Nota interna: ${text}`

  return { author, text, time: findTime(el), ...(template && { template }) }
}

const readSystemChip = (el: Element): Omit<ChatMessage, "id"> | null => {
  const parts = Array.from(el.querySelectorAll(SELECTORS.small)).map((p) => cleanText(p.textContent))
  const text = parts.filter((p) => !TIME.test(p)).join(" ").trim()
  return text ? { author: "sistema", text, time: parts.find((p) => TIME.test(p)) } : null
}

export const readBotconversaConversation = (root: ParentNode, limit: number): ChatMessage[] => {
  const area = root.querySelector(SELECTORS.chatArea)
  if (!area) return []

  const messages: Omit<ChatMessage, "id">[] = []
  let day: string | undefined
  for (const item of visualOrder(area, SELECTORS.timelineItem)) {
    if (hasMod(item, "date")) {
      day = cleanText(item.textContent) || undefined
      continue
    }
    const message = item.hasAttribute("data-message-id") ? readMessage(item) : readSystemChip(item)
    if (!message) continue
    const time = [day, message.time].filter(Boolean).join(" ") || undefined
    messages.push({ ...message, time })
  }

  return messages.slice(-limit).map((m, index) => ({ id: index + 1, ...m }))
}

export const botconversaAdapter: ChatAdapter = {
  id: "botconversa",
  hosts: ["app.botconversa.com.br"],

  getComposer: () => document.querySelector<HTMLElement>(SELECTORS.composer),

  // Caixa cinza arredondada: o primeiro `_root_` acima do editor (que fica num `_input_` dentro dela).
  getComposerFrame() {
    const editor = this.getComposer()
    return editor?.parentElement?.closest<HTMLElement>(mod("root")) ?? editor
  },

  // A barra (`_actions_`) tem dois grupos: ícones à esquerda (`_root_`: ⊕ ☺ IA 📄 ✎) e, à direita,
  // microfone/enviar. O botão de enviar não é um <button> e alguns ícones somem quando a janela de
  // 24h fecha, então não dá para ancorar pela direita — ancoramos logo depois do grupo da esquerda.
  getButtonAnchor: () =>
    document.querySelector<HTMLElement>(`${mod("chatInput")} ${mod("actions")} > ${mod("root")}`),

  readDraft() {
    const composer = this.getComposer()
    return composer ? readComposerText(composer) : ""
  },

  async writeDraft(text) {
    const composer = this.getComposer()
    return composer ? setComposerText(composer, text) : false
  },

  readConversation: (limit) => readBotconversaConversation(document, limit),

  getConversationKey: () => new URL(location.href).searchParams.get("chat_id") ?? location.pathname
}
