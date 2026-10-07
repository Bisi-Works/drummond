import { useCallback, useEffect, useState } from "react"

import { DEFAULT_THEME, THEME_STORAGE_KEY, toTheme, type Theme } from "~lib/theme"

/**
 * Tema salvo e como trocá-lo. Acompanha trocas feitas em outra parte da extensão: mudar no painel
 * lateral atualiza na hora o card de revisão aberto no Botconversa.
 */
export const useTheme = () => {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME)

  useEffect(() => {
    chrome.storage.local
      .get(THEME_STORAGE_KEY)
      .then((items) => setThemeState(toTheme(items?.[THEME_STORAGE_KEY])))
      .catch(() => {}) // sem storage (extensão recarregada com a página aberta): fica o padrão
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && THEME_STORAGE_KEY in changes) {
        setThemeState(toTheme(changes[THEME_STORAGE_KEY].newValue))
      }
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    chrome.storage.local.set({ [THEME_STORAGE_KEY]: next }).catch(() => {})
  }, [])

  return { theme, setTheme }
}
