// Namespace das transcrições no `chrome.storage.local`. A versão fica no prefixo para uma mudança
// de formato poder conviver com o cache antigo durante a transição.
export const TRANSCRIPT_PREFIX = "drummond.transcript.v1."

/** Retenção padrão: transcrição é dado sensível; não precisa viver para sempre no navegador. */
export const TRANSCRIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000
