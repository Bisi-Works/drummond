import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { describe, it } from "vitest"

import { CLOSING_QUESTION, buildClosingState } from "~lib/ai/jev"
import { config } from "~lib/config"
import { isClosingCandidate, isClosingMessage } from "~lib/tracking/closing"

import { dataset, type Sample } from "./closing-dataset"

// Mede quem decide melhor se a última mensagem do cliente EXIGE resposta do vendedor: a regra de
// texto atual (`isClosingMessage`) contra o Jev (Decisions API do OpenRouter), em variantes que
// isolam idioma da pergunta, contexto (mensagem anterior do vendedor), ordem das opções e Choice
// × Noul. Usa só mensagens inventadas (`closing-dataset.ts`).
//
// Rodar:  pnpm bench:closing        (faz ~800 chamadas; custa menos de um centavo)
// Chave:  PLASMO_PUBLIC_OPENROUTER_API_KEY do .env (nunca é impressa). Saída detalhada opcional
//         em BENCH_OUT=<arquivo.json>. Modelo: BENCH_MODEL (padrão typesafe/jev-1.13).
//
// O erro caro é ESCONDER um cliente que espera (falso "encerramento"): por isso o relatório mostra,
// para cada limiar de confiança, quantas conversas aguardando seriam escondidas por engano.

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
const MODEL = process.env.BENCH_MODEL ?? "typesafe/jev-1.13"
const THRESHOLDS = [0.5, 0.7, 0.8, 0.9, 0.95, 0.99]
const CONCURRENCY = 6

const readKey = (): string => {
  const fromEnv = process.env.PLASMO_PUBLIC_OPENROUTER_API_KEY
  if (fromEnv) return fromEnv
  const file = join(process.cwd(), ".env")
  if (!existsSync(file)) throw new Error("Sem PLASMO_PUBLIC_OPENROUTER_API_KEY (nem .env).")
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("PLASMO_PUBLIC_OPENROUTER_API_KEY="))
  const value = line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")
  if (!value) throw new Error("PLASMO_PUBLIC_OPENROUTER_API_KEY vazia no .env.")
  return value
}

// --- Variantes ------------------------------------------------------------------------------

type Question = Record<string, unknown>
interface Variant {
  id: string
  label: string
  question: (reversed: boolean) => Question
  state: (sample: Sample) => unknown
  /** P(NÃO precisa de resposta), a partir da resposta da API; `null` quando ilegível. */
  pNoReply: (answer: Record<string, unknown> | undefined) => number | null
  reversed: boolean
}

const ordered = (entries: [string, string][], reversed: boolean) =>
  Object.fromEntries(reversed ? [...entries].reverse() : entries)

const PT_CRITERIA: [string, string][] = [
  [
    "precisa_resposta",
    "O cliente fez uma pergunta, um pedido, abriu a conversa, relatou um problema, respondeu algo que o vendedor precisa agir ou continuar, ou a conversa ainda não terminou."
  ],
  [
    "nao_precisa_resposta",
    "O cliente está apenas agradecendo, se despedindo ou confirmando que entendeu, e a conversa pode terminar sem outra mensagem do vendedor."
  ]
]
const EN_CRITERIA: [string, string][] = [
  [
    "needs_reply",
    "The customer asked a question, made a request, opened the conversation, reported a problem, answered something the seller must act on, or the conversation is not over."
  ],
  [
    "no_reply_needed",
    "The customer is only thanking, saying goodbye or acknowledging, and the conversation can end without another seller message."
  ]
]

const choiceProb = (name: string) => (answer: Record<string, unknown> | undefined) => {
  const p = (answer?.probabilities as Record<string, number> | undefined)?.[name]
  return typeof p === "number" ? p : null
}

