// Acesso defensivo ao `chrome.storage`. Quando a extensão é recarregada com a página aberta, o
// content script perde o storage (ou o objeto `chrome` deixa de existir por completo): ler
// `chrome.storage.local` sem guarda lançaria uma exceção síncrona dentro de um efeito React e
// quebraria a página. As duas funções abaixo centralizam esse fallback silencioso — quem chama
// trata `null` como "sem storage" e segue em memória (tracking, relatório e tema).

/** `chrome.storage.local` quando existe; `null` quando não há extensão/storage disponível. */
export const localArea = (): chrome.storage.LocalStorageArea | null => {
  try {
    return typeof chrome !== "undefined" ? (chrome.storage?.local ?? null) : null
  } catch {
    return null
  }
}

/** Área de eventos `chrome.storage.onChanged`; `null` quando o storage não está disponível. */
export const storageChanges = (): typeof chrome.storage.onChanged | null => {
  try {
    return typeof chrome !== "undefined" ? (chrome.storage?.onChanged ?? null) : null
  } catch {
    return null
  }
}
