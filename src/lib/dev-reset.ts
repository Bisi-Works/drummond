import { localArea } from "~lib/chrome-storage"
import { WIDGET_POSITION_KEY } from "~lib/tracking/constants"

// Limpeza do que a extensão guardou no `chrome.storage.local`, só para o desenvolvimento: o botão
// que chama isto só existe em `pnpm dev` (`config.showCosts`). Em produção apagar a cota diária do
// relatório deixaria o vendedor gerar de novo, então nada aqui é exposto fora do dev.

/** Tudo o que a extensão grava com o namespace `drummond.`, menos o que não é dado do dia. */
const PRESERVED_KEYS = new Set([WIDGET_POSITION_KEY])
const NAMESPACE = "drummond."

/**
 * Apaga os logs de todos os dias, os relatórios gerados e a trava diária. Preserva a posição do
 * widget e o tema (`theme`), que não são dados de tracking. Devolve quantas chaves foram apagadas;
 * `null` quando não há storage ou a limpeza falhou — quem chama não deve mostrar sucesso nesse caso.
 */
export const clearSavedData = async (): Promise<number | null> => {
  const area = localArea()
  if (!area) return null
  try {
    const all = await area.get(null)
    const keys = Object.keys(all ?? {}).filter(
      (key) => key.startsWith(NAMESPACE) && !PRESERVED_KEYS.has(key)
    )
    if (keys.length > 0) await area.remove(keys)
    return keys.length
  } catch {
    return null
  }
}
