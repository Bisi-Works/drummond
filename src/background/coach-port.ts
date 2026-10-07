import { coachConversation } from "~lib/ai/service"
import { COACH_PORT, type CoachPortMessage, type CoachRequest } from "~lib/messages"

// Os "ports" do @plasmohq/messaging guardam uma conexão só por nome e não avisam quando ela cai;
// aqui cada análise tem a sua, e fechar o painel no meio cancela a chamada ao modelo.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== COACH_PORT) return

  const controller = new AbortController()
  port.onDisconnect.addListener(() => controller.abort())

  const post = (message: CoachPortMessage) => {
    if (controller.signal.aborted) return
    try {
      port.postMessage(message)
    } catch {
      controller.abort() // o painel fechou entre um trecho e outro
    }
  }

  port.onMessage.addListener(async (request: CoachRequest) => {
    const response = await coachConversation(request?.conversation ?? [], {
      signal: controller.signal,
      onDelta: (text) => post({ type: "delta", text })
    })
    post({ type: "result", response })
  })
})
