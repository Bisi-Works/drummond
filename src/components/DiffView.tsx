import { useMemo } from "react"

import { diffWords } from "~lib/word-diff"

/** Mostra o texto sugerido com as remoções riscadas e as inclusões destacadas. */
export const DiffView = ({ original, suggested }: { original: string; suggested: string }) => {
  const parts = useMemo(() => diffWords(original, suggested), [original, suggested])

  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">
      {parts.map((part, index) =>
        part.added ? (
          <ins key={index} className="rounded bg-emerald-100 px-0.5 text-emerald-900 no-underline dark:bg-emerald-400/20 dark:text-emerald-100">
            {part.value}
          </ins>
        ) : part.removed ? (
          <del key={index} className="rounded bg-rose-50 px-0.5 text-rose-700 line-through dark:bg-rose-500/15 dark:text-rose-300">
            {part.value}
          </del>
        ) : (
          <span key={index}>{part.value}</span>
        )
      )}
    </p>
  )
}
