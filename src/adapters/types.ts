export type ChatAuthor = "cliente" | "vendedor" | "bot" | "sistema"

export interface ChatMessage {
  /** Posição na conversa (1..n), usada pela IA para citar mensagens no coaching. */
  id: number
  author: ChatAuthor
  text: string
  /** Horário como exibido na tela (ex.: "10:32"), quando disponível. */
  time?: string
  /** Mensagem de modelo/template (geralmente disparada por automação ou campanha). */
  template?: boolean
}

/**
 * Tudo o que a extensão precisa saber sobre uma plataforma de chat. Cada plataforma (Botconversa,
 * futuramente outras) implementa esta interface e o resto do código não conhece seletores de DOM.
 */
export interface ChatAdapter {
  id: string
  /** Hostnames atendidos (o `matches` do content script precisa listar os mesmos domínios). */
  hosts: string[]
  /** Campo onde o vendedor digita (textarea ou contenteditable). */
  getComposer(): HTMLElement | null
  /** Caixa visual em volta do campo (o card de sugestão abre acima dela). Padrão: o próprio campo. */
  getComposerFrame?(): HTMLElement | null
  /**
   * Elemento da barra do campo logo à DIREITA do qual o botão "Revisar" fica (ex.: o grupo de
   * ícones da esquerda, cujo lado direito costuma estar livre). Sem ele, o botão fica acima do campo.
   */
  getButtonAnchor?(): HTMLElement | null
  readDraft(): string
  /**
   * Substitui o rascunho de forma que o editor/framework da página perceba a mudança.
   * Retorna se o texto realmente ficou no campo.
   */
  writeDraft(text: string): Promise<boolean>
  /** Últimas `limit` mensagens da conversa aberta, em ordem cronológica. */
  readConversation(limit: number): ChatMessage[]
  /** Identifica a conversa aberta, para descartar sugestões ao trocar de conversa. */
  getConversationKey(): string | null
}