const lastOnly = (s: Sample) => ({ ultima_mensagem_do_cliente: s.text })
const withContext = (s: Sample) => ({
  conversa: [...(s.previous ? [{ de: "vendedor", texto: s.previous }] : []), { de: "cliente", texto: s.text }]
})
const withContextEn = (s: Sample) => ({
  conversation: [
    ...(s.previous ? [{ from: "seller", text: s.previous }] : []),
    { from: "customer", text: s.text }
  ]
})

const variants: Variant[] = []
for (const reversed of [false, true]) {
  const order = reversed ? "opção segura por último" : "opção segura primeiro"
  variants.push(
    {
      id: `pt-ultima${reversed ? "-rev" : ""}`,
      label: `Choice PT, só a última mensagem (${order})`,
      reversed,
      state: lastOnly,
      question: (r) => ({
        type: "choice",
        instructions: "A última mensagem do cliente exige uma resposta do vendedor?",
        criteria: ordered(PT_CRITERIA, r)
      }),
      pNoReply: choiceProb("nao_precisa_resposta")
    },
    {
      id: `pt-contexto${reversed ? "-rev" : ""}`,
      label: `Choice PT, com a mensagem anterior do vendedor (${order})`,
      reversed,
      state: withContext,
      question: (r) => ({
        type: "choice",
        instructions: "A última mensagem do cliente exige uma resposta do vendedor?",
        criteria: ordered(PT_CRITERIA, r)
      }),
      pNoReply: choiceProb("nao_precisa_resposta")
    },
    {
      id: `en-contexto${reversed ? "-rev" : ""}`,
      label: `Choice EN (pergunta em inglês), com contexto (${order})`,
      reversed,
      state: withContextEn,
      question: (r) => ({
        type: "choice",
        instructions: "Does the customer's last message require a reply from the seller?",
        criteria: ordered(EN_CRITERIA, r)
      }),
      pNoReply: choiceProb("no_reply_needed")
    }
  )
}
// A pergunta e o estado EXATOS que vão para produção (`lib/ai/jev.ts`): é esta a variante que a
// "cascata de produção" abaixo usa.
variants.push({
  id: "producao",
  label: "PRODUÇÃO: Choice PT com contexto, dispensa primeiro (lib/ai/jev.ts)",
  reversed: false,
  state: (s) => buildClosingState({ previous: s.previous, text: s.text }),
  question: () => CLOSING_QUESTION as unknown as Question,
  pNoReply: choiceProb("nao_precisa_resposta")
})
variants.push({
  id: "noul-contexto",
  label: "Noul PT, com contexto",
  reversed: false,
  state: withContext,
  question: () => ({
    type: "noul",
    instructions: "O vendedor ainda precisa responder à última mensagem do cliente?",
    criteria: {
      true: "O cliente perguntou, pediu algo, abriu a conversa, relatou um problema ou a conversa não terminou.",
      false: "O cliente só agradeceu, se despediu ou confirmou, e a conversa pode terminar."
    }
  }),
  pNoReply: (answer) => (typeof answer?.noul === "number" ? 1 - (answer.noul as number) : null)
})

// --- Chamadas -------------------------------------------------------------------------------

interface Call {
  variant: string
  sample: string
  pNoReply: number | null
  confidence: number | null
  ms: number
  cost: number
  inputTokens: number
  error?: string
}

const call = async (key: string, variant: Variant, sample: Sample): Promise<Call> => {
  const body = {
    model: MODEL,
    provider: { data_collection: "deny" },
    state: variant.state(sample),
    questions: { reply: variant.question(variant.reversed) }
  }
  const started = performance.now()
  let lastError = "falhou"
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000)
      })
      if (response.status === 429 || response.status >= 500) {
        lastError = `HTTP ${response.status}`
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
        continue
      }
      const json = (await response.json()) as {
        answers?: Record<string, Record<string, unknown>>
        usage?: { cost?: number; input_tokens?: number }
        error?: { message?: string }
      }
      if (!response.ok) {
        return fail(variant, sample, started, `HTTP ${response.status}: ${json.error?.message ?? ""}`.slice(0, 160))
      }
      const answer = json.answers?.reply
      return {
        variant: variant.id,
        sample: sample.id,
        pNoReply: variant.pNoReply(answer),
        confidence: typeof answer?.confidence === "number" ? (answer.confidence as number) : null,
        ms: performance.now() - started,
        cost: json.usage?.cost ?? 0,
        inputTokens: json.usage?.input_tokens ?? 0
      }
    } catch (error) {
      lastError = String(error).slice(0, 120)
    }
  }
  return fail(variant, sample, started, lastError)
}

