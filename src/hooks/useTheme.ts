import { useCallback, useEffect, useState } from "react"

import { localArea, storageChanges } from "~lib/chrome-storage"
import { DEFAULT_THEME, THEME_STORAGE_KEY, toTheme, type Theme } from "~lib/theme"

/**
 * Tema salvo e como trocá-lo. Acompanha trocas feitas em outra parte da extensão: mudar no painel
 * lateral atualiza na hora o card de revisão aberto no Botconversa. Todo acesso ao storage é
 * defensivo (`localArea`/`storageChanges`): com a extensão recarregada e a página aberta, o
 * `chrome.storage` some e sem a guarda o efeito lançaria e quebraria a página — aqui ele só fica
 * no tema padrão.
 */
export const useTheme = () => {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME)

  useEffect(() => {
    let alive = true
    const area = localArea()
    if (area) {
      area
        .get(THEME_STORAGE_KEY)
        .then((items) => {
          if (alive) setThemeState(toTheme(items?.[THEME_STORAGE_KEY]))
        })
        .catch(() => {}) // sem storage: fica o padrão
    }
    const changes = storageChanges()
    if (!changes) {
      return () => {
        alive = false
      }
    }
    const onChanged = (items: Record<string, chrome.storage.StorageChange>, changedArea: string) => {
      if (changedArea === "local" && THEME_STORAGE_KEY in items) {
        setThemeState(toTheme(items[THEME_STORAGE_KEY].newValue))
      }
    }
    changes.addListener(onChanged)
    return () => {
      alive = false
      changes.removeListener(onChanged)
    }
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    void localArea()
      ?.set({ [THEME_STORAGE_KEY]: next })
      .catch(() => {})
  }, [])

  return { theme, setTheme }
}
