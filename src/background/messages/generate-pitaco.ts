import type { PlasmoMessaging } from "@plasmohq/messaging"

import { generatePitaco } from "~lib/ai/service"
import type { GeneratePitacoRequest, GeneratePitacoResponse } from "~lib/messages"

const handler: PlasmoMessaging.MessageHandler<
  GeneratePitacoRequest,
  GeneratePitacoResponse
> = async (req, res) => {
  const { conversation = [] } = req.body ?? {}
  res.send(await generatePitaco(conversation))
}

export default handler
