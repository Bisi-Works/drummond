// Lê um JSON possivelmente incompleto — o começo de uma resposta que ainda está chegando em
// streaming — e devolve o que já dá para mostrar: objetos e listas abertos são fechados, a string
// em andamento vem com o texto recebido até agora, e números, literais e chaves ainda sem valor
// ficam de fora (poderiam mudar: `12` pode virar `123`). Como `extractJsonObject`, ignora o que
// vem antes do primeiro "{" (ex.: ```json). Se encontrar algo fora da gramática, para ali e
// devolve o que já leu. A resposta final continua passando por `parseModelJson` + zod.

/** Sinaliza que o texto acabou no meio de um valor, que então é descartado. */
const END = Symbol("fim do texto")

const ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  b: "\b",
  f: "\f",
  '"': '"',
  "\\": "\\",
  "/": "/"
}

const LITERAL = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/

export const parsePartialJson = (text: string): unknown => {
  let i = text.indexOf("{")
  if (i === -1) return undefined

  // Fora da gramática: trata como fim do texto, e cada nível devolve o que já tinha.
  const stop = () => {
    i = text.length
  }

  const skipWhitespace = () => {
    while (i < text.length && " \t\n\r".includes(text[i])) i++
  }

  const parseString = () => {
    i++ // aspas de abertura
    let value = ""
    while (i < text.length) {
      const char = text[i]
      if (char === '"') {
        i++
        return { value, closed: true }
      }
      if (char === "\\") {
        const next = text[i + 1]
        if (next === undefined) break
        if (next === "u") {
          const hex = text.slice(i + 2, i + 6)
          if (hex.length < 4) break
          value += String.fromCharCode(parseInt(hex, 16))
          i += 6
        } else {
          value += ESCAPES[next] ?? next
          i += 2
        }
        continue
      }
      value += char
      i++
    }
    stop()
    return { value, closed: false }
  }

  const parseLiteral = () => {
    const match = LITERAL.exec(text.slice(i))
    if (!match) {
      stop()
      throw END
    }
    i += match[0].length
    if (i >= text.length) throw END // pode continuar no próximo trecho
    return JSON.parse(match[0]) as unknown
  }

  const parseValue = (): unknown => {
    skipWhitespace()
    if (i >= text.length) throw END
    switch (text[i]) {
      case "{":
        return parseObject()
      case "[":
        return parseArray()
      case '"':
        return parseString().value
      default:
        return parseLiteral()
    }
  }

  const parseObject = () => {
    const result: Record<string, unknown> = {}
    i++ // {
    for (;;) {
      skipWhitespace()
      if (i >= text.length) return result
      const char = text[i]
      if (char === "}") {
        i++
        return result
      }
      if (char === ",") {
        i++
        continue
      }
      if (char !== '"') {
        stop()
        return result
      }
      const key = parseString()
      skipWhitespace()
      if (!key.closed || text[i] !== ":") {
        stop()
        return result
      }
      i++ // :
      try {
        result[key.value] = parseValue()
      } catch (error) {
        if (error === END) return result
        throw error
      }
    }
  }

  const parseArray = () => {
    const result: unknown[] = []
    i++ // [
    for (;;) {
      skipWhitespace()
      if (i >= text.length) return result
      const char = text[i]
      if (char === "]") {
        i++
        return result
      }
      if (char === ",") {
        i++
        continue
      }
      try {
        result.push(parseValue())
      } catch (error) {
        if (error === END) return result
        throw error
      }
    }
  }

  return parseObject()
}
