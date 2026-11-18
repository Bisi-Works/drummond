import { cleanText, readComposerText, setComposerText } from "./dom"
import type { ChatAdapter, ChatAuthor, ChatMessage } from "./types"

// Mapeamento do DOM do WhatsApp Web, feito em 18/11/2026.
//
// As classes são geradas (`x1n2onr6`…), então só usamos `data-testid`, `data-*` e `aria-label`.
// O `data-id` das mensagens hoje é só o id da mensagem (sem o antigo `true_/false_<jid>_`), e as
// classes `message-in/out` sumiram: quem enviou vem do rótulo de leitor de tela da bolha.
//
//   #main                                          conversa aberta
//     header [data-testid=conversation-info-header-chat-title]   nome do contato
//     [data-testid=conversation-panel-messages]   lista, em ordem cronológica no DOM
//       [role=row] > [data-id]                     uma mensagem
//         [data-testid=msg-container]
//           span[aria-label]                       1º rótulo: "Você:" ou "<contato>:"
//           [data-pre-plain-text]                  "[10:32, 18/11/2026] Nome: " (só com texto)
//             [data-testid=quoted-message]         citação, com o próprio selectable-text
//             span[data-testid=selectable-text]    corpo (emojis são <img alt>)
//           [data-testid=msg-meta]                 "10:32" (+ status nas enviadas)
//     footer [contenteditable][data-lexical-editor]   campo de texto (Lexical)

const SELECTORS = {
  composer: '#main footer [contenteditable="true"][data-lexical-editor="true"]',
  message: "#main [data-id]",
  body: '[data-pre-plain-text] span[data-testid="selectable-text"]',
  contactName: '#main header [data-testid="conversation-info-header-chat-title"]',
  quoted: '[data-testid="quoted-message"]'
}

const QUOTE_PREVIEW_LENGTH = 80

/** Largura do botão "Revisar" mais folga ("Copiado ✓" é o rótulo mais largo). */
const BUTTON_ROOM = 112

const OWN_LABEL =/^(Você|You)\s*:/
const VOICE = '[aria-label*="mensagem de voz" i], [aria-label*="voice message" i]'
const PRE_PLAIN = /^\[(\d{1,2}:\d{2}), ([\d/.-]+)\]/
const TIME = /\d{1,2}:\d{2}/

/** Texto do corpo com emojis (<img alt>) e negrito/itálico/tachado de volta no formato do WhatsApp. */
const bodyText = (el: Element): string =>
  Array.from(el.childNodes)
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ""
      if (!(node instanceof Element)) return ""
      if (node.tagName === "BR") return "\n"
      if (node.tagName === "IMG") return node.getAttribute("alt") ?? ""
      const inner = bodyText(node)
      if (!inner.trim()) return inner
      if (node.tagName === "STRONG") return `*${inner}*`
      if (node.tagName === "EM") return `_${inner}_`
      if (node.tagName === "DEL") return `~${inner}~`
      return inner
    })
    .join("")

const mediaMarker = (el: Element) => {
  if (el.querySelector(VOICE)) return "[áudio]"
  if (el.querySelector('[data-testid="document-thumb"]')) return "[documento]"
  if (el.querySelector("video")) return "[vídeo]"
  if (el.querySelector('[data-testid="image-thumb"], img')) return "[imagem]"
  return "[mídia]"
}

/** "18/11/2026 10:32" do `data-pre-plain-text`; mídia sem texto só tem a hora no rodapé da bolha. */
const readTime = (el: Element) => {
  const pre = el.querySelector("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text")
  const match = pre?.match(PRE_PLAIN)
  if (match) return `${match[2]} ${match[1]}`
  return el.querySelector('[data-testid="msg-meta"]')?.textContent?.match(TIME)?.[0]
}

const readMessage = (el: Element): Omit<ChatMessage, "id"> => {
  const label = el.querySelector('[data-testid="msg-container"] [aria-label]')?.getAttribute("aria-label")
  const author: ChatAuthor = label && OWN_LABEL.test(label) ? "vendedor" : "cliente"
  // A citação fica dentro do bloco de texto e tem o próprio `selectable-text`, que vem primeiro.
  const body = Array.from(el.querySelectorAll(SELECTORS.body)).find((s) => !s.closest(SELECTORS.quoted))
  const audio = !!el.querySelector(VOICE)
  const messageKey = el.getAttribute("data-id") ?? undefined
  let text = (body && cleanText(bodyText(body))) || mediaMarker(el)
  const quotedBody = el.querySelector(`${SELECTORS.quoted} span[data-testid="selectable-text"]`)
  const quote = quotedBody ? cleanText(bodyText(quotedBody)).replace(/\s+/g, " ") : ""
  if (quote) {
    const cut = quote.length > QUOTE_PREVIEW_LENGTH ? `${quote.slice(0, QUOTE_PREVIEW_LENGTH)}…` : quote
    text = `(em resposta a: "${cut}") ${text}`
  }
  return {
    author,
    text,
    time: readTime(el),
    ...(messageKey && { messageKey }),
    ...(audio && { audio: true })
  }
}

export const readWhatsappConversation = (root: ParentNode, limit: number): ChatMessage[] =>
  Array.from(root.querySelectorAll(SELECTORS.message))
    .filter((el) => el.querySelector('[data-testid="msg-container"]'))
    .slice(-limit)
    .map((el, index) => ({ id: index + 1, ...readMessage(el) }))

export const readWhatsappContactName = (root: ParentNode): string | null =>
  cleanText(root.querySelector(SELECTORS.contactName)?.textContent) || null

export const whatsappAdapter: ChatAdapter = {
  id: "whatsapp",
  hosts: ["web.whatsapp.com"],
  features: { pitaco: false, dayTracking: false, coaching: false },

  getComposer: () => document.querySelector<HTMLElement>(SELECTORS.composer),

  // O `footer` é a barra inteira do campo (anexo, emoji, texto, microfone).
  getComposerFrame() {
    return this.getComposer()?.closest<HTMLElement>("footer") ?? null
  },

  // Último botão do rodapé: o microfone, que vira o "Enviar" quando há texto (mesma posição).
  getButtonAnchor: () => Array.from(document.querySelectorAll<HTMLElement>("#main footer button")).at(-1) ?? null,
  buttonSide: "before",

  // O campo vai até o microfone: a margem abre o espaço onde o botão "Revisar" fica.
  install() {
    const style = document.createElement("style")
    style.textContent = `${SELECTORS.composer}{margin-right:${BUTTON_ROOM}px}`
    document.head.append(style)
  },

  readDraft() {
    const composer = this.getComposer()
    return composer ? readComposerText(composer) : ""
  },

  async writeDraft(text) {
    const composer = this.getComposer()
    return composer ? setComposerText(composer, text) : false
  },

  readConversation: (limit) => readWhatsappConversation(document, limit),

  // shortcut: a URL não muda e o DOM não expõe o id do chat, então o nome do contato é a chave;
  // dois contatos com o mesmo nome colidem. Trocar se o tracking/Pitaco vierem para o WhatsApp.
  getConversationKey: () => readWhatsappContactName(document),

  getContactName: () => readWhatsappContactName(document)
}
