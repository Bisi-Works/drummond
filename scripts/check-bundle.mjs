// Verifica a build de produção DE VERDADE (executando os bundles), não só se ela compila:
//   1. a chave do OpenRouter só aparece no service worker;
//   2. o service worker carrega, responde a "review-draft" e faz o coaching em streaming pela
//      conexão "coach-conversation" (fetch simulado);
//   3. o content script carrega numa página simulada e responde a "get-conversation".
// Uso: pnpm build && pnpm check:bundle [pasta-da-build]   (padrão: build/chrome-mv3-prod)
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import vm from "node:vm"

import { Window } from "happy-dom"

const buildDir = process.argv[2] ?? "build/chrome-mv3-prod"
const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "OK  " : "FALHA"} ${message}`)
  if (!ok) failures.push(message)
}

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
const manifest = JSON.parse(readFileSync(join(buildDir, "manifest.json"), "utf8"))
const read = (file) => readFileSync(join(buildDir, file), "utf8")

// 1. Chave -------------------------------------------------------------------------------------
const key = readFileSync(".env", "utf8").match(/^PLASMO_PUBLIC_OPENROUTER_API_KEY=(.+)$/m)?.[1]?.trim()
if (!key) {
  check(false, "PLASMO_PUBLIC_OPENROUTER_API_KEY encontrada no .env")
} else {
  const withKey = walk(buildDir).filter((file) => readFileSync(file, "utf8").includes(key))
  const leaks = withKey.filter((f) => !relative(buildDir, f).startsWith(`static${sep}background`))
  check(withKey.length > 0 && leaks.length === 0, `chave só no background (${withKey.map((f) => relative(buildDir, f)).join(", ") || "nenhum arquivo"})`)
}

// Stub mínimo da API chrome.* que captura o listener de mensagens registrado pelo bundle.
// Qualquer API não listada vira no-op: aceita cadeias de propriedades (chrome.x.onY.addListener)
// e chamadas (que resolvem vazio). Cobre o runtime de hot reload das builds de dev sem listar tudo.
const permissive = () =>
  new Proxy(function () {}, {
    get: (_target, prop) => (prop === "then" ? undefined : permissive()),
    apply: () => Promise.resolve(undefined)
  })
const withFallback = (explicit) =>
  new Proxy(explicit, { get: (target, prop) => (prop in target ? target[prop] : permissive()) })

const chromeStub = () => {
  const listeners = []
  const connectListeners = []
  const noop = () => {}
  return {
    listeners,
    connectListeners,
    chrome: withFallback({
      runtime: withFallback({
        id: "smoke-test",
        onMessage: { addListener: (fn) => listeners.push(fn), removeListener: noop },
        onConnect: { addListener: (fn) => connectListeners.push(fn), removeListener: noop },
        getURL: (p) => `chrome-extension://smoke-test/${p}`,
        getManifest: () => manifest,
        sendMessage: async () => undefined
      }),
      sidePanel: withFallback({ setPanelBehavior: async () => undefined }),
      tabs: withFallback({ query: async () => [], sendMessage: async () => undefined })
    })
  }
}

