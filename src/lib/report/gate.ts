import { canGenerateReport, loadReport } from "./storage"

// Estado da trava diária do relatório, na forma que o widget precisa para decidir o botão
// principal. Fica aqui (e não dentro do componente) para ser testável sem React: combina a cota
// (`canGenerateReport`) com a existência de um relatório salvo para reabrir (`loadReport`) em uma
// leitura só, silenciosa quando o `chrome.storage` não está disponível.

export interface ReportGateState {
  /**
   * `true` quando a cota do dia já foi usada (produção, `reportLimitPerDay` atingido) — o botão de
   * gerar fica desabilitado. Em dev/`reportUnlimited` é sempre `false`.
   */
  locked: boolean
  /**
   * `true` quando há um relatório salvo para a data, o que habilita o atalho "Abrir relatório" sem
   * gerar de novo (e o "Gerar novamente" do dev).
   */
  stored: boolean
}

/**
 * Lê a trava e a existência do relatório da data em paralelo. Sem storage, `canGenerateReport`
 * libera e `loadReport` devolve `null`, então o resultado é `{ locked: false, stored: false }`.
 */
export const loadReportGate = async (
  date: string,
  now: number = Date.now()
): Promise<ReportGateState> => {
  const [allowed, stored] = await Promise.all([canGenerateReport(date, now), loadReport(date)])
  return { locked: !allowed, stored: stored !== null }
}