const fail = (variant: Variant, sample: Sample, started: number, error: string): Call => ({
  variant: variant.id,
  sample: sample.id,
  pNoReply: null,
  confidence: null,
  ms: performance.now() - started,
  cost: 0,
  inputTokens: 0,
  error
})

const pool = async <T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await work(items[index])
      }
    })
  )
  return results
}

// --- Métricas -------------------------------------------------------------------------------

const pct = (value: number) => `${(value * 100).toFixed(0)}%`
const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0

interface Row {
  hidden: number // FP: cliente que espera e seria escondido (o erro caro)
  dismissed: number // TP: encerramento dispensado corretamente
  missed: number // FN: encerramento que continua aguardando (alerta a mais)
  precision: number
  recall: number
}

/** `predictedClosing(sample)` decide "encerramento"; o rótulo verdadeiro é `!needsReply`. */
const score = (predictedClosing: (s: Sample) => boolean): Row => {
  let hidden = 0
  let dismissed = 0
  let missed = 0
  for (const s of dataset) {
    const predicted = predictedClosing(s)
    if (predicted && s.needsReply) hidden++
    else if (predicted && !s.needsReply) dismissed++
    else if (!predicted && !s.needsReply) missed++
  }
  return {
    hidden,
    dismissed,
    missed,
    precision: dismissed + hidden === 0 ? 1 : dismissed / (dismissed + hidden),
    recall: dismissed + missed === 0 ? 0 : dismissed / (dismissed + missed)
  }
}

const line = (name: string, r: Row) =>
  `  ${name.padEnd(16)} escondidos(erro caro)=${String(r.hidden).padStart(2)}  dispensados=${String(r.dismissed).padStart(2)}  alertas a mais=${String(r.missed).padStart(2)}  precisão=${pct(r.precision).padStart(4)}  cobertura=${pct(r.recall).padStart(4)}`

