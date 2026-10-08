import { config } from "~lib/config"
import type { ClassifyClosingRequest, ClassifyClosingResponse } from "~lib/messages"

// Decide se a última mensagem do cliente é só um encerramento ("obrigado", "ok", 👍) pela Decisions
// API do OpenRouter (modelo Jev, da TypeSafe). Diferente do resto de `lib/ai`, não é uma chamada de
// chat: o Jev não escreve texto, ele responde uma pergunta tipada com probabilidades, e é a
// probabilidade que decide (ver `config.closing.threshold`).
//
// Lida só aqui para ficar apenas no bundle do background (ver comentário em lib/config.ts).
// A variante é a que foi melhor no benchmark (scripts/benchmark/closing.run.ts): Choice em português,
// com a mensagem anterior do vendedor e a opção que dispensa a conversa primeiro.

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
const getApiKey = () => process.env.PLASMO_PUBLIC_OPENROUTER_API_KEY ?? ""

/** Texto maior que isto é cortado: encerramentos são curtos e cada token custa. */
const MAX_TEXT = 300

const clip = (text: string) => (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text)

/** A pergunta enviada ao Jev. Exportada para o benchmark medir exatamente o que vai para produção. */
export const CLOSING_QUESTION = {
  type: "choice",
  instructions: "A última mensagem do cliente exige uma resposta do vendedor?",
  criteria: {
    nao_precisa_resposta:
      "O cliente está apenas agradecendo, se despedindo ou confirmando que entendeu, e a conversa pode terminar sem outra mensagem do vendedor.",
    precisa_resposta:
      "O cliente fez uma pergunta, um pedido, abriu a conversa, relatou um problema, respondeu algo que o vendedor precisa agir ou continuar, ou a conversa ainda não terminou."
  }
} as const

/** `state` da requisição: a mensagem anterior do vendedor (se houver) e a do cliente. */
export const buildClosingState = ({ previous, text }: ClassifyClosingRequest) => ({
  conversa: [
    ...(previous ? [{ de: "vendedor", texto: clip(previous) }] : []),
    { de: "cliente", texto: clip(text) }
  ]
})

export const buildClosingRequest = (input: ClassifyClosingRequest, model = config.closing.model) => ({
  model,
  // Mesma política do resto do app: nada de provedor que retenha ou treine com as conversas.
  provider: { data_collection: "deny" },
  state: buildClosingState(input),
  questions: { reply: CLOSING_QUESTION }
})

/** P(não precisa de resposta) da resposta da API; `null` quando ela não tem o formato esperado. */
export const parseClosingAnswer = (body: unknown): number | null => {
  const answer = (body as { answers?: { reply?: { probabilities?: Record<string, unknown> } } })?.answers?.reply
  const p = answer?.probabilities?.nao_precisa_resposta
  return typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1 ? p : null
}

interface ClassifyDeps {
  fetch?: typeof fetch
  signal?: AbortSignal
}

/**
 * Pergunta ao Jev se a mensagem é só um encerramento. Nunca lança: qualquer falha vira
 * `{ ok: false }`, e quem chama trata isso como "continua aguardando" (o lado seguro).
 */
export const classifyClosing = async (
  input: ClassifyClosingRequest,
  deps: ClassifyDeps = {}
): Promise<ClassifyClosingResponse> => {
  if (!input?.text?.trim()) return { ok: false, error: "Mensagem vazia." }
  const key = getApiKey()
  if (!key) {
    return {
      ok: false,
      error: "Chave do OpenRouter ausente. Defina PLASMO_PUBLIC_OPENROUTER_API_KEY no .env e gere a build novamente."
    }
  }

  // Mesmo padrão do `openrouter.ts`: AbortController + setTimeout, sem depender de AbortSignal.timeout.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.closing.timeoutMs)
  deps.signal?.addEventListener("abort", () => controller.abort())

  try {
    const response = await (deps.fetch ?? fetch)(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildClosingRequest(input)),
      signal: controller.signal
    })
    if (!response.ok) return { ok: false, error: `Decisions API respondeu ${response.status}.` }

    const body = (await response.json()) as { usage?: { cost?: number } }
    const pNoReply = parseClosingAnswer(body)
    if (pNoReply === null) return { ok: false, error: "Resposta da Decisions API fora do formato esperado." }

    const cost = typeof body.usage?.cost === "number" ? body.usage.cost : undefined
    return {
      ok: true,
      closing: pNoReply >= config.closing.threshold,
      pNoReply,
      ...(cost === undefined ? {} : { cost })
    }
  } catch (error) {
    const aborted = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
    return { ok: false, error: aborted ? "A Decisions API demorou demais." : "Falha de rede ao chamar a Decisions API." }
  } finally {
    clearTimeout(timeout)
  }
}