// Entrega uma mensagem ao(s) listener(s) como o Chrome faria e espera o sendResponse.
const deliver = (listeners, message) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sem resposta para "${message.name}"`)), 5000)
    for (const listener of listeners) {
      listener(message, {}, (response) => {
        clearTimeout(timer)
        resolve(response)
      })
    }
  })

// 2. Service worker ----------------------------------------------------------------------------
const fakeModel = {
  review: { status: "ajustes", suggestedText: "Olá, tudo bem?", changes: [{ category: "ortografia", excerpt: "Olá", reason: "Acento." }], warnings: [] },
  coach: {
    summary: "Boa condução.", strengths: ["Cordial."], improvements: [],
    bant: {
      budget: { status: "pendente", evidence: "Não abordado.", question: "Qual o investimento previsto?" },
      authority: { status: "cumprido", evidence: "Cliente é o dono (#1).", question: "" },
      need: { status: "parcial", evidence: "Citou o problema sem detalhes.", question: "O que mais atrapalha hoje?" },
      timing: { status: "pendente", evidence: "Não abordado.", question: "Para quando precisa?" }
    },
    nextStep: "Enviar proposta."
  },
  // Relatório diário da rota "generate-report" (e do botão "Encerrar o dia" no widget).
  daily: {
    resumo: "Dia produtivo, com uma pendência.",
    acertos: ["Respondeu rápido a Loja X."],
    erros: [],
    melhorias: ["Retomar a conversa parada na segunda-feira."],
    pendencias: ["Falar com a Loja X."]
  }
}
// Payload do dia usado na rota `generate-report` e no `input` guardado com o relatório, para a
// página do relatório remontar as métricas sem nova chamada de IA.
const dailyInput = {
  date: "2026-10-07",
  totals: {
    conversations: 1, waiting: 1, answered: 0, withoutMessage: 0, reviews: 0, coachings: 0,
    alerts: 1, waitingByLevel: { verde: 0, amarelo: 0, laranja: 1, vermelho: 0 },
    averageFirstResponseMs: null, averageResponseMs: null
  },
  conversations: [{
    key: "1", label: "Loja X", platform: "botconversa", lastMessageAuthor: "cliente",
    lastMessage: "Oi", messageCount: 2,
    status: { state: "aguardando", elapsedMs: 90_000, level: "laranja" }
  }]
}
const requests = []
const priceLookups = []
const fetchStub = async (url, init) => {
  // Preços do modelo (API pública), usados só na estimativa de custo do dev.
  if (url.endsWith("/endpoints")) {
    priceLookups.push(url)
    const pricing = { prompt: "0.0000003", completion: "0.0000012" }
    const endpoint = { provider_name: "Fake", supported_parameters: ["response_format", "structured_outputs", "temperature", "reasoning"], pricing }
    return new Response(JSON.stringify({ data: { endpoints: [endpoint] } }))
  }
  const body = JSON.parse(init.body)
  requests.push(body)
  const system = body.messages[0].content
  const isReview = system.includes("Tarefa: revisar o rascunho")
  const isDaily = system.includes("Tarefa: relatório diário de coaching")
  const content = JSON.stringify(isReview ? fakeModel.review : isDaily ? fakeModel.daily : fakeModel.coach)
  const usage = { prompt_tokens: 1000, completion_tokens: 200, cost: 0.00054 }
  if (!body.stream) {
    return new Response(JSON.stringify({ provider: "Fake", usage, choices: [{ message: { content } }] }))
  }
  // Streaming: o JSON em trechos de 40 caracteres, e o `usage` no último evento, como no OpenRouter.
  const event = (data) => `data: ${JSON.stringify({ provider: "Fake", ...data })}\n\n`
  const pieces = content.match(/[\s\S]{1,40}/g).map((piece) => event({ choices: [{ delta: { content: piece } }] }))
  const sse = [": OPENROUTER PROCESSING\n\n", ...pieces, event({ usage, choices: [{ delta: { content: "" } }] }), "data: [DONE]\n\n"]
  return new Response(sse.join(""), { headers: { "Content-Type": "text/event-stream" } })
}

// Abre uma conexão (port) com o background como o side panel faria, envia `request` e junta as
// mensagens recebidas até o resultado final.
const connect = (connectListeners, name, request) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sem resultado na conexão "${name}"`)), 5000)
    const received = []
    const onMessage = []
    const port = {
      name,
      onMessage: { addListener: (fn) => onMessage.push(fn), removeListener: () => {} },
      onDisconnect: { addListener: () => {}, removeListener: () => {} },
      disconnect: () => {},
      postMessage: (message) => {
        received.push(message)
        if (message.type === "result") {
          clearTimeout(timer)
          resolve(received)
        }
      }
    }
    for (const listener of connectListeners) listener(port)
    for (const listener of onMessage) listener(request, port)
  })
const isDevBuild = buildDir.includes("-dev")

