// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { beforeEach, describe, expect, it } from "vitest"

import {
  botconversaAdapter,
  readBotconversaContactName,
  readBotconversaConversation,
  visualOrder
} from "~adapters/botconversa"

// `URL` aqui é a implementação do happy-dom, que não aceita file:// — por isso fileURLToPath.
const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "botconversa-inbox.html")
const fixture = readFileSync(fixturePath, "utf8")

beforeEach(() => {
  document.open()
  document.write(fixture)
  document.close()
})

describe("readBotconversaConversation", () => {
  it("lê a conversa em ordem cronológica, apesar do column-reverse do DOM", () => {
    const conversation = readBotconversaConversation(document, 50)

    expect(conversation.map((m) => [m.id, m.author, m.time])).toEqual([
      [1, "vendedor", "28 setembro 21:03"],
      [2, "cliente", "Hoje 14:11"],
      [3, "sistema", "Hoje 14:14"],
      [4, "vendedor", "Hoje 14:17"],
      [5, "vendedor", "Hoje 14:17"],
      [6, "sistema", "Hoje 14:17"],
      [7, "sistema", "Hoje 14:17"],
      [8, "vendedor", "Hoje 17:28"],
      [9, "cliente", "Hoje 19:16"],
      [10, "vendedor", "Hoje 20:35"]
    ])
  })

  it("extrai o texto de cada tipo de mensagem", () => {
    const texts = readBotconversaConversation(document, 50).map((m) => m.text)

    expect(texts).toEqual([
      "Olá, João!\n\nTemos condições especiais no *plano anual* este mês.\n[botões: Quero saber mais | Agora não]",
      '(em resposta a: "Olá, João! Temos condições especiais no plano anual este mês.") Quero saber mais',
      "Nota interna: Cliente prefere contato à tarde",
      "Olá, João! Tudo bem?\n\nSou a Ana, especialista da loja.",
      "Já tenho em mãos as informações do que você procura.\n\n*Posso te apresentar?*",
      "Ana Souza atribuído por bot",
      "Bot parado por bot",
      "[arquivo: orcamento-123.pdf]",
      "Tem um valor mais baixo?",
      "Do crédito ou da parcela?"
    ])
  })

  it("marca templates e não confunde nota interna com mensagem do vendedor", () => {
    const [template, , note] = readBotconversaConversation(document, 50)
    expect(template.template).toBe(true)
    expect(note.author).toBe("sistema")
    expect(note.template).toBeUndefined()
  })

  it("devolve só as últimas N mensagens, renumeradas a partir de 1", () => {
    const conversation = readBotconversaConversation(document, 3)
    expect(conversation.map((m) => [m.id, m.text])).toEqual([
      [1, "[arquivo: orcamento-123.pdf]"],
      [2, "Tem um valor mais baixo?"],
      [3, "Do crédito ou da parcela?"]
    ])
  })

  it("descreve mensagens só com imagem", () => {
    document.body.innerHTML = `
      <div class="_chatArea_x1"><div data-message-id="1" class="_root_m1 _fromMe_m1">
        <div class="_image_i1"><img alt="" /></div>
        <div class="_absolute_a1"><div class="paragraph-xsmall">14:17</div></div>
      </div></div>`
    expect(readBotconversaConversation(document, 50)).toEqual([
      { id: 1, author: "vendedor", text: "[imagem]", time: "14:17" }
    ])
  })

  it("trata áudio como áudio: velocidade não é nome de arquivo e duração não é horário", () => {
    document.body.innerHTML = `
      <div class="_chatArea_x1">
        <div data-message-id="1" class="_root_m1 _fromMe_m1">
          <div class="_player_p1">
            <div class="label-small">1x</div>
            <div class="paragraph-xsmall">00:04</div>
          </div>
        </div>
        <div data-message-id="2" class="_root_m1 _toMe_m1">
          <div class="_player_p1">
            <div class="label-small">1.5x</div>
            <div class="paragraph-xsmall">00:09</div>
            <div class="paragraph-xsmall">14:20</div>
          </div>
        </div>
      </div>`
    expect(readBotconversaConversation(document, 50)).toEqual([
      { id: 1, author: "vendedor", text: "[áudio]", time: undefined },
      { id: 2, author: "cliente", text: "[áudio]", time: "14:20" }
    ])
  })

  it("lê o áudio real do Botconversa (waveform, duração, velocidade e horário separado)", () => {
    const player = (time: string, duration: string) => `
      <div class="_root_1tyrs_1">
        <div class="_content_1tyrs_16">
          <div class="_audioWaveform_1tyrs_10"><canvas></canvas></div>
          <div class="paragraph-xsmall semantic-text-secondary">${duration}</div>
        </div>
        <div class="_actions_1tyrs_24">
          <div class="_actionsGroup_1tyrs_24"><div class="_customButton_1tyrs_30"><div class="label-small">1x</div></div></div>
          <div class="_root_1uire_1 _absolute_1uire_9"><div class="paragraph-xsmall">${time}</div></div>
        </div>
      </div>`
    document.body.innerHTML = `
      <div class="_chatArea_x1">
        <div data-message-id="a" class="_root_xrlpv_1 _fromMe_xrlpv_15">${player("16:08", "00:04")}</div>
        <div data-message-id="b" class="_root_xrlpv_1 _toMe_xrlpv_24">${player("15:41", "00:09")}</div>
      </div>`
    expect(readBotconversaConversation(document, 50).map((m) => [m.author, m.text, m.time])).toEqual([
      ["vendedor", "[áudio]", "16:08"],
      ["cliente", "[áudio]", "15:41"]
    ])
  })

  it("retorna vazio fora da tela de chat", () => {
    document.body.innerHTML = "<main>Painel de controle</main>"
    expect(readBotconversaConversation(document, 50)).toEqual([])
  })
})

