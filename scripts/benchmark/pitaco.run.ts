import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, it, vi } from "vitest"

import type { ChatMessage } from "~adapters/types"

// Mede o resumo do Pitaco: conselhos de Fazer / Não fazer (com o porquê, sem jargão de método nem
// #n, sem mensagem pronta e sem fato inventado) e as sugestões de resposta (sem fato inventado nem
// marcador), e se eles refletem o SPIN e o BANT da conversa. Também mede o tempo de resposta.
// Conversas inventadas.
//
// Rodar:  pnpm bench:pitaco --disableConsoleIntercept   (4 casos × BENCH_RUNS execuções; ~US$ 0,02 com 5)
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
const READY_MESSAGE = /^(ol[áa]|oi|bom dia|boa tarde)\b|^(Marcos|Carla|Rafael),/i
// Fatos que o modelo não conhece: valores, percentuais, prazos e descontos.
const INVENTED = /R\$\s*\d|\d+\s*%|\d+\s*(meses|dias|parcelas)|desconto de/i
// Ordem seca ("Perguntar…", "Entender…") em vez de conselho ("Tente entender…").
const INFINITIVE = /^[A-ZÀ-Ú][a-zà-ú]+(ar|er|ir)\b/
const MAX_CHARS = 240
const MAX_REPLY_CHARS = 500

const words = (text: string) => text.trim().split(/\s+/).length

type Expect = (doNow: string, avoid: string, replies: string) => (string | false)[]

