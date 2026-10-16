import type { PlasmoMessaging } from "@plasmohq/messaging"

import { generateDailyReport } from "~lib/ai/service"
import type { GenerateReportRequest, GenerateReportResponse } from "~lib/messages"

const handler: PlasmoMessaging.MessageHandler<GenerateReportRequest, GenerateReportResponse> =
  async (req, res) => {
    // Mesmo padrão de `review-draft`: o corpo traz o payload compacto do dia e o serviço devolve o
    // envelope `AiResult` já validado. A IA nunca é chamada do content script.
    const { report } = req.body ?? ({} as GenerateReportRequest)
    res.send(await generateDailyReport(report))
  }

export default handler
