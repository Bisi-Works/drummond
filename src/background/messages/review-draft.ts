import type { PlasmoMessaging } from "@plasmohq/messaging"

import type { ChatMessage } from "~adapters/types"
import { reviewDraft, type AiResult } from "~lib/ai/service"
import type { DraftReview } from "~lib/ai/schemas"

export interface ReviewDraftRequest {
  conversation: ChatMessage[]
  draft: string
}

export type ReviewDraftResponse = AiResult<DraftReview>

const handler: PlasmoMessaging.MessageHandler<ReviewDraftRequest, ReviewDraftResponse> = async (
  req,
  res
) => {
  const { conversation = [], draft = "" } = req.body ?? {}
  res.send(await reviewDraft(conversation, draft))
}

export default handler