try {
  const { chrome, listeners, connectListeners } = chromeStub()
  // WebSocket falso: o hot reload das builds de dev tenta conectar no servidor do `plasmo dev`.
  class FakeWebSocket { addEventListener() {} close() {} send() {} }
  const context = vm.createContext({
    chrome, fetch: fetchStub, console, setTimeout, clearTimeout, setInterval, clearInterval,
    AbortController, DOMException, Response, TextDecoder, WebSocket: FakeWebSocket,
    addEventListener: () => {}, // eventos do service worker (fetch, install…)
    location: new URL("chrome-extension://smoke-test/background.js")
  })
  context.self = context
  vm.runInContext(read(manifest.background.service_worker), context, { filename: "background" })
  check(listeners.length > 0, "service worker carrega e registra o listener de mensagens")

  const conversation = [{ id: 1, author: "cliente", text: "Oi" }, { id: 2, author: "vendedor", text: "Ola" }]
  const review = await deliver(listeners, { name: "review-draft", body: { conversation, draft: "Ola, tudo bem?" } })
  check(review?.ok === true && review.data.suggestedText === "Olá, tudo bem?", `review-draft responde (${review?.ok ? "ok" : review?.error})`)
  // Descreve os parâmetros da requisição: modelo, formato, temperatura e raciocínio.
  const describeRequest = (body) =>
    `modelo ${body?.model}, provedores ${body?.provider?.order?.join(" → ") ?? "a critério do OpenRouter"}, ${body?.response_format?.type}, temperatura ${body?.temperature ?? "não enviada"}, raciocínio ${JSON.stringify(body?.reasoning ?? "não enviado")}`
  // Formato da resposta: JSON Schema completo, ou json_object (formato só no prompt, validado pelo zod).
  const validFormat = (body, properties) =>
    body?.response_format?.type === "json_object" ||
    Object.keys(body?.response_format?.json_schema?.schema?.properties ?? {}).join() === properties
  const reviewRequest = requests[0]
  check(validFormat(reviewRequest, "status,warnings,suggestedText,changes"), `formato de resposta do review vai completo (${reviewRequest?.response_format?.type})`)
  check(reviewRequest?.provider?.require_parameters === true && !reviewRequest?.stream, `review: requisição exige provedor compatível, sem streaming (${describeRequest(reviewRequest)})`)

  // Rota do relatório diário, pelo mesmo caminho que o widget do content script usa
  // (`sendToBackground("generate-report")`): o handler é descoberto pelo nome do arquivo em
  // `src/background/messages/`, sem registro manual no `background/index.ts`.
  const daily = await deliver(listeners, { name: "generate-report", body: { report: dailyInput } })
  check(daily?.ok === true && daily.data.resumo === fakeModel.daily.resumo, `generate-report responde (${daily?.ok ? "ok" : daily?.error})`)
  const dailyRequest = requests.at(-1)
  check(validFormat(dailyRequest, "resumo,acertos,erros,melhorias,pendencias"), `formato de resposta do relatório diário (${dailyRequest?.response_format?.type})`)
  // Custo do relatório: só o dev calcula a estimativa e recebe o `usage.cost`. A build de produção
  // não pode embutir esse caminho — a checagem falha se `meta.cost` aparecer na resposta.
  if (isDevBuild) {
    const reportCost = daily?.meta?.cost
    check(!!reportCost?.estimate && reportCost?.effective?.usd === 0.00054, `dev: custo estimado e efetivo do relatório diário (${JSON.stringify(reportCost?.effective ?? null)})`)
  } else {
    check(daily?.meta?.cost === undefined, "produção: relatório diário sem custo na resposta")
  }

  check(connectListeners.length > 0, "service worker registra o listener de conexões (coaching)")
  const messages = await connect(connectListeners, "coach-conversation", { conversation })
  const deltas = messages.filter((m) => m.type === "delta")
  const coach = messages.at(-1)?.response
  const coachRequest = requests.at(-1)
  check(coachRequest?.stream === true && deltas.length > 1, `coaching chega em streaming (${deltas.length} trechos; ${describeRequest(coachRequest)})`)
  check(deltas.map((m) => m.text).join("") === JSON.stringify(fakeModel.coach), "os trechos formam o JSON completo, na ordem")
  check(coach?.ok === true && coach.data.nextStep === "Enviar proposta.", `coaching devolve o resultado final (${coach?.ok ? "ok" : coach?.error})`)
  check(validFormat(coachRequest, "summary,strengths,improvements,bant,nextStep"), `formato de resposta do coaching inclui o checklist BANT (${coachRequest?.response_format?.type})`)
  check(coach?.data?.bant?.need?.status === "parcial", "coaching devolve o checklist BANT")
  if (isDevBuild) {
    const cost = coach?.meta?.cost
    check(!!cost?.estimate && cost?.effective?.usd === 0.00054, `dev: custo estimado e efetivo na resposta (${JSON.stringify(cost?.effective ?? null)})`)
  } else {
    check(coach?.meta?.cost === undefined && priceLookups.length === 0, "produção: sem custo na resposta e sem busca de preços")
  }
} catch (error) {
  check(false, `service worker executa sem erro: ${error.stack ?? error}`)
}

