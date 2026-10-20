// Namespace import de propósito: com `import { z } from "zod"` o Parcel do Plasmo descarta o código
// do zod na build de produção (o `z` do zod 4 é um alias de namespace + `sideEffects: false`), e o
// service worker quebra ao carregar. `pnpm check:bundle` executa a build para pegar isso.
import * as z from "zod"

import type { ResponseFormatMode } from "~lib/config"

import {
  bantStatuses,
  changeCategories,
  coachingCategories,
  impactLevels,
  MAX_CHANGES,
  MAX_IMPROVEMENTS,
  MAX_REPORT_ITEMS,
  MAX_PITACO_AVOID,
  MAX_PITACO_DO,
  MAX_PITACO_PATH,
  MAX_PITACO_POINTS,
  MAX_PITACO_QUESTIONS,
  MAX_PITACO_WARNINGS,
  MAX_STRENGTHS,
  pitacoPointKinds,
  pitacoStages,
  spinStages,
  spinStatuses,
  type ImpactLevel
} from "./constants"

// Os schemas servem para dois fins: gerar o JSON Schema enviado em `response_format` e validar a
// resposta. Por isso evitamos restrições (.max, .int, .min) que viram `maxItems`/`minimum` no JSON
// Schema — vários provedores rejeitam essas palavras-chave em modo strict. Limites de tamanho são
// pedidos no prompt e aplicados depois do parse (ver `limitReview`/`limitCoaching`).

// `warnings` antes de `suggestedText`: o modelo gera na ordem do schema, e anotar primeiro a
// pergunta do cliente sem resposta evita que ele a responda por conta própria no texto sugerido.
export const draftReviewSchema = z.object({
  status: z
    .enum(["ok", "ajustes"])
    .describe('"ok" quando não há nada relevante a mudar; "ajustes" caso contrário.'),
  warnings: z
    .array(z.string())
    .describe(
      "Pontos que o vendedor deve checar e que NÃO foram alterados, como pergunta do cliente sem resposta ou valor diferente do informado antes. Vazio se não houver."
    ),
  suggestedText: z
    .string()
    .describe(
      "Rascunho completo revisado e melhorado, pronto para envio. Igual ao original se status = ok. Pode reescrever e agregar frases de clareza, tom e fechamento, mas nunca fatos novos: respostas, informações, valores, prazos ou promessas que o vendedor não deu."
    ),
  changes: z
    .array(
      z.object({
        category: z.enum(changeCategories),
        excerpt: z.string().describe("Trecho alterado, como ficou no texto sugerido."),
        reason: z.string().describe("Por que mudou, em até 20 palavras.")
      })
    )
    .describe(`Até ${MAX_CHANGES} alterações mais relevantes. Vazio se status = ok.`)
})

const bantItemSchema = z.object({
  status: z
    .enum(bantStatuses)
    .describe('"cumprido", "parcial" (abordado de forma vaga ou sem confirmação) ou "pendente".'),
  evidence: z
    .string()
    .describe("O que a conversa mostra sobre o critério, citando #n. Se não foi abordado, diga isso."),
  question: z
    .string()
    .describe('Pergunta pronta para o vendedor fazer ao cliente. Vazia ("") se status = cumprido.')
})

export const coachingReportSchema = z.object({
  summary: z.string().describe("1–2 frases sobre como a conversa está sendo conduzida."),
  strengths: z
    .array(z.string())
    .describe(`1 a ${MAX_STRENGTHS} pontos fortes reais e específicos do vendedor.`),
  improvements: z
    .array(
      z.object({
        messageId: z.number().describe("Número [n] da mensagem do vendedor analisada."),
        excerpt: z.string().describe("Trecho original do vendedor."),
        issue: z.string().describe("O problema, de forma objetiva."),
        suggestion: z.string().describe("Reescrita pronta do trecho, para copiar e usar."),
        category: z.enum(coachingCategories),
        impact: z.enum(impactLevels)
      })
    )
    .describe(`Até ${MAX_IMPROVEMENTS} melhorias, ordenadas por impacto.`),
  // Antes de `nextStep`: o modelo gera na ordem do schema, e o próximo passo já considera as
  // lacunas de qualificação.
  bant: z
    .object({
      budget: bantItemSchema,
      authority: bantItemSchema,
      need: bantItemSchema,
      timing: bantItemSchema
    })
    .describe("Checklist BANT: se o vendedor qualificou o lead em cada critério."),
  nextStep: z
    .string()
    .describe("O que o vendedor deveria fazer ou escrever a seguir, de forma concreta.")
})