const cases: { id: string; label: string; conversation: ChatMessage[]; expect: Expect }[] = [
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
    expect: (doNow, avoid, replies) => [
      !/pre[çc]o|parcela|valor/i.test(doNow) && "Fazer não acolhe a pergunta da parcela",
      !/parcela|valor/i.test(replies) && "sugestões não acolhem a pergunta da parcela",
      // "Mandar a tabela antes de entender o uso" é aceitável; "Responder a parcela" no Não fazer, não.
      avoid
        .split(" | ")
        .some(
          (item) =>
            /\b(responder|informar|passar|falar)\b.{0,25}(pre[çc]o|parcela|valor)/i.test(item) &&
            !/antes|sem (entender|saber)|ignor|deixar sem/i.test(item)
        ) && "Não fazer manda deixar a parcela sem resposta"
    ]
  },
  {
    id: "P2",
    label: "Só a saudação: a descoberta ainda não começou",
    conversation: [
      msg(1, "vendedor", "Olá, Carla! Aqui é a Ana, da BW. Vi que você se interessou pelo nosso plano. Como posso ajudar?"),
      msg(2, "cliente", "Oi! Tudo bem?")
    ],
    expect: (doNow, _avoid, replies) => [
      !/entend|pergunt|descobr|saber|conhecer/i.test(doNow) && "Fazer não orienta a descoberta",
      !/\?/.test(replies) && "nenhuma sugestão faz pergunta para abrir a descoberta"
    ]
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
    expect: (doNow, _avoid, replies) => [
      !/s[óo]cia|paula|decis|decide/i.test(doNow) && "Fazer ignora quem decide (autoridade)",
      !/s[óo]cia|paula|decis|decide/i.test(replies) && "nenhuma sugestão envolve quem decide"
    ]
  },
  {
    id: "P4",
    label: "Objeção de preço depois da proposta",
    conversation: [
      msg(1, "cliente", "Recebi a proposta do plano anual."),
      msg(2, "vendedor", "Que bom! Ficou alguma dúvida?"),
      msg(3, "cliente", "Achei caro. Vou pensar e te falo.")
    ],
    expect: (doNow, avoid, replies) => [
      !/entend|motivo|pesa|o que (achou|considera)|acolh|ouvir/i.test(doNow) && "Fazer não busca entender a objeção",
      !/press|urg|insist|desconto|cobrar/i.test(avoid) && "Não fazer não alerta contra pressão",
      /desconto|condi[çc][ãa]o especial|\bs[óo] (hoje|at[ée])\b|[úu]ltima chance/i.test(replies) &&
        "sugestão pressiona ou oferece desconto"
    ]
  },
  {
    id: "P5",
    label: "Vendedor falou por último e o cliente ainda não respondeu",
    conversation: [
      msg(1, "vendedor", "Sergio, conseguiu dar uma olhada na simulação que te mandei?"),
      msg(2, "cliente", "Vi sim. Mas agora não."),
      msg(3, "vendedor", "Sem problemas, Sergio! Só pra eu entender melhor: você tem algum prazo em mente para trocar de carro?")
    ],
    expect: (doNow, _avoid, replies) => [
      !/aguard|esper|d[êe] tempo|retom|sem resposta|responder/i.test(doNow.split(" | ")[0]) &&
        "o primeiro conselho não considera que a bola está com o cliente",
      /\bprazo\b/i.test(replies) && "sugestão repete a pergunta do prazo",
      /^sem problemas?\b/i.test(replies) && "sugestão responde de novo ao 'agora não'"
    ]
  },
  {
    id: "P6",
    label: "O mesmo, numa conversa longa com bot, PDF e áudio (como a do Sergio no app)",
    conversation: [
      msg(1, "bot", "Olá! Bem-vindo à Stellantis Consórcios. Você já sabe o valor do carro que pretende comprar?"),
      msg(2, "cliente", "Preciso de ajuda"),
      msg(3, "bot", "Qual é o valor máximo que você planeja investir por mês? (Exemplo: R$ 600,00)"),
      msg(4, "cliente", "Sim"),
      msg(5, "bot", "Perfeito, Sergio! Em breve, um dos nossos especialistas entrará em contato com você!"),
      msg(6, "sistema", "Bot parado"),
      msg(7, "vendedor", "Sergio, dá uma olhada especial nas condições que destaquei no PDF. A parcela ficou dentro do que você planejava?"),
      msg(8, "vendedor", "[arquivo: orcamento-477262.pdf]"),
      msg(9, "cliente", "Ok"),
      msg(10, "vendedor", "Sergio, ficou alguma dúvida?"),
      msg(11, "cliente", "Não"),
      {
        id: 12,
        author: "vendedor",
        text: "[áudio]",
        audio: true,
        transcript: "Sergio, só reforçando: essa condição é a que a gente conversou, sem juros, e eu consigo seguir com você hoje mesmo."
      },
      msg(13, "vendedor", "Sergio, tentei te ligar somente para agilizar esse processo para o senhor. Podemos seguir por aqui?"),
      msg(14, "vendedor", "Sergio, gostaria de prosseguir com os próximos passos?"),
      msg(15, "cliente", "Não agora não"),
      msg(16, "vendedor", "Sem problemas, Sergio! Só pra eu entender melhor: você tem algum prazo em mente para fechar?")
    ],
    expect: (doNow, _avoid, replies) => [
      !/aguard|esper|d[êe] tempo|retom|sem resposta|responder/i.test(doNow.split(" | ")[0]) &&
        "o primeiro conselho não considera que a bola está com o cliente",
      /^(Responda|Acolha) .{0,30}(n[ãa]o agora|adiamento)/i.test(doNow.split(" | ")[0]) &&
        "o primeiro conselho manda responder de novo ao 'agora não'",
      /^sem problemas?\b/i.test(replies) && "sugestão responde de novo ao 'agora não'"
    ]
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
        const { doNow, avoid, replies } = result.data
        const topics = [...doNow, ...avoid]
        const flags = [
          doNow.length === 0 && "Fazer vazio",
          avoid.length === 0 && "Não fazer vazio",
          topics.some((t) => t.length > MAX_CHARS) && `conselho com mais de ${MAX_CHARS} caracteres`,
          topics.filter((t) => INFINITIVE.test(t.trim())).length > topics.length / 2 &&
            "conselhos em forma de ordem (infinitivo)",
          topics.filter((t) => words(t) < 8).length > topics.length / 2 && "conselhos curtos demais, sem o porquê",
          topics.some((t) => JARGON.test(t)) && "jargão de método ou #n",
          topics.some((t) => READY_MESSAGE.test(t.trim())) && "conselho com cara de mensagem pronta",
          topics.some((t) => INVENTED.test(t)) && "fato inventado no conselho",
          // O título da caixa já diz "Não fazer"; "Não ignorar X" seria algo a fazer.
          avoid.some((t) => /^n[ãa]o\b/i.test(t.trim())) && 'Não fazer começando com "não"',
          replies.length === 0 && "sem sugestões de resposta",
          replies.some((r) => r.length > MAX_REPLY_CHARS) && "sugestão longa demais",
          replies.some((r) => /\[[^\]]*\]/.test(r)) && "sugestão com marcador",
          replies.some((r) => INVENTED.test(r)) && "sugestão com fato inventado",
          replies.some((r) => JARGON.test(r)) && "sugestão com jargão",
          ...item.expect(doNow.join(" | "), avoid.join(" | "), replies.join(" | "))
        ].filter((f): f is string => !!f)
        outcomes.push({
          ok: flags.length === 0,
          flags,
          sample: [`fazer=${JSON.stringify(doNow)}`, `não=${JSON.stringify(avoid)}`, `respostas=${JSON.stringify(replies)}`].join(
            "\n     "
          ),
          ms
        })
      }
      const passed = outcomes.filter((o) => o.ok).length
      console.log(`\n${item.id} ${passed}/${RUNS} — ${item.label}`)
      outcomes.forEach((o, i) =>
        console.log(`  ${i + 1}. ${o.ok ? "ok" : `FALHA (${o.flags.join("; ")})`} ${(o.ms / 1000).toFixed(1)}s\n     ${o.sample}`)
      )
    }
    const sorted = [...latencies].sort((a, b) => a - b)
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] / 1000
    if (sorted.length) console.log(`\nTempo: mediana ${at(0.5).toFixed(1)}s · p90 ${at(0.9).toFixed(1)}s (${sorted.length} respostas)`)
  }, 900_000)
})