// 3. Content script ----------------------------------------------------------------------------
try {
  const script = manifest.content_scripts?.[0]
  const fixture = readFileSync("tests/fixtures/botconversa-inbox.html", "utf8")
  const window = new Window({ url: "https://app.botconversa.com.br/1/inbox?chat_id=123" })
  window.document.write(fixture)
  const { chrome, listeners } = chromeStub()
  window.chrome = chrome

  const errors = []
  window.addEventListener("error", (event) => errors.push(event.error ?? event.message))
  for (const file of script.js) window.eval(read(file))
  await new Promise((resolve) => setTimeout(resolve, 300))

  check(errors.length === 0, `content script executa sem erro${errors.length ? `: ${errors[0]}` : ""}`)
  check(!!window.document.querySelector("plasmo-csui"), "content script monta a UI na página")
  const contentBundle = script.js.map(read).join("")
  check(
    contentBundle.includes("generate-report") && contentBundle.includes("open-report"),
    "content script referencia as rotas generate-report/open-report (sem a chave da API)"
  )
  const response = await deliver(listeners, { name: "get-conversation" })
  check(response?.conversation?.length === 10 && response.conversationKey === "123", `get-conversation lê a conversa (${response?.conversation?.length ?? 0} mensagens)`)
  await window.happyDOM.close()
} catch (error) {
  check(false, `content script executa sem erro: ${error.stack ?? error}`)
}