// Relatório individual do dia: uma chamada de IA sobre o resumo compacto do tracking (nunca a
// conversa completa). As listas são limitadas depois do parse, como em `limitReview`/`limitCoaching`.
export const dailyReportSchema = z.object({
  resumo: z.string().describe("1–2 frases sobre como o dia foi, no conjunto das conversas."),
  acertos: z
    .array(z.string())
    .describe(
      `Até ${MAX_REPORT_ITEMS} acertos concretos do vendedor no dia, citando a conversa quando fizer sentido.`
    ),
  erros: z
    .array(z.string())
    .describe(
      `Até ${MAX_REPORT_ITEMS} erros ou padrões a evitar, sempre a partir do que está nos dados.`
    ),
  melhorias: z
    .array(z.string())
    .describe(`Até ${MAX_REPORT_ITEMS} melhorias práticas para os próximos dias.`),
  pendencias: z
    .array(z.string())
    .describe(
      `Até ${MAX_REPORT_ITEMS} pendências que ficaram em aberto para amanhã, por conversa.`
    )
})

// Pitaco: orientação de condução pelo SPIN, nunca uma mensagem pronta (não existe campo de texto
// para enviar). `evidence` traz os números [n] das mensagens que sustentam o item; o service
// descarta os números que não existem na conversa. As etapas vêm primeiro: o modelo gera na ordem
// do schema e decide a etapa atual e o caminho depois de olhar a evidência de cada uma.
const spinStageSchema = z.object({
  status: z
    .enum(spinStatuses)
    .describe('"coberta" (o cliente já respondeu), "parcial" (apareceu de forma vaga) ou "pendente".'),
  evidence: z
    .string()
    .describe("O que a conversa mostra sobre a etapa, citando #n. Se não foi abordada, diga isso.")
})

// O BANT do Pitaco só alimenta a análise e o modo Avançado: sem pergunta pronta, como no coaching.
const pitacoBantItemSchema = z.object({
  status: z.enum(bantStatuses).describe('"cumprido", "parcial" ou "pendente".'),
  evidence: z
    .string()
    .describe("O que a conversa mostra sobre o critério, citando #n. Se não foi abordado, diga isso.")
})

const evidenceSchema = z
  .array(z.number())
  .describe("Números [n] das mensagens que sustentam o item. Vazio só se a conversa não tem nada sobre ele.")

