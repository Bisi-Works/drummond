// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest"

import { getAdapter } from "~adapters"
import { readWhatsappContactName, readWhatsappConversation, whatsappAdapter } from "~adapters/whatsapp"

// Estrutura do WhatsApp Web mapeada em 18/11/2026 (classes geradas omitidas; só o que o adapter usa).
const message = (id: string, label: string, inner: string) => `
  <div role="row"><div data-id="${id}"><div><div class="focusable-list-item">
    <div data-testid="msg-container"><div>
      <span aria-label="${label}"></span>
      ${inner}
    </div></div>
  </div></div></div></div>`

const fixture = `
  <div id="main">
    <header><span data-testid="conversation-info-header-chat-title">Maria Souza</span></header>
    <div data-testid="conversation-panel-messages">
      <div role="row"><div data-id="SYSTEM1"><span>Hoje</span></div></div>
      ${message(
        "AC01",
        "Maria Souza:",
        `<div data-pre-plain-text="[09:15, 18/11/2026] Maria Souza: "><span data-testid="selectable-text"><span>Oi, quero saber o preço <strong>hoje</strong> <img alt="🙂" data-testid="selectable-text"></span></span></div>
         <div data-testid="msg-meta"><span>09:15</span></div>`
      )}
      ${message(
        "3EB0",
        "Você:",
        `<div data-pre-plain-text="[09:20, 18/11/2026] Vendedor: "><span data-testid="selectable-text"><span>Claro!<br>Já te mando</span></span></div>
         <div data-testid="msg-meta"><span>09:20</span><span aria-label=" Lida "></span></div>`
      )}
      ${message(
        "AC02",
        "Maria Souza:",
        `<button aria-label="Reproduzir mensagem de voz"></button><span aria-label="Mensagem de voz"></span>
         <div data-testid="msg-meta"><span>09:31</span></div>`
      )}
    </div>
    <footer><button aria-label="Anexar"></button><div contenteditable="true" role="textbox" data-lexical-editor="true"><p>rascunho</p></div><button aria-label="Mensagem de voz"></button></footer>
  </div>`

beforeEach(() => {
  document.body.innerHTML = fixture
})

describe("whatsappAdapter", () => {
  it("lê autor, texto, horário e áudio, ignorando linhas que não são mensagem", () => {
    expect(readWhatsappConversation(document, 50)).toEqual([
      {
        id: 1,
        author: "cliente",
        text: "Oi, quero saber o preço *hoje* 🙂",
        time: "18/11/2026 09:15",
        messageKey: "AC01"
      },
      { id: 2, author: "vendedor", text: "Claro!\nJá te mando", time: "18/11/2026 09:20", messageKey: "3EB0" },
      { id: 3, author: "cliente", text: "[áudio]", time: "09:31", messageKey: "AC02", audio: true }
    ])
  })


  it("separa a citação do corpo da resposta", () => {
    document.querySelector('[data-testid="conversation-panel-messages"]')!.insertAdjacentHTML(
      "beforeend",
      message(
        "3EB1",
        "Você:",
        `<div data-pre-plain-text="[09:40, 18/11/2026] Vendedor: ">
           <div role="button" data-testid="quoted-message"><span data-testid="author">Maria Souza</span><span data-testid="selectable-text"><span>Oi, quero saber o preço</span></span></div>
           <span data-testid="selectable-text"><span>Custa R$ 100</span></span>
         </div>`
      )
    )
    const last = readWhatsappConversation(document, 50).at(-1)
    expect(last).toMatchObject({ author: "vendedor", text: '(em resposta a: "Oi, quero saber o preço") Custa R$ 100' })
  })

  it("respeita o limite, renumerando a partir de 1", () => {
    expect(readWhatsappConversation(document, 1).map((m) => [m.id, m.messageKey])).toEqual([[1, "AC02"]])
  })

  it("lê o rascunho e usa o contato como chave da conversa", () => {
    expect(whatsappAdapter.readDraft()).toBe("rascunho")
    expect(whatsappAdapter.getComposerFrame?.()?.tagName).toBe("FOOTER")
    expect(whatsappAdapter.getButtonAnchor?.()?.getAttribute("aria-label")).toBe("Mensagem de voz")
    expect(readWhatsappContactName(document)).toBe("Maria Souza")
    expect(whatsappAdapter.getConversationKey()).toBe("Maria Souza")
  })

  it("só tem o Revisar", () => {
    expect(getAdapter("web.whatsapp.com")?.features).toEqual({
      pitaco: false,
      dayTracking: false,
      coaching: false
    })
  })
})
