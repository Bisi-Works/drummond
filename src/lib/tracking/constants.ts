// Regras fixas do trackeamento do dia. As constantes ficam separadas dos tipos para o content
// script e os testes importarem só o que precisam, sem arrastar o resto do módulo.

/**
 * Limites do semáforo de espera, em ms. Verde abaixo do primeiro limite; vermelho a partir do
 * último, sem teto (a espera cresce indefinidamente).
 */
export const WAIT_LIMITS_MS = {
  amarelo: 6 * 60_000,
  laranja: 12 * 60_000,
  vermelho: 18 * 60_000
} as const

/** Prefixo da chave do dia em `chrome.storage.local` (uma chave por data, ex.: "drummond.dayLog.2026-10-07"). */
export const DAY_LOG_PREFIX = "drummond.dayLog."
