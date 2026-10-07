// Diff por palavras (LCS) para destacar o que a IA mudou no rascunho. Substitui a lib `diff`: o
// SWC antigo do Plasmo corrompe uma string de regex dela na build de produção e o content script
// quebra ao carregar. Para mensagens de chat (centenas de palavras) o O(n·m) é irrelevante.

export interface DiffPart {
  value: string
  added?: boolean
  removed?: boolean
}

// Palavras (inclui acentos), blocos de espaço e cada sinal de pontuação viram tokens separados.
const tokenize = (text: string) => text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? []

export const diffWords = (before: string, after: string): DiffPart[] => {
  const a = tokenize(before)
  const b = tokenize(after)

  // lcs[i][j] = tamanho da maior subsequência comum entre a[i..] e b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const parts: DiffPart[] = []
  const push = (value: string, kind: "added" | "removed" | null) => {
    const last = parts[parts.length - 1]
    const lastKind = last?.added ? "added" : last?.removed ? "removed" : null
    if (last && lastKind === kind) last.value += value
    else parts.push(kind ? { value, [kind]: true } : { value })
  }

  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(a[i], null)
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push(a[i++], "removed")
    } else {
      push(b[j++], "added")
    }
  }
  while (i < a.length) push(a[i++], "removed")
  while (j < b.length) push(b[j++], "added")
  return parts
}
