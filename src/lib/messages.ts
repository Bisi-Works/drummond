import type { ChatMessage } from "~adapters/types"
import type { CoachingReport, DailyReport } from "~lib/ai/schemas"
import type { AiResult } from "~lib/ai/service"
import type { DailyReportInput } from "~lib/tracking/report"

// Mensagem enviada do side panel para o content script da aba ativa. As mensagens para o
// background ficam em src/background/messages (convenção do @plasmohq/messaging).
export const GET_CONVERSATION = "get-conversation"

export interface GetConversationResponse {
  platform: string
  conversationKey: string | null
  conversation: ChatMessage[]
}

// O coaching usa uma conexão (`chrome.runtime.connect`) em vez de uma mensagem: o background
// repassa a resposta do modelo aos pedaços enquanto ela é escrita. Uma conexão por análise: o
// painel envia a conversa, recebe os trechos e o resultado final, e desconecta.
export const COACH_PORT = "coach-conversation"

export interface CoachRequest {
  conversation: ChatMessage[]
}

export type CoachResponse = AiResult<CoachingReport>

export type CoachPortMessage =
  /** Trecho do JSON do relatório, na ordem em que o modelo escreve. */
  | { type: "delta"; text: string }
  /** Resultado final, validado — o mesmo formato da revisão. */
  | { type: "result"; response: CoachResponse }

// O relatório do dia usa uma mensagem simples (como a revisão): o background recebe o resumo
// compacto do tracking e devolve o relatório validado. A IA nunca é chamada do content script.
export const GENERATE_REPORT = "generate-report"

export interface GenerateReportRequest {
  /** Payload compacto do dia (`buildReportInput`) — nunca as conversas completas. */
  report: DailyReportInput
}

export type GenerateReportResponse = AiResult<DailyReport>
