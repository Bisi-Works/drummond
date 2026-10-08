export type ChatAuthor = "cliente" | "vendedor" | "bot" | "sistema"

/**
 * Natureza da última mensagem de um chat na inbox: só `message` diz quem está esperando quem.
 * `closing` é o cliente encerrando ("obrigado", 👍): não exige resposta, então não muda o estado.
 */
export type InboxMessageKind = "message" | "note" | "system" | "closing"

/** Um chat da lista da inbox (o que a plataforma mostra sem abrir a conversa). */
export interface InboxChat {
  /** Mesmo valor de `getConversationKey()` quando esse chat está aberto. */
  key: string
  /** Nome do contato. */
  name: string
  /** Horário real da última mensagem (epoch ms). */
  lastMessageAt: number
  /** `true` quando a última mensagem foi enviada pela nossa conta (vendedor, modelo ou bot). */
  lastFromAccount: boolean
  lastKind: InboxMessageKind
  /** Prévia da última mensagem, como a lista a mostra. */
  preview: string
}

/** Uma mensagem de um chat, como a API da plataforma a devolve (sem abrir a conversa). */
export interface InboxMessage {
  /** `true` quando foi enviada pela nossa conta (vendedor, modelo ou bot). */
  fromAccount: boolean
  /** Texto; mídia sem texto vira um marcador como "[documento]". */
  text: string
  /** Horário real (epoch ms). */
  at: number
  kind: InboxMessageKind
}

/**
 * Resultado de listar os chats do vendedor na inbox. `complete` indica que a varredura chegou ao
 * início do dia (ou ao fim da lista): só então a ausência de um chat significa que ele saiu da
 * carteira. Falhas viram um motivo, nunca uma exceção — o tracking segue pelo DOM.
 */
export type InboxResult =
  | { ok: true; chats: InboxChat[]; complete: boolean }
  | { ok: false; reason: "unavailable" | "auth" | "network" | "unexpected" }

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
  /**
   * Nome do contato com quem o vendedor está falando, como o cabeçalho do chat o mostra; `null`
   * quando não há cabeçalho/nome na tela. Atenção: ao trocar de conversa a plataforma pode demorar
   * a atualizar o cabeçalho, então quem consome não deve confiar numa única leitura logo após a
   * troca (ver `confirmContactName`).
   */
  getContactName?(): string | null
  /**
   * Chats do vendedor logado com atividade desde `since` (epoch ms), direto da API da plataforma —
   * sem abrir conversa nenhuma. Opcional: sem ele o tracking só enxerga o chat aberto.
   */
  listMyChats?(since: number): Promise<InboxResult>
  /**
   * Últimas `limit` mensagens de um chat, da mais nova para a mais antiga, direto da API da
   * plataforma; `null` quando não dá para ler. Dá o contexto (a mensagem anterior do vendedor) de
   * conversas que o vendedor não abriu.
   */
  listRecentMessages?(key: string, limit: number): Promise<InboxMessage[] | null>
}
