import { config, type ModelConfig } from "~lib/config"

import type { EffectiveCost, ModelEndpoint } from "./cost"
import type { PromptMessages } from "./prompts"
import type { toResponseFormat } from "./schemas"

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
const MODELS_API = "https://openrouter.ai/api/v1/models"

// Lida só aqui para ficar apenas no bundle do background (ver comentário em lib/config.ts).
const getApiKey = () => process.env.PLASMO_PUBLIC_OPENROUTER_API_KEY ?? ""

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Custo já cobrado quando a falha veio depois da resposta (ex.: conteúdo vazio). */
    readonly effective?: EffectiveCost | null
  ) {
    super(message)
    this.name = "OpenRouterError"
  }
}

interface ChatCompletionRequest {
  prompt: PromptMessages
  responseFormat: ReturnType<typeof toResponseFormat>
  task: ModelConfig
  /**
   * Com este callback a resposta vem em streaming: cada trecho de texto é repassado assim que
   * chega, e a promessa resolve com o texto completo no fim, como na chamada normal.
   */
  onDelta?: (text: string) => void
  /** Cancela a chamada (ex.: o painel que pediu a análise foi fechado). */
  signal?: AbortSignal
}

export interface ChatCompletionResult {
  content: string
  effective: EffectiveCost | null
}

// O OpenRouter devolve `usage` (tokens + custo em US$) em toda resposta, sem parâmetro extra. No
// streaming, ele vem no último evento.
const toEffective = (body: any): EffectiveCost | null => {
  const usage = body?.usage
  if (!usage) return null
  return {
    usd: typeof usage.cost === "number" ? usage.cost : null,
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    provider: typeof body.provider === "string" ? body.provider : undefined
  }
}

const endpointsCache = new Map<string, Promise<ModelEndpoint[]>>()

/**
 * Provedores do modelo com preços (API pública, sem chave). Fica em cache enquanto o service
 * worker estiver vivo; falhas não são cacheadas.
 */
export const fetchModelEndpoints = (model: string) => {
  const id = model.split(":")[0] // variantes como ":nitro" usam os mesmos provedores
  let cached = endpointsCache.get(id)
  if (!cached) {
    cached = fetch(`${MODELS_API}/${id}/endpoints`).then(async (response) => {
      if (!response.ok) throw new Error(`Preços indisponíveis (${response.status})`)
      return ((await response.json())?.data?.endpoints ?? []) as ModelEndpoint[]
    })
    cached.catch(() => endpointsCache.delete(id))
    endpointsCache.set(id, cached)
  }
  return cached
}

const describeHttpError = (status: number, detail: string, task: ModelConfig) => {
  switch (status) {
    case 400:
      return `Requisição recusada pelo OpenRouter: ${detail}`
    case 401:
      return "Chave do OpenRouter inválida ou revogada. Gere uma nova build com a chave correta."
    case 402:
      return "Sem créditos no OpenRouter. Avise o responsável pela chave."
    case 403:
      return "O conteúdo foi bloqueado pela moderação do provedor."
    case 404: {
      // Modelo inexistente, ou nenhum provedor dele atende a `require_parameters` (formato de
      // resposta + temperatura e raciocínio, se enviados) somado a `data_collection: deny`.
      const requirements = [
        task.responseFormat === "json_schema" ? "JSON Schema" : "JSON",
        ...(config.denyDataCollection ? ["política de dados"] : []),
        ...(task.temperature !== undefined ? ["temperatura"] : []),
        ...(task.reasoning ? ["raciocínio"] : [])
      ]
      return `Nenhum provedor do modelo "${task.model}" atende aos requisitos da extensão (${requirements.join(", ")}). Tente outro modelo, remova a temperatura/o raciocínio do perfil ou, se o modelo não aceita JSON Schema, use json_object. Detalhe: ${detail}`
    }
    case 408:
      return "A IA demorou demais para responder. Tente novamente."
    case 429:
      return "Muitas requisições em sequência. Aguarde alguns segundos e tente de novo."
    default:
      return status >= 500
        ? "O provedor do modelo está instável no momento. Tente novamente em instantes."
        : `Erro ${status} no OpenRouter: ${detail}`
  }
}

