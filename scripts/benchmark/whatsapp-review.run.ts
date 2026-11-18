import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, it, vi } from "vitest"

import type { ChatMessage } from "~adapters/types"

// Mede se o Revisar do WhatsApp lê certo quem disse o quê. Com os rótulos VENDEDOR/CLIENTE o modelo
// supunha que o cliente pergunta e o vendedor responde, e invertia a conversa quando era o
// contrário (W1). Conversas inventadas.
//
// Rodar:  pnpm bench:whatsapp     (2 casos × BENCH_RUNS execuções)
// Chave:  PLASMO_PUBLIC_OPENROUTER_API_KEY do .env (nunca é impressa).

const RUNS = Number(process.env.BENCH_RUNS ?? 5)

const loadEnv = () => {
  const file = join(process.cwd(), ".env")
  if (!existsSync(file)) throw new Error("Sem .env com PLASMO_PUBLIC_OPENROUTER_API_KEY.")
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^(PLASMO_PUBLIC_[A-Z0-9_]+)=(.*)$/.exec(line)
    if (match) vi.stubEnv(match[1], match[2].trim().replace(/^["']|["']$/g, ""))
  }
}

const context = { platform: "whatsapp", contactName: "Rafa Lima" }

interface Outcome {
  ok: boolean
  sample: string
}

const cases: { id: string; label: string; run: () => Promise<Outcome> }[] = [
  {
    id: "W1",
    label: "o AUTOR perguntou e o CONTATO respondeu: o alerta não pode inverter os papéis",
    run: async () => {
      const { reviewDraft } = await import("~lib/ai/service")
      const conversation: ChatMessage[] = [
        { id: 1, author: "cliente", text: "Empatia e resolubilidade" },
        { id: 2, author: "vendedor", text: "só o revisar já serviria?" },
        { id: 3, author: "cliente", text: '(em resposta a: "só o revisar já serviria?") Sim' },
        { id: 4, author: "cliente", text: "Sem crise" },
        { id: 5, author: "vendedor", text: "a pessoa que atende no whatsapp web usa mais áudio ou texto?" },
        { id: 6, author: "cliente", text: "Texto" }
      ]
      const result = await reviewDraft(conversation, "cara sinceramente acho que esse barco ja partiu", context)
      if (!result.ok) return { ok: false, sample: result.error }
      const warnings = result.data.warnings.join(" | ")
      // Inversão: o contato "perguntou" sobre áudio/texto, ou "você respondeu" Texto.
      const inverted =
        /você respondeu|(cliente|contato|pessoa|rafa|ele|ela)\s+(te\s+|lhe\s+)?(perguntou|quer saber)[^|]*(áudio|texto)/i
      return { ok: !inverted.test(warnings), sample: warnings || "(sem alertas)" }
    }
  },
  {
    id: "W2",
    label: "o CONTATO perguntou e o rascunho não responde: precisa de alerta",
    run: async () => {
      const { reviewDraft } = await import("~lib/ai/service")
      const conversation: ChatMessage[] = [
        { id: 1, author: "vendedor", text: "Oi Rafa! Recebi seu pedido." },
        { id: 2, author: "cliente", text: "Oi! Que horas vocês fecham hoje? Queria passar aí" }
      ]
      const result = await reviewDraft(conversation, "que bom q vc gostou, qualquer coisa me chama", context)
      if (!result.ok) return { ok: false, sample: result.error }
      const warnings = result.data.warnings.join(" | ")
      return { ok: result.data.warnings.length > 0, sample: warnings || "(sem alertas)" }
    }
  }
]

describe("Revisar no WhatsApp", () => {
  for (const c of cases) {
    it(`${c.id}: ${c.label}`, { timeout: 120_000 }, async () => {
      loadEnv()
      const outcomes: Outcome[] = []
      for (let i = 0; i < RUNS; i++) outcomes.push(await c.run())
      const passed = outcomes.filter((o) => o.ok).length
      console.log(`\n${c.id} ${passed}/${RUNS} — ${c.label}`)
      for (const o of outcomes) console.log(`  ${o.ok ? "ok " : "ERR"} ${o.sample.slice(0, 220)}`)
    })
  }
})
