import type { ReviewDraftResponse } from "~background/messages/review-draft"
import { CHANGE_LABEL } from "~lib/labels"

import { Wordmark } from "./Brand"
import { DiffView } from "./DiffView"
import { MetaFooter } from "./MetaFooter"
import { Spinner } from "./Spinner"

export type ReviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; draft: string; response: ReviewDraftResponse }

interface Props {
  state: Exclude<ReviewState, { kind: "idle" }>
  currentDraft: string
  /** Mensagem quando o "Aplicar" não conseguiu inserir o texto no campo. */
  applyError?: string | null
  onApply: (text: string) => void
  onCopy: (text: string) => void
  onRetry: () => void
  onDismiss: () => void
}

const buttonBase =
  "rounded-md px-3 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-surface"

export const SuggestionCard = ({
  state,
  currentDraft,
  applyError,
  onApply,
  onCopy,
  onRetry,
  onDismiss
}: Props) => (
  <div
    role="dialog"
    aria-label="Sugestão do Drummond by BW"
    className="flex max-h-[60vh] flex-col overflow-hidden rounded-xl border border-black bg-surface font-sans text-fg shadow-2xl">
    <header className="flex items-center justify-between border-b border-line bg-black py-2 pl-4 pr-2">
      <Wordmark />
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fechar"
        className="rounded p-1.5 leading-none text-gray-400 hover:bg-white/10 hover:text-white">
        ✕
      </button>
    </header>

    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
      {state.kind === "loading" ? (
        <div className="flex items-center gap-2 py-4 text-sm text-fg-muted">
          <Spinner /> Revisando a mensagem…
        </div>
      ) : (
        <ReviewBody
          draft={state.draft}
          currentDraft={currentDraft}
          applyError={applyError}
          response={state.response}
          onApply={onApply}
          onCopy={onCopy}
          onRetry={onRetry}
        />
      )}
    </div>
  </div>
)

const ReviewBody = ({
  draft,
  currentDraft,
  applyError,
  response,
  onApply,
  onCopy,
  onRetry
}: {
  draft: string
  currentDraft: string
  applyError?: string | null
  response: ReviewDraftResponse
  onApply: (text: string) => void
  onCopy: (text: string) => void
  onRetry: () => void
}) => {
  if (!response.ok) {
    return (
      <>
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-500/15 dark:text-rose-200">{response.error}</p>
        <div className="flex justify-end">
          <button type="button" onClick={onRetry} className={`${buttonBase} bg-fg text-surface hover:opacity-90`}>
            Tentar novamente
          </button>
        </div>
      </>
    )
  }

  const review = response.data
  const draftChanged = currentDraft.trim() !== draft.trim()

  return (
    <>
      {review.status === "ok" ? (
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <span aria-hidden="true">✓</span> Mensagem pronta para envio.
        </p>
      ) : (
        <DiffView original={draft} suggested={review.suggestedText} />
      )}

      {review.warnings.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-400/30 dark:bg-amber-400/10">
          <p className="mb-1 text-xs font-semibold text-amber-900 dark:text-amber-200">Confira antes de enviar</p>
          <ul className="list-disc space-y-0.5 pl-4 text-sm text-amber-900 dark:text-amber-100">
            {review.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {review.changes.length > 0 && (
        <ul className="space-y-1.5">
          {review.changes.map((change, i) => (
            <li key={i} className="text-xs text-fg-muted">
              <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 font-medium text-fg">
                {CHANGE_LABEL[change.category]}
              </span>
              {change.reason}
            </li>
          ))}
        </ul>
      )}

      {draftChanged && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-fg-muted">
          Você editou o rascunho depois da revisão. Aplicar vai substituir o texto atual.
        </p>
      )}

      {applyError && (
        <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:bg-rose-500/15 dark:text-rose-200">
          {applyError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {draftChanged && (
          <button type="button" onClick={onRetry} className={`${buttonBase} text-fg-muted hover:bg-muted`}>
            Revisar de novo
          </button>
        )}
        {review.status === "ajustes" && (
          <>
            <button
              type="button"
              onClick={() => onCopy(review.suggestedText)}
              className={`${buttonBase} border border-line-strong text-fg hover:bg-muted`}>
              Copiar
            </button>
            <button
              type="button"
              onClick={() => onApply(review.suggestedText)}
              className={`${buttonBase} bg-brand text-white hover:bg-brand-dark`}>
              Aplicar
            </button>
          </>
        )}
      </div>

      <MetaFooter meta={response.meta} />
    </>
  )
}
