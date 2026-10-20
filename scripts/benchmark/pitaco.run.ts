import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, it, vi } from "vitest"

import type { ChatMessage } from "~adapters/types"

// Mede o resumo do Pitaco (Fazer / Não fazer): tópicos curtos, sem jargão de método nem #n, sem
// mensagem pronta e sem fato inventado, e se ele reflete o SPIN e o BANT da conversa. Também mede o
// tempo de resposta. Conversas inventadas.
//
// Rodar:  pnpm bench:pitaco        (4 casos × BENCH_RUNS execuções; ~US$ 0,01 com 5)
// Chave:  PLASMO_PUBLIC_OPENROUTER_API_KEY do .env (nunca é impressa). Modelos e provedores: os do
//         .env, como na build.

const RUNS = Number(process.env.BENCH_RUNS ?? 5)
/** Só alguns casos, separados por vírgula (ex.: BENCH_CASES=P1,P3). */
const ONLY = process.env.BENCH_CASES?.split(",").map((id) => id.trim())

const loadEnv = () => {
  const file = join(process.cwd(), ".env")
  if (!existsSync(file)) throw new Error("Sem .env com PLASMO_PUBLIC_OPENROUTER_API_KEY.")
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^(PLASMO_PUBLIC_[A-Z0-9_]+)=(.*)$/.exec(line)
    if (match) vi.stubEnv(match[1], match[2].trim().replace(/^["']|["']$/g, ""))
  }
}

const msg = (id: number, author: ChatMessage["author"], text: string): ChatMessage => ({ id, author, text })

// Jargão de método, citação de mensagem ou cara de mensagem pronta (saudação, vocativo). O nome do
// cliente em terceira pessoa ("Responder à saudação da Carla") é instrução, não mensagem.
const JARGON = /\bSPIN\b|\bBANT\b|implica[çc][ãa]o|#\d|\[\d+\]/i
const READY_MESSAGE = /^(ol[áa]|oi|bom dia|boa tarde)\b|"|^(Marcos|Carla|Rafael),/i
// Fatos que o modelo não conhece: valores, percentuais, prazos e descontos.
const INVENTED = /R\$\s*\d|\d+\s*%|\d+\s*(meses|dias|parcelas)|desconto de/i
const MAX_CHARS = 140

const cases: { id: string; label: string; conversation: ChatMessage[]; expect: (doNow: string, avoid: string) => string[] }[] = [
  {
    id: "P1",
    label: "Pergunta de preço no meio da descoberta (áudio transcrito)",
    conversation: [
      msg(1, "cliente", "Oi, quero saber do consórcio de carro."),
      msg(2, "vendedor", "Olá, Marcos! Para que você pretende usar o carro?"),
      {
        id: 3,
        author: "cliente",
        text: "[áudio]",
        audio: true,
        transcript: "Uso pra trabalhar com aplicativo, e o meu carro já está bem velho, vive na oficina."
      },
      msg(4, "cliente", "Quanto fica a parcela?")
    ],
    expect: (doNow, avoid) =>
      [
        !/pre[çc]o|parcela|valor/i.test(doNow) && "Fazer não acolhe a pergunta da parcela",
        // "Mandar a tabela antes de entender o uso" é aceitável; "Responder a parcela" no Não fazer, não.
        avoid
          .split(" | ")
          .some((item) => /\b(responder|informar|passar|falar)\b.{0,25}(pre[çc]o|parcela|valor)/i.test(item) &&
            !/antes|sem (entender|saber)|ignor|deixar sem/i.test(item)) && "Não fazer manda deixar a parcela sem resposta"
      ].filter((f): f is string => !!f)
  },
  {
    id: "P2",
    label: "Só a saudação: a descoberta ainda não começou",
    conversation: [
      msg(1, "vendedor", "Olá, Carla! Aqui é a Ana, da BW. Vi que você se interessou pelo nosso plano. Como posso ajudar?"),
      msg(2, "cliente", "Oi! Tudo bem?")
    ],
    expect: (doNow) =>
      [!/entender|perguntar|descobrir|saber/i.test(doNow) && "Fazer não orienta a descoberta"].filter(
        (f): f is string => !!f
      )
  },
  {
    id: "P3",
    label: "Dor clara, mas a decisão é de outra pessoa (BANT: autoridade)",
    conversation: [
      msg(1, "cliente", "Boa tarde, vi o anúncio do sistema de gestão para clínicas."),
      msg(2, "vendedor", "Boa tarde, Rafael! Como vocês organizam a agenda hoje?"),
      msg(3, "cliente", "Tudo em planilha, e vira e mexe marcamos dois pacientes no mesmo horário."),
      msg(4, "vendedor", "Entendi. E isso acontece com que frequência?"),
      msg(5, "cliente", "Toda semana. Os pacientes reclamam e já perdemos alguns."),
      msg(6, "cliente", "Mas quem decide essas coisas é minha sócia, a doutora Paula. Eu só estou pesquisando.")
    ],
    expect: (doNow) =>
      [!/s[óo]cia|paula|decis|decide/i.test(doNow) && "Fazer ignora quem decide (autoridade)"].filter(
        (f): f is string => !!f
      )
  },
  {
    id: "P4",
    label: "Objeção de preço depois da proposta",
    conversation: [
      msg(1, "cliente", "Recebi a proposta do plano anual."),
      msg(2, "vendedor", "Que bom! Ficou alguma dúvida?"),
      msg(3, "cliente", "Achei caro. Vou pensar e te falo.")
    ],
    expect: (doNow, avoid) =>
      [
        !/entender|motivo|pesa|o que (achou|considera)|acolh|ouvir/i.test(doNow) && "Fazer não busca entender a objeção",
        !/press|urg|insist|desconto|cobrar/i.test(avoid) && "Não fazer não alerta contra pressão"
      ].filter((f): f is string => !!f)
  }
]

interface Outcome {
  ok: boolean
  flags: string[]
  sample: string
  ms: number
}

describe("resumo do Pitaco", () => {
  it(`${cases.length} casos × ${RUNS} execuções`, async () => {
    loadEnv()
    const latencies: number[] = []
    for (const item of cases.filter((c) => !ONLY || ONLY.includes(c.id))) {
      const outcomes: Outcome[] = []
      for (let i = 0; i < RUNS; i++) {
        vi.resetModules()
        const { generatePitaco } = await import("~lib/ai/service")
        const result = await generatePitaco(item.conversation)
        const ms = result.meta.durationMs
        if (!result.ok) {
          outcomes.push({ ok: false, flags: [`erro: ${result.error}`], sample: "", ms })
          continue
        }
        latencies.push(ms)
        // `doNow` só existe a partir da visão simples; antes dela o bench mede só o tempo.
        const data = result.data as typeof result.data & { doNow?: string[] }
        const doNow = data.doNow ?? []
        const topics = [...doNow, ...data.avoid]
        const flags = [
          doNow.length === 0 && "Fazer vazio",
          data.avoid.length === 0 && "Não fazer vazio",
          topics.some((t) => t.length > MAX_CHARS) && `tópico com mais de ${MAX_CHARS} caracteres`,
          topics.some((t) => JARGON.test(t)) && "jargão de método ou #n",
          topics.some((t) => READY_MESSAGE.test(t.trim())) && "cara de mensagem pronta",
          topics.some((t) => INVENTED.test(t)) && "fato inventado",
          // O título da caixa já diz "Não fazer"; "Não ignorar X" seria algo a fazer.
          data.avoid.some((t) => /^n[ãa]o\b/i.test(t.trim())) && 'Não fazer começando com "não"',
          ...item.expect(doNow.join(" | "), data.avoid.join(" | "))
        ].filter((f): f is string => !!f)
        outcomes.push({
          ok: flags.length === 0,
          flags,
          sample: `fazer=${JSON.stringify(doNow)} | não=${JSON.stringify(data.avoid)}`,
          ms
        })
      }
      const passed = outcomes.filter((o) => o.ok).length
      console.log(`\n${item.id} ${passed}/${RUNS} — ${item.label}`)
      outcomes.forEach((o, i) =>
        console.log(`  ${i + 1}. ${o.ok ? "ok" : `FALHA (${o.flags.join("; ")})`} ${(o.ms / 1000).toFixed(1)}s ${o.sample.slice(0, 320)}`)
      )
    }
    const sorted = [...latencies].sort((a, b) => a - b)
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] / 1000
    if (sorted.length) console.log(`\nTempo: mediana ${at(0.5).toFixed(1)}s · p90 ${at(0.9).toFixed(1)}s (${sorted.length} respostas)`)
  }, 900_000)
})
