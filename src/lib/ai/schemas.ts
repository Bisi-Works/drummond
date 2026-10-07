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
  MAX_STRENGTHS,
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

export type DraftReview = z.infer<typeof draftReviewSchema>
export type CoachingReport = z.infer<typeof coachingReportSchema>
export type BantItem = z.infer<typeof bantItemSchema>

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
