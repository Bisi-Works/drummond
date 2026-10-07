import type { AiMeta } from "~lib/ai/service"

/** Rodapé com modelo, versão do prompt e tempo — ajuda a comparar builds com modelos diferentes. */
export const MetaFooter = ({ meta }: { meta: AiMeta }) => (
  <p className="truncate text-[11px] text-fg-subtle" title={meta.model}>
    {meta.model} · prompt {meta.promptVersion} · {(meta.durationMs / 1000).toFixed(1)}s
  </p>
)