// 4. Side panel --------------------------------------------------------------------------------
try {
  const html = read(manifest.side_panel.default_path)
  const scriptFile = html.match(/<script src="\/([^"]+)"/)?.[1]
  const window = new Window({ url: "chrome-extension://smoke-test/sidepanel.html" })
  window.document.write('<div id="__plasmo"></div>')
  window.chrome = chromeStub().chrome

  const errors = []
  window.addEventListener("error", (event) => errors.push(event.error ?? event.message))
  window.eval(read(scriptFile))
  // O script é `defer`: no navegador ele roda antes do DOMContentLoaded, que dispara o mount.
  window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 300))

  const button = Array.from(window.document.querySelectorAll("button")).find((b) =>
    b.textContent.includes("Analisar conversa atual")
  )
  check(errors.length === 0 && !!button, `side panel carrega e renderiza${errors.length ? `: ${errors[0]}` : ""}`)

  // Coaching em streaming: a conversa vem do content script (simulado) e o relatório chega pela
  // conexão com o background (também simulada), primeiro em trechos e depois o resultado final.
  const conversation = [{ id: 1, author: "cliente", text: "Oi" }, { id: 2, author: "vendedor", text: "Olá!" }]
  window.chrome.tabs.query = async () => [{ id: 1 }]
  window.chrome.tabs.sendMessage = async () => ({ platform: "botconversa", conversationKey: "1", conversation })
  let panelPort
  window.chrome.runtime.connect = ({ name }) => {
    const listeners = []
    panelPort = {
      name,
      sent: [],
      emit: (message) => listeners.forEach((listener) => listener(message)),
      onMessage: { addListener: (fn) => listeners.push(fn), removeListener: () => {} },
      onDisconnect: { addListener: () => {}, removeListener: () => {} },
      postMessage: (message) => panelPort.sent.push(message),
      disconnect: () => {}
    }
    return panelPort
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100))
  const text = () => window.document.body.textContent
  button.click()
  await settle()
  check(panelPort?.name === "coach-conversation" && panelPort.sent[0]?.conversation?.length === 2, "side panel abre a conexão do coaching e envia a conversa")

  // Metade do JSON: o resumo já chegou inteiro, o resto ainda não.
  const json = JSON.stringify(fakeModel.coach)
  const half = json.slice(0, json.indexOf('"authority"'))
  for (const piece of half.match(/[\s\S]{1,25}/g)) panelPort.emit({ type: "delta", text: piece })
  await settle()
  const busy = window.document.querySelector('[aria-busy="true"]')
  check(
    !!busy && text().includes("Boa condução.") && text().includes("Escrevendo a análise") && !text().includes("Enviar proposta.") && !text().includes("Copiar"),
    "side panel mostra o relatório parcial durante o streaming (sem botões de copiar)"
  )

  panelPort.emit({ type: "result", response: { ok: true, data: fakeModel.coach, meta: { model: "fake", promptVersion: "x", durationMs: 1000 } } })
  await settle()
  const copyButtons = Array.from(window.document.querySelectorAll("button")).filter((b) => b.textContent === "Copiar pergunta")
  check(
    !window.document.querySelector('[aria-busy="true"]') && text().includes("Enviar proposta.") && copyButtons.length === 3,
    `side panel mostra o relatório final (${copyButtons.length} perguntas BANT para copiar)`
  )
  check(errors.length === 0, `side panel sem erros durante o streaming${errors.length ? `: ${errors[0]}` : ""}`)
  await window.happyDOM.close()
} catch (error) {
  check(false, `side panel executa sem erro: ${error.stack ?? error}`)
}

// 5. Trava diária, widget e página do relatório --------------------------------------------------
// Executa a build de verdade para provar as garantias da fase: em produção o widget bloqueia a
// segunda geração do dia (cota consumida), o relatório não leva custo e a busca de preços não
// roda; em dev a cota fica livre (para testar) e o custo aparece. A data é a local de hoje, a
// mesma que `dayKey()` calcula no navegador.

const today = (() => {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
})()

const REPORT_GENERATED_PREFIX = "drummond.report.generated."
const REPORT_DATE = "2026-10-07"

/** `chrome` com um `storage.local` em memória (semeado): o mínimo para a trava e a página. */
const chromeWithStorage = (seed = {}) => {
  const store = { ...seed }
  const area = {
    get: async (keys) =>
      keys == null
        ? { ...store }
        : typeof keys === "string"
          ? { [keys]: store[keys] }
          : Object.fromEntries(keys.map((key) => [key, store[key]])),
    set: async (items) => Object.assign(store, items),
    remove: async (key) => {
      delete store[key]
    }
  }
  const { chrome } = chromeStub()
  chrome.storage = {
    local: area,
    onChanged: { addListener: () => {}, removeListener: () => {} }
  }
  return chrome
}

