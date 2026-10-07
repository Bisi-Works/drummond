// Tema da interface (painel de coaching e card de revisão). Fica no chrome.storage para valer nas
// duas partes da extensão e sobreviver a recargas. O padrão é o escuro, como o bisi.works.
export type Theme = "dark" | "light"

export const DEFAULT_THEME: Theme = "dark"
export const THEME_STORAGE_KEY = "theme"

/** Qualquer valor salvo que não seja "light" (inclusive nada salvo) vira o padrão. */
export const toTheme = (value: unknown): Theme => (value === "light" ? "light" : DEFAULT_THEME)