const readErrorDetail = async (response: Response) => {
  try {
    const body = await response.json()
    return String(body?.error?.message ?? response.statusText)
  } catch {
    return response.statusText
  }
}

const providerError = (body: any, effective: EffectiveCost | null = null) =>
  new OpenRouterError(`Erro do provedor: ${body.error.message ?? "desconhecido"}`, undefined, effective)

/**
 * Lê o corpo SSE de uma resposta em streaming e entrega cada evento `data:` já como objeto.
 * Linhas que começam com ":" (ex.: ": OPENROUTER PROCESSING") são keep-alive e ficam de fora.
 */
const readEvents = async (body: ReadableStream<Uint8Array>, onEvent: (event: any) => void) => {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split("\n")
      buffer = done ? "" : lines.pop()!
      for (const line of lines) {
        if (!line.startsWith("data:")) continue
        const data = line.slice(5).trim()
        if (!data || data === "[DONE]") continue
        let event: unknown
        try {
          event = JSON.parse(data)
        } catch {
          throw new OpenRouterError("O OpenRouter enviou uma resposta corrompida. Tente novamente.")
        }
        onEvent(event)
      }
      if (done) return
    }
  } catch (error) {
    reader.cancel().catch(() => {}) // não deixa a conexão aberta depois de um erro
    throw error
  }
}

/** Junta os trechos de uma resposta em streaming, repassando cada um a `onDelta`. */
const readStream = async (response: Response, onDelta: (text: string) => void) => {
  let content = ""
  let effective: EffectiveCost | null = null
  await readEvents(response.body!, (event) => {
    effective = toEffective(event) ?? effective
    // Erro depois do início do streaming: o HTTP já foi 200, então ele chega como evento.
    if (event?.error) throw providerError(event, effective)
    const delta = event?.choices?.[0]?.delta?.content
    if (typeof delta === "string" && delta) {
      content += delta
      onDelta(delta)
    }
  })
  return { content, effective }
}

const readBody = async (response: Response) => {
  const body = await response.json()
  if (body?.error) throw providerError(body)
  return { content: body?.choices?.[0]?.message?.content, effective: toEffective(body) }
}

/** Faz uma chamada de chat completion e devolve o texto da resposta e o custo efetivo. */
export const chatCompletion = async ({
  prompt,
  responseFormat,
  task,
  onDelta,
  signal
}: ChatCompletionRequest): Promise<ChatCompletionResult> => {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new OpenRouterError(
      "Chave do OpenRouter ausente. Defina PLASMO_PUBLIC_OPENROUTER_API_KEY no .env e gere a build novamente."
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), task.timeoutMs)
  const cancel = () => controller.abort()
  signal?.addEventListener("abort", cancel)

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-OpenRouter-Title": "Drummond by BW"
      },
      body: JSON.stringify({
        model: task.model,
        temperature: task.temperature, // undefined some do JSON: o provedor usa o padrão
        reasoning: task.reasoning,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        response_format: responseFormat,
        stream: onDelta ? true : undefined,
        provider: {
          // Só provedores que suportam TODOS os parâmetros enviados — sem isso, um provedor sem
          // JSON Schema ignora o `response_format` e a resposta volta fora do formato.
          require_parameters: true,
          ...(task.providerOrder && { order: task.providerOrder }),
          ...(config.denyDataCollection && { data_collection: "deny" })
        }
      })
    })

    if (!response.ok) {
      throw new OpenRouterError(
        describeHttpError(response.status, await readErrorDetail(response), task),
        response.status
      )
    }

    const { content, effective } = onDelta ? await readStream(response, onDelta) : await readBody(response)
    if (typeof content !== "string" || !content.trim()) {
      throw new OpenRouterError("A IA retornou uma resposta vazia. Tente novamente.", undefined, effective)
    }
    return { content, effective }
  } catch (error) {
    if (error instanceof OpenRouterError) throw error
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OpenRouterError(
        signal?.aborted ? "Análise cancelada." : "A IA demorou demais para responder. Tente novamente."
      )
    }
    throw new OpenRouterError("Falha de rede ao falar com o OpenRouter. Verifique sua conexão.")
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", cancel)
  }
}
