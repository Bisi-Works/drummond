import type { PlasmoMessaging } from "@plasmohq/messaging"

import type { ChatMessage } from "~adapters/types"
import type { ReviewContext } from "~lib/ai/prompts"
import { reviewDraft, type AiResult } from "~lib/ai/service"
import type { DraftReview } from "~lib/ai/schemas"

export interface ReviewDraftRequest extends ReviewContext {
  conversation: ChatMessage[]
  draft: string
}

export type ReviewDraftResponse = AiResult<DraftReview>

const handler: PlasmoMessaging.MessageHandler<ReviewDraftRequest, ReviewDraftResponse> = async (
  req,
  res
) => {
  const { conversation = [], draft = "", platform, contactName } = req.body ?? {}
  res.send(await reviewDraft(conversation, draft, { platform, contactName }))
}

export default handler
