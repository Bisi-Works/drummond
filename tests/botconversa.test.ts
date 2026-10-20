// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  botconversaAdapter,
  readBotconversaAudioSource,
  readBotconversaContactName,
  readBotconversaConversation,
  visualOrder
} from "~adapters/botconversa"
import { resetBotIdCache, resetMediaCache } from "~adapters/botconversa-api"

// `URL` aqui é a implementação do happy-dom, que não aceita file:// — por isso fileURLToPath.
const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "botconversa-inbox.html")
const fixture = readFileSync(fixturePath, "utf8")

beforeEach(() => {
  document.open()
  document.write(fixture)
  document.close()
  resetBotIdCache()
  resetMediaCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
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

  it("mantém a messageKey estável mesmo quando a conversa é cortada", () => {
    const full = readBotconversaConversation(document, 50)
    const lastThree = readBotconversaConversation(document, 3)

    expect(lastThree.map((m) => [m.id, m.messageKey])).toEqual(
      full.slice(-3).map((m, index) => [index + 1, m.messageKey])
    )
    expect(lastThree.map((m) => m.messageKey)).toEqual(["wamid.M08", "wamid.M09", "wamid.M10"])
  })

  it("descreve mensagens só com imagem", () => {
    document.body.innerHTML = `
      <div class="_chatArea_x1"><div data-message-id="1" class="_root_m1 _fromMe_m1">
        <div class="_image_i1"><img alt="" /></div>
        <div class="_absolute_a1"><div class="paragraph-xsmall">14:17</div></div>
      </div></div>`
    expect(readBotconversaConversation(document, 50)).toEqual([
      { id: 1, author: "vendedor", text: "[imagem]", time: "14:17", messageKey: "1" }
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
      {
        id: 1,
        author: "vendedor",
        text: "[áudio]",
        time: undefined,
        messageKey: "1",
        audio: true
      },
      {
        id: 2,
        author: "cliente",
        text: "[áudio]",
        time: "14:20",
        messageKey: "2",
        audio: true
      }
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

describe("readBotconversaAudioSource", () => {
  it("lê o src direto do elemento audio", () => {
    document.body.innerHTML = `
      <div data-message-id="audio-1">
        <audio src="https://cdn.example/nota.ogg" type="audio/ogg"></audio>
      </div>`

    expect(readBotconversaAudioSource(document, "audio-1")).toEqual({
      url: "https://cdn.example/nota.ogg",
      mimeType: "audio/ogg"
    })
  })

  it("cai para o source interno e para o atributo data-audio-url", () => {
    document.body.innerHTML = `
      <div data-message-id="audio-2">
        <audio><source src="blob:https://app.botconversa.com.br/123" type="audio/ogg"></audio>
      </div>
      <div data-message-id="audio-3" data-audio-url="https://cdn.example/3.mp3"></div>`

    expect(readBotconversaAudioSource(document, "audio-2")).toEqual({
      url: "blob:https://app.botconversa.com.br/123",
      mimeType: "audio/ogg"
    })
    expect(readBotconversaAudioSource(document, "audio-3")).toEqual({
      url: "https://cdn.example/3.mp3"
    })
  })

  it("devolve null para mensagem ausente ou sem fonte de áudio", () => {
    document.body.innerHTML = '<div data-message-id="texto">Oi</div>'

    expect(readBotconversaAudioSource(document, "nao-existe")).toBeNull()
    expect(readBotconversaAudioSource(document, "texto")).toBeNull()
  })
})

describe("readAudio", () => {
  const messageWire = (id: string, url: string | null, mediaId = "") =>
    JSON.stringify({
      messages: [
        {
          message_id: id,
          message_content: mediaId,
          message_type: "audio",
          is_from_account: false,
          timestamp: 1791471958,
          note_id: null,
          media: [{ media_s3_url: url, media_id: mediaId, mime_type: "audio/ogg", file_size: 3, duration: 1 }]
        }
      ]
    })

  const stubApi = (id: string, url: string | null, mediaId = "") => {
    const calls: string[] = []
    const impl = vi.fn(async (target: RequestInfo | URL) => {
      const value = String(target)
      calls.push(value)
      if (value.includes("/companies/")) return new Response(JSON.stringify({ bot: 555 }), { status: 200 })
      if (value.includes("/jwt_api/messages/")) return new Response(messageWire(id, url, mediaId), { status: 200 })
      if (value.startsWith("https://bucket.example/")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/ogg" }
        })
      }
      return new Response("", { status: 404 })
    })
    vi.stubGlobal("fetch", impl)
    return { impl, calls }
  }

  beforeEach(() => {
    window.history.replaceState({}, "", "/110105/inbox?chat_id=38100790")
    localStorage.setItem("authToken", "jwt-token")
  })

  it("busca o áudio pela API quando o DOM não expõe a fonte (player próprio)", async () => {
    const { calls } = stubApi("wamid.M10", "https://bucket.example/a.ogg")

    const audio = await botconversaAdapter.readAudio!("wamid.M10")

    expect(audio?.mimeType).toBe("audio/ogg")
    expect(audio?.blob.size).toBe(3)
    expect(calls.at(-1)).toBe("https://bucket.example/a.ogg")
  })

  it("cai para a API quando o src do DOM não responde", async () => {
    document.body.innerHTML = `
      <div data-message-id="wamid.M10">
        <audio src="https://cdn.example/quebrado.ogg" type="audio/ogg"></audio>
      </div>`
    stubApi("wamid.M10", "https://bucket.example/a.ogg")

    const audio = await botconversaAdapter.readAudio!("wamid.M10")

    expect(audio?.blob.size).toBe(3)
  })

  it("baixa por get_media_url quando a API não traz URL (conta oficial)", async () => {
    const calls: string[] = []
    const impl = vi.fn(async (target: RequestInfo | URL) => {
      const value = String(target)
      calls.push(value)
      if (value.includes("/companies/")) return new Response(JSON.stringify({ bot: 555 }), { status: 200 })
      if (value.includes("/jwt_api/messages/")) {
        return new Response(messageWire("wamid.M10", "", "2242648623129802"), { status: 200 })
      }
      if (value.includes("/jwt_api/chat/get_media_url/")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/ogg" }
        })
      }
      return new Response("", { status: 404 })
    })
    vi.stubGlobal("fetch", impl)

    const audio = await botconversaAdapter.readAudio!("wamid.M10")

    expect(audio?.blob.size).toBe(3)
    expect(audio?.mimeType).toBe("audio/ogg")
    const mediaUrl = new URL(calls.find((value) => value.includes("get_media_url"))!)
    expect(mediaUrl.searchParams.get("media_id")).toBe("2242648623129802")
    expect(mediaUrl.searchParams.get("bot_id")).toBe("555")
  })

  it("devolve null quando a API não tem a mídia ou a URL não responde", async () => {
    stubApi("wamid.M10", null)
    expect(await botconversaAdapter.readAudio!("wamid.M10")).toBeNull()

    resetMediaCache()
    const failing = vi.fn(async (target: RequestInfo | URL) => {
      const value = String(target)
      if (value.includes("/companies/")) return new Response(JSON.stringify({ bot: 555 }), { status: 200 })
      if (value.includes("/jwt_api/messages/")) {
        return new Response(messageWire("wamid.M10", "https://bucket.example/erro.ogg"), { status: 200 })
      }
      return new Response("", { status: 404 })
    })
    vi.stubGlobal("fetch", failing)
    expect(await botconversaAdapter.readAudio!("wamid.M10")).toBeNull()
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
