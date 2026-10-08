import type { GenerateReportResponse } from "~lib/messages"
import type { DailyReportInput } from "~lib/tracking/report"

import { canGenerateReport, loadReport, markReportGenerated, saveReport } from "./storage"

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

/**
 * Desfecho do commit do relatório gerado, na ordem em que o widget trata cada caso:
 * - `ai-failed`: a IA recusou/errou — nada é gravado e a cota do dia não é consumida, liberando
 *   uma nova tentativa.
 * - `save-failed`: a IA respondeu bem, mas o `chrome.storage` não gravou (extensão recarregada).
 *   Também não marca a cota: não há relatório guardado para reabrir.
 * - `stored`: relatório gravado e cota do dia consumida, com o instante usado como `generatedAt`.
 */
export type CommitReportResult =
  | { status: "stored"; generatedAt: number }
  | { status: "ai-failed"; error: string }
  | { status: "save-failed" }

/**
 * Grava o relatório e marca a cota diária, mas **só depois** de um `ok: true` da IA e de uma
 * gravação bem-sucedida. A ordem importa: `markReportGenerated` é a última etapa, então falha da
 * IA ou do storage não consome a única geração do dia. Fica aqui (e não no componente) para o
 * invariante ser testável sem React, como o `loadReportGate`.
 */
export const commitGeneratedReport = async (
  input: DailyReportInput,
  response: GenerateReportResponse,
  now: number = Date.now()
): Promise<CommitReportResult> => {
  if (!response.ok) return { status: "ai-failed", error: response.error }
  const generatedAt = now
  const saved = await saveReport(input.date, {
    date: input.date,
    generatedAt,
    model: response.meta.model,
    promptVersion: response.meta.promptVersion,
    report: response.data,
    input,
    // Só existe no dev (`config.showCosts`); a página só renderiza o painel quando ele está lá.
    cost: response.meta.cost
  })
  if (!saved) return { status: "save-failed" }
  await markReportGenerated(input.date, generatedAt)
  return { status: "stored", generatedAt }
}