export const pitacoSchema = z.object({
  stages: z
    .object({
      situacao: spinStageSchema,
      problema: spinStageSchema,
      implicacao: spinStageSchema,
      necessidade: spinStageSchema
    })
    .describe("Status e evidência de cada etapa do SPIN."),
  bant: z
    .object({
      budget: pitacoBantItemSchema,
      authority: pitacoBantItemSchema,
      need: pitacoBantItemSchema,
      timing: pitacoBantItemSchema
    })
    .describe("Qualificação BANT do lead até aqui."),
  stageNow: z
    .enum(pitacoStages)
    .describe('Etapa em que a conversa está agora; "abertura" se a descoberta ainda não começou.'),
  diagnosis: z.string().describe("Leitura da conversa em 1–2 frases: onde está e o que falta."),
  path: z
    .array(z.string())
    .describe(`Até ${MAX_PITACO_PATH} passos sugeridos, em ordem, como ações curtas do vendedor.`),
  points: z
    .array(
      z.object({
        stage: z.enum(spinStages),
        kind: z.enum(pitacoPointKinds),
        title: z.string().describe("O ponto a abordar, em até 8 palavras."),
        why: z.string().describe("Por que abordar agora, ancorado na conversa."),
        hint: z
          .string()
          .describe("Direção de raciocínio em até 20 palavras. Nunca uma frase para enviar ao cliente."),
        evidence: evidenceSchema
      })
    )
    .describe(`Até ${MAX_PITACO_POINTS} pontos a abordar, do mais para o menos importante.`),
  questions: z
    .array(
      z.object({
        stage: z.enum(spinStages),
        text: z.string().describe("Uma pergunta aberta e curta, uma só frase."),
        evidence: evidenceSchema
      })
    )
    .describe(`Até ${MAX_PITACO_QUESTIONS} perguntas abertas que ainda não foram respondidas.`),
  warnings: z
    .array(z.string())
    .describe(`Até ${MAX_PITACO_WARNINGS} fatos a confirmar antes de falar. Vazio se não houver.`),
  // O resumo vem por último: o modelo o escreve depois de toda a análise acima.
  doNow: z
    .array(z.string())
    .describe(`Até ${MAX_PITACO_DO} ações curtas a fazer agora, da mais para a menos urgente.`),
  avoid: z.array(z.string()).describe(`Até ${MAX_PITACO_AVOID} coisas a não fazer agora.`)
})

export type DraftReview = z.infer<typeof draftReviewSchema>
export type CoachingReport = z.infer<typeof coachingReportSchema>
export type BantItem = z.infer<typeof bantItemSchema>
export type DailyReport = z.infer<typeof dailyReportSchema>
export type Pitaco = z.infer<typeof pitacoSchema>
export type PitacoPoint = Pitaco["points"][number]
export type PitacoQuestion = Pitaco["questions"][number]

// Em `json_object` o schema não vai na requisição: o formato fica a cargo do prompt (que descreve o
// JSON esperado) e da validação com zod depois do parse.
export const toResponseFormat = (name: string, schema: z.ZodType, mode: ResponseFormatMode) => {
  if (mode === "json_object") return { type: "json_object" as const }
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema, { target: "draft-7" })
  return {
    type: "json_schema" as const,
    json_schema: { name, strict: true, schema: jsonSchema }
  }
}

export const limitReview = (review: DraftReview): DraftReview => ({
  ...review,
  changes: review.changes.slice(0, MAX_CHANGES)
})

const impactOrder: Record<ImpactLevel, number> = { alto: 0, medio: 1, baixo: 2 }

export const limitCoaching = (report: CoachingReport): CoachingReport => ({
  ...report,
  strengths: report.strengths.slice(0, MAX_STRENGTHS),
  improvements: [...report.improvements]
    .sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact])
    .slice(0, MAX_IMPROVEMENTS)
})

/** Trunca as listas do Pitaco nos limites do drawer, preservando a ordem. */
export const limitPitaco = (pitaco: Pitaco): Pitaco => ({
  ...pitaco,
  path: pitaco.path.slice(0, MAX_PITACO_PATH),
  points: pitaco.points.slice(0, MAX_PITACO_POINTS),
  questions: pitaco.questions.slice(0, MAX_PITACO_QUESTIONS),
  avoid: pitaco.avoid.slice(0, MAX_PITACO_AVOID),
  warnings: pitaco.warnings.slice(0, MAX_PITACO_WARNINGS),
  doNow: pitaco.doNow.slice(0, MAX_PITACO_DO)
})

/** Trunca as quatro listas do relatório diário em `MAX_REPORT_ITEMS`, preservando a ordem. */
export const limitDailyReport = (report: DailyReport): DailyReport => ({
  ...report,
  acertos: report.acertos.slice(0, MAX_REPORT_ITEMS),
  erros: report.erros.slice(0, MAX_REPORT_ITEMS),
  melhorias: report.melhorias.slice(0, MAX_REPORT_ITEMS),
  pendencias: report.pendencias.slice(0, MAX_REPORT_ITEMS)
})