describe("benchmark: encerramento do cliente", () => {
  it(
    "compara a regra de texto e o Jev",
    async () => {
      const key = readKey()
      const total = dataset.length
      const closings = dataset.filter((s) => !s.needsReply).length
      console.log(`\nConjunto: ${total} mensagens inventadas (${closings} encerramentos, ${total - closings} exigem resposta, ${dataset.filter((s) => s.borderline).length} duvidosas)`)
      console.log(`Modelo: ${MODEL} · ${variants.length} variantes · ${variants.length * total} chamadas\n`)

      const jobs = variants.flatMap((variant) => dataset.map((sample) => ({ variant, sample })))
      const calls = await pool(jobs, CONCURRENCY, ({ variant, sample }) => call(key, variant, sample))

      console.log("Regra de texto atual (isClosingMessage)")
      console.log(line("regra", score((s) => isClosingMessage(s.text))))

      const bySample = new Map(dataset.map((s) => [s.id, s]))
      const summary: Record<string, unknown> = {}
      for (const variant of variants) {
        const own = calls.filter((c) => c.variant === variant.id)
        const errors = own.filter((c) => c.pNoReply === null).length
        const prob = new Map(own.map((c) => [c.sample, c.pNoReply]))
        console.log(`\n${variant.id} — ${variant.label}${errors ? `  [${errors} sem resposta]` : ""}`)
        const rows: Record<string, Row> = {}
        for (const t of THRESHOLDS) {
          rows[String(t)] = score((s) => (prob.get(s.id) ?? 0) >= t)
          console.log(line(`P ≥ ${t}`, rows[String(t)]))
        }
        summary[variant.id] = { label: variant.label, errors, rows }
      }

      // A decisão que o app toma de verdade: filtro de candidata → regra de texto → IA no limiar.
      const prod = new Map(calls.filter((c) => c.variant === "producao").map((c) => [c.sample, c.pNoReply]))
      const threshold = config.closing.threshold
      const pipeline = (s: Sample) => {
        if (!isClosingCandidate(s.text)) return false
        const questionBefore = s.previous?.includes("?") === true
        if (isClosingMessage(s.text) && !questionBefore) return true
        return (prod.get(s.id) ?? 0) >= threshold
      }
      const cascade = score(pipeline)
      console.log(`
CASCATA DE PRODUÇÃO (filtro + regra + IA com P ≥ ${threshold})`)
      console.log(line("cascata", cascade))
      const hiddenByCascade = dataset.filter((s) => s.needsReply && pipeline(s))
      for (const s of hiddenByCascade) console.log(`    escondida: ${JSON.stringify(s.text)}${s.previous ? `  (após: ${JSON.stringify(s.previous)})` : ""}${s.borderline ? " [duvidosa]" : ""}`)
      const missedByCascade = dataset.filter((s) => !s.needsReply && !pipeline(s))
      console.log(`  alertas a mais (${missedByCascade.length}):`)
      for (const s of missedByCascade) console.log(`    - ${JSON.stringify(s.text)}${s.previous ? `  (após: ${JSON.stringify(s.previous)})` : ""}${s.borderline ? " [duvidosa]" : ""}`)
      summary.cascade = cascade

      const ok = calls.filter((c) => !c.error)
      const latency = ok.map((c) => c.ms).sort((a, b) => a - b)
      const cost = calls.reduce((sum, c) => sum + c.cost, 0)
      console.log("\nResumo da execução")
      console.log(`  chamadas=${calls.length}  com erro=${calls.length - ok.length}`)
      console.log(`  latência p50=${quantile(latency, 0.5).toFixed(0)} ms  p95=${quantile(latency, 0.95).toFixed(0)} ms`)
      console.log(`  tokens de entrada (média)=${(ok.reduce((s, c) => s + c.inputTokens, 0) / Math.max(1, ok.length)).toFixed(0)}`)
      console.log(`  custo total=US$ ${cost.toFixed(6)}  (por chamada ≈ US$ ${(cost / Math.max(1, ok.length)).toFixed(7)})`)

      const errorKinds = [...new Set(calls.filter((c) => c.error).map((c) => c.error))]
      if (errorKinds.length) console.log(`  erros: ${errorKinds.slice(0, 5).join(" | ")}`)

      // Escondidos por engano no limiar 0.9, por variante: é onde está o risco real.
      console.log("\nConversas aguardando que seriam ESCONDIDAS com P ≥ 0.9 (por variante)")
      for (const variant of variants) {
        const wrong = calls
          .filter((c) => c.variant === variant.id && (c.pNoReply ?? 0) >= 0.9)
          .map((c) => bySample.get(c.sample)!)
          .filter((s) => s.needsReply)
        if (wrong.length === 0) continue
        console.log(`  ${variant.id}:`)
        for (const s of wrong) console.log(`    - ${JSON.stringify(s.text)}${s.previous ? `  (após: ${JSON.stringify(s.previous)})` : ""}${s.borderline ? " [duvidosa]" : ""}`)
      }

      if (process.env.BENCH_OUT) {
        writeFileSync(process.env.BENCH_OUT, JSON.stringify({ model: MODEL, summary, calls }, null, 1))
        console.log(`\nDetalhes gravados em ${process.env.BENCH_OUT}`)
      }
    },
    20 * 60_000
  )
})
