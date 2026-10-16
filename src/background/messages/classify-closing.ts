import type { PlasmoMessaging } from "@plasmohq/messaging"

import { classifyClosing } from "~lib/ai/jev"
import type { ClassifyClosingRequest, ClassifyClosingResponse } from "~lib/messages"

const handler: PlasmoMessaging.MessageHandler<ClassifyClosingRequest, ClassifyClosingResponse> =
  async (req, res) => {
    // A IA só é chamada daqui: a chave do OpenRouter fica no background, nunca no content script.
    res.send(await classifyClosing(req.body ?? ({} as ClassifyClosingRequest)))
  }

export default handler
