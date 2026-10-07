import type { z } from "zod"

export class ParseError extends Error {
  constructor(
    message: string,
    readonly raw: string
  ) {
    super(message)
    this.name = "ParseError"
  }
}

// Alguns modelos ignoram `response_format` e devolvem o JSON dentro de ```json ... ``` ou com texto
// em volta. Extraímos o primeiro objeto JSON balanceado, respeitando strings e escapes.
export const extractJsonObject = (raw: string): string | null => {
  const text = raw.replace(/```(?:json)?/gi, "")
  const start = text.indexOf("{")
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{") depth++
    else if (char === "}" && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}

export const parseModelJson = <T>(raw: string, schema: z.ZodType<T>): T => {
  const json = extractJsonObject(raw)
  if (!json) throw new ParseError("A IA não retornou um JSON.", raw)

  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new ParseError("A IA retornou um JSON inválido.", raw)
  }

  const result = schema.safeParse(data)
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".") || "(raiz)").join(", ")
    throw new ParseError(`A resposta da IA veio fora do formato esperado (${fields}).`, raw)
  }
  return result.data
}
