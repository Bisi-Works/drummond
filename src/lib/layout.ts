// Contas de layout puras, testáveis sem navegador.

/**
 * Quantos itens de uma fila (larguras em px, na ordem) cabem em `available`, com `gap` entre eles.
 * Quando nem todos cabem, reserva `overflowWidth` (mais um `gap`) para o botão "+N" que leva o resto.
 */
export const fitCount = (widths: number[], available: number, gap: number, overflowWidth: number): number => {
  const used = (n: number) => widths.slice(0, n).reduce((sum, w) => sum + w, 0) + gap * Math.max(0, n - 1)
  if (used(widths.length) <= available) return widths.length
  for (let n = widths.length - 1; n > 0; n--) {
    if (used(n) + gap + overflowWidth <= available) return n
  }
  return 0
}

/** Abaixo disso o chat fica estreito demais para ler e escrever: o drawer volta a sobrepor a página. */
export const MIN_CHAT_WIDTH = 400

/**
 * Se o drawer deve empurrar a página (em vez de sobrepô-la). Antes de empurrar, o chat precisa
 * continuar com `MIN_CHAT_WIDTH` depois de perder a largura do drawer; já empurrado, basta o chat
 * atual ter esse mínimo. Assim a decisão não oscila quando o próprio empurrão estreita o chat.
 */
export const shouldPushPage = (chatWidth: number, pushed: boolean, drawerWidth: number): boolean =>
  pushed ? chatWidth >= MIN_CHAT_WIDTH : chatWidth - drawerWidth >= MIN_CHAT_WIDTH
