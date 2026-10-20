import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, it, vi } from "vitest"

import type { ChatMessage } from "~adapters/types"

// Mede se Revisar e Coaching usam o áudio transcrito sem inventar e sem supor o áudio que não foi
// transcrito (prompt com a regra "Áudio transcrito" no SYSTEM_BASE). Conversas inventadas.
//
// Rodar:  pnpm bench:audio        (4 casos × BENCH_RUNS execuções; ~US$ 0,01 com 5)
// Chave:  PLASMO_PUBLIC_OPENROUTER_API_KEY do .env (nunca é impressa). Modelos e provedores: os do
//         .env, como na build.

const RUNS = Number(process.env.BENCH_RUNS ?? 5)
/** Só alguns casos, separados por vírgula (ex.: BENCH_CASES=R3,R3t). */
const ONLY = process.env.BENCH_CASES?.split(",").map((id) => id.trim())

const loadEnv = () => {
  const file = join(process.cwd(), ".env")
  if (!existsSync(file)) throw new Error("Sem .env com PLASMO_PUBLIC_OPENROUTER_API_KEY.")
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^(PLASMO_PUBLIC_[A-Z0-9_]+)=(.*)$/.exec(line)
    if (match) vi.stubEnv(match[1], match[2].trim().replace(/^["']|["']$/g, ""))
  }
}

const audio = (id: number, author: ChatMessage["author"], transcript?: string): ChatMessage => ({
  id,
  author,
  text: "[áudio]",
  audio: true,
  ...(transcript && { transcript })
})

const opening: ChatMessage[] = [
  { id: 1, author: "vendedor", text: "Olá, João! Aqui é a Ana, da loja. Como posso ajudar?" },
  { id: 2, author: "cliente", text: "Oi Ana, tudo bem?" }
]

const question = "Vocês emitem nota fiscal? E qual o prazo de entrega para Campinas?"

// Fatos que o modelo não conhece: aparecer no texto sugerido é invenção.
const INVENTED = /emitimos|emite(m)? nota|prazo de \d|\d+\s*dias|entregamos em/i

interface Outcome {
  ok: boolean
  flags: string[]
  sample: string
}

const cases: { id: string; label: string; run: () => Promise<Outcome> }[] = [
  {
    id: "R1",
    label: "Revisar: pergunta em áudio transcrito que o rascunho não responde",
    run: async () => {
      const { reviewDraft } = await import("~lib/ai/service")
      const conversation = [...opening, audio(3, "cliente", question)]
      const result = await reviewDraft(conversation, "Oi João, tudo bem sim! Te mando a proposta hoje.")
      if (!result.ok) return { ok: false, flags: [`erro: ${result.error}`], sample: "" }
      const { warnings, suggestedText } = result.data
      const flags = [
        warnings.length === 0 && "sem alerta para a pergunta do áudio",
        warnings.length > 0 && !/nota|prazo|entrega/i.test(warnings.join(" ")) && "alerta não cita nota/prazo",
        INVENTED.test(suggestedText) && "inventou fato no texto"
      ].filter((f): f is string => !!f)
      return { ok: flags.length === 0, flags, sample: `warnings=${JSON.stringify(warnings)} | texto=${suggestedText}` }
    }
  },
  {
    id: "R2",
    label: "Revisar: o mesmo áudio sem transcrição (não pode supor o conteúdo)",
    run: async () => {
      const { reviewDraft } = await import("~lib/ai/service")
      const conversation = [...opening, audio(3, "cliente")]
      const result = await reviewDraft(conversation, "Oi João, recebi seu áudio, já te respondo.")
      if (!result.ok) return { ok: false, flags: [`erro: ${result.error}`], sample: "" }
      const { warnings, suggestedText } = result.data
      const all = `${warnings.join(" ")} ${suggestedText}`
      const flags = [
        /nota fiscal|prazo|entrega|campinas/i.test(all) && "supôs o conteúdo do áudio",
        INVENTED.test(suggestedText) && "inventou fato no texto"
      ].filter((f): f is string => !!f)
      return { ok: flags.length === 0, flags, sample: `warnings=${JSON.stringify(warnings)} | texto=${suggestedText}` }
    }
  },
  {
    id: "R3",
    label: "Revisar: rascunho bom que já responde ao áudio transcrito (sem falso alerta)",
    run: async () => {
      const { reviewDraft } = await import("~lib/ai/service")
      const conversation = [...opening, audio(3, "cliente", "Vocês atendem em Campinas?")]
      const result = await reviewDraft(conversation, "Atendemos sim, João! Quer que eu te envie a proposta?")
      if (!result.ok) return { ok: false, flags: [`erro: ${result.error}`], sample: "" }
      const { warnings, suggestedText, status } = result.data
      const flags = [
        warnings.length > 0 && "alerta desnecessário",
        INVENTED.test(suggestedText) && "inventou fato no texto"
      ].filter((f): f is string => !!f)
      return { ok: flags.length === 0, flags, sample: `status=${status} warnings=${JSON.stringify(warnings)} | texto=${suggestedText}` }
    }
  },
  {
    id: "R3t",
    label: "Controle do R3: a mesma pergunta em texto (separa efeito do áudio do comportamento geral)",
    run: async () => {
      const { reviewDraft } = await import("~lib/ai/service")
      const conversation = [...opening, { id: 3, author: "cliente", text: "Vocês atendem em Campinas?" } as ChatMessage]
      const result = await reviewDraft(conversation, "Atendemos sim, João! Quer que eu te envie a proposta?")
      if (!result.ok) return { ok: false, flags: [`erro: ${result.error}`], sample: "" }
      const { warnings, suggestedText, status } = result.data
      const flags = [warnings.length > 0 && "alerta desnecessário"].filter((f): f is string => !!f)
      return { ok: flags.length === 0, flags, sample: `status=${status} warnings=${JSON.stringify(warnings)} | texto=${suggestedText}` }
    }
  },
  {
    id: "C1",
    label: "Coaching: vendedor respondeu em áudio transcrito (não é pergunta ignorada)",
    run: async () => {
      const { coachConversation } = await import("~lib/ai/service")
      const conversation = [
        ...opening,
        audio(3, "cliente", question),
        audio(4, "vendedor", "Emitimos nota fiscal, sim. Para Campinas a entrega leva em média cinco dias úteis."),
        { id: 5, author: "cliente", text: "Ótimo, obrigado!" } as ChatMessage,
        { id: 6, author: "vendedor", text: "Por nada! Quer que eu monte a proposta?" } as ChatMessage
      ]
      const result = await coachConversation(conversation)
      if (!result.ok) return { ok: false, flags: [`erro: ${result.error}`], sample: "" }
      const report = result.data
      const text = JSON.stringify(report)
      const flags = [
        /(não|sem) (respondeu|responder|resposta)|ignor/i.test(`${report.summary} ${report.nextStep} ${report.improvements.map((i) => i.issue).join(" ")}`) &&
          "tratou a pergunta como sem resposta",
        report.improvements.some((i) => i.messageId === 4) && "melhoria sobre o áudio transcrito",
        !/nota|prazo|entrega|cinco dias/i.test(text) && "não usou o conteúdo do áudio"
      ].filter((f): f is string => !!f)
      return { ok: flags.length === 0, flags, sample: `summary=${report.summary} | next=${report.nextStep}` }
    }
  }
]

describe("prompts com áudio", () => {
  it(`${cases.length} casos × ${RUNS} execuções`, async () => {
    loadEnv()
    for (const item of cases.filter((c) => !ONLY || ONLY.includes(c.id))) {
      const outcomes: Outcome[] = []
      for (let i = 0; i < RUNS; i++) {
        vi.resetModules()
        outcomes.push(await item.run())
      }
      const passed = outcomes.filter((o) => o.ok).length
      console.log(`\n${item.id} ${passed}/${RUNS} — ${item.label}`)
      outcomes.forEach((o, i) => console.log(`  ${i + 1}. ${o.ok ? "ok" : `FALHA (${o.flags.join("; ")})`} ${o.sample.slice(0, 260)}`))
    }
  }, 600_000)
})