describe("readBotconversaContactName", () => {
  it("lê o nome do contato no cabeçalho, sem as iniciais do avatar nem espaços sobrando", () => {
    expect(readBotconversaContactName(document)).toBe("João da Silva")
    expect(botconversaAdapter.getContactName?.()).toBe("João da Silva")
  })

  it("não confunde o texto de uma mensagem com o nome do contato", () => {
    document.querySelector('[class*="_details_"]')?.remove()
    expect(readBotconversaContactName(document)).toBeNull()
  })

  it("devolve null sem cabeçalho ou com o nome vazio", () => {
    const content = document.querySelector('[class*="_details_"] [class*="_content_"] .paragraph-small')
    content!.textContent = "   "
    expect(readBotconversaContactName(document)).toBeNull()

    document.body.innerHTML = ""
    expect(readBotconversaContactName(document)).toBeNull()
  })

  it("descarta texto longo demais para ser um nome", () => {
    const content = document.querySelector('[class*="_details_"] [class*="_content_"] .paragraph-small')
    content!.textContent = "x".repeat(200)
    expect(readBotconversaContactName(document)).toBeNull()
  })

  it("não afeta a leitura das mensagens", () => {
    expect(readBotconversaConversation(document, 50)).toHaveLength(10)
  })
})

describe("visualOrder", () => {
  it("respeita column-reverse aninhado", () => {
    document.body.innerHTML = `
      <style>.rev { display: flex; flex-direction: column-reverse }</style>
      <div id="root"><div class="rev"><i>3</i><div class="rev"><i>2</i><i>1</i></div></div><i>4</i></div>`
    const root = document.getElementById("root")!
    expect(visualOrder(root, "i").map((el) => el.textContent)).toEqual(["1", "2", "3", "4"])
  })
})

describe("composer", () => {
  it("encontra o editor Lexical e lê o rascunho linha a linha", () => {
    expect(botconversaAdapter.getComposer()?.dataset.lexicalEditor).toBe("true")
    expect(botconversaAdapter.readDraft()).toBe("Primeira linha\n\nterceira linha")
  })

  it("usa a caixa em volta do editor como moldura", () => {
    expect(botconversaAdapter.getComposerFrame?.()?.className).toBe("_root_znhw1_1")
  })

  it("ancora o botão no grupo de ícones da esquerda, não no último botão da barra", () => {
    const anchor = botconversaAdapter.getButtonAnchor?.()
    expect(anchor?.className).toBe("_root_tlb01_1")
    expect(anchor?.querySelectorAll("button")).toHaveLength(4)
  })
})