// 5a. Widget do dia no content script ------------------------------------------------------------
try {
  const contentScript = manifest.content_scripts?.[0]
  const window = new Window({ url: "https://app.botconversa.com.br/1/inbox?chat_id=123" })
  window.document.write(readFileSync("tests/fixtures/botconversa-inbox.html", "utf8"))
  // Cota do dia já consumida: produção tem que travar o botão; dev ignora a trava de propósito.
  window.chrome = chromeWithStorage({
    [`${REPORT_GENERATED_PREFIX}${today}`]: { generatedAt: Date.now(), count: 1 }
  })

  const errors = []
  window.addEventListener("error", (event) => errors.push(event.error ?? event.message))
  for (const file of contentScript.js) window.eval(read(file))
  await new Promise((resolve) => setTimeout(resolve, 400))

  // A UI do content script vive num shadow DOM (`plasmo-csui`).
  const root = window.document.querySelector("plasmo-csui")?.shadowRoot ?? window.document
  const labels = Array.from(root.querySelectorAll("button")).map((button) => button.textContent.trim())
  const expected = isDevBuild ? "Encerrar o dia" : "Relatório de hoje já gerado"
  const warning = (root.textContent ?? "").includes("A cota de um relatório por dia já foi usada")
  check(labels.includes(expected), `widget ${isDevBuild ? "dev" : "produção"}: botão do dia em "${expected}" (${labels.join(" · ") || "nenhum botão"})`)
  check(warning === !isDevBuild, `widget ${isDevBuild ? "dev" : "produção"}: aviso da cota ${isDevBuild ? "ausente" : "presente"}`)
  check(errors.length === 0, `widget executa sem erro${errors.length ? `: ${errors[0]}` : ""}`)
  await window.happyDOM.close()
} catch (error) {
  check(false, `widget executa sem erro: ${error.stack ?? error}`)
}

// 5b. Página do relatório (tabs/report.html) ------------------------------------------------------
try {
  const reportHtml = read("tabs/report.html")
  const reportScript = reportHtml.match(/<script src="\/([^"]+)"/)?.[1]
  check(!!reportScript, "página do relatório: script emitido na build")

  const render = async (url, seed) => {
    const window = new Window({ url })
    window.document.write('<div id="__plasmo"></div>')
    window.chrome = chromeWithStorage(seed)
    const errors = []
    window.addEventListener("error", (event) => errors.push(event.error ?? event.message))
    window.eval(read(reportScript))
    // O script é `defer`: no navegador ele roda antes do DOMContentLoaded, que dispara o mount.
    window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 300))
    return { window, errors }
  }

  const empty = await render("chrome-extension://smoke-test/tabs/report.html", {})
  const emptyText = empty.window.document.body.textContent
  check(
    empty.errors.length === 0 && emptyText.includes("Ainda não há nenhum relatório gerado neste navegador."),
    `página do relatório renderiza o estado vazio${empty.errors.length ? `: ${empty.errors[0]}` : ""}`
  )
  await empty.window.happyDOM.close()

  // Relatório salvo (o que a aba abre com `?date=`): as seções aparecem e o custo só no dev.
  const stored = {
    date: REPORT_DATE,
    generatedAt: Date.now(),
    model: "fake/model",
    promptVersion: "v1",
    report: fakeModel.daily,
    input: dailyInput,
    cost: {
      estimate: { inputTokens: 1000, outputTokens: 200, minUsd: 0.0003, maxUsd: 0.0005, providers: 1 },
      effective: { usd: 0.00054, inputTokens: 1000, outputTokens: 200, reasoningTokens: 0, provider: "Fake" }
    }
  }
  const ready = await render(`chrome-extension://smoke-test/tabs/report.html?date=${REPORT_DATE}`, {
    [`drummond.report.${REPORT_DATE}`]: stored
  })
  const readyText = ready.window.document.body.textContent
  check(
    ready.errors.length === 0 && readyText.includes("Resumo geral") && readyText.includes(fakeModel.daily.resumo),
    `página do relatório renderiza o relatório salvo${ready.errors.length ? `: ${ready.errors[0]}` : ""}`
  )
  check(
    readyText.includes("Custo desta geração") === isDevBuild,
    `página do relatório ${isDevBuild ? "dev mostra" : "produção esconde"} o custo desta geração`
  )
  await ready.window.happyDOM.close()
} catch (error) {
  check(false, `página do relatório executa sem erro: ${error.stack ?? error}`)
}

if (failures.length > 0) {
  console.error(`\n${failures.length} verificação(ões) falharam.`)
  process.exit(1)
}
console.log("\nBuild verificada.")
// Sai explicitamente: timers dos bundles (ex.: reconexão do hot reload nas builds de dev)
// manteriam o processo vivo para sempre.
process.exit(0)
