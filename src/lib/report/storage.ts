import type { DailyReport } from "~lib/ai/schemas"
import type { DailyReportInput } from "~lib/tracking/report"

// Persistência do relatório do dia em `chrome.storage.local`. Cada relatório fica na sua própria
// chave (uma por data) e um ponteiro `latest` guarda qual foi o último gerado, para a página abrir
// sem `?date=` no `location.search`. Segue o mesmo contrato de `src/lib/tracking/store.ts`: leitura
// e gravação são silenciosas quando o `chrome.storage` não existe (extensão recarregada com a
// página aberta) e todo dado lido é normalizado antes de sair daqui.

/** Uma chave por data (ex.: "drummond.report.2026-10-07"). */
export const REPORT_STORAGE_PREFIX = "drummond.report."

/** Ponteiro para o último relatório gerado: `{ date, generatedAt }`. */
export const REPORT_LATEST_KEY = "drummond.report.latest"

/**
 * Relatório guardado no storage. Além do texto gerado pela IA, guarda o `input` que o originou —
 * assim a página do relatório pode remontar as métricas do dia sem uma nova chamada ao modelo — e
 * o `model`/`promptVersion` do rodapé, para comparar resultados entre versões.
 */
export interface StoredReport {
  /** Data local YYYY-MM-DD do dia relatado (mesma de `DailyReportInput`). */
  date: string
  /** Quando o relatório foi gerado (epoch ms). */
  generatedAt: number
  /** Modelo que gerou o relatório (ex.: "deepseek/deepseek-v4-flash-0731"). */
  model: string
  /** Versão do prompt usada na geração (ver `PROMPT_VERSION`). */
  promptVersion: string
  report: DailyReport
  /** Payload compacto enviado à IA, com as métricas do dia (totais e conversas). */
  input: DailyReportInput
}

/** Ponteiro do último relatório, o que basta para a página achar a data sem carregar tudo. */
export interface ReportRef {
  date: string
  generatedAt: number
}

/** `chrome.storage.local` quando existe; `null` quando não há extensão/storage disponível. */
const localArea = (): chrome.storage.LocalStorageArea | null => {
  try {
    return typeof chrome !== "undefined" ? (chrome.storage?.local ?? null) : null
  } catch {
    return null
  }
}

/** Chave completa de um relatório a partir da data. */
const reportKey = (date: string): string => `${REPORT_STORAGE_PREFIX}${date}`

/** Data YYYY-MM-DD válida (o `listReportDates` ignora qualquer chave fora desse formato). */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0

/** Extrai a data de uma chave `drummond.report.<date>`; `null` quando não é um relatório válido. */
const dateFromKey = (key: string): string | null => {
  if (!key.startsWith(REPORT_STORAGE_PREFIX)) return null
  const date = key.slice(REPORT_STORAGE_PREFIX.length)
  return DATE_RE.test(date) ? date : null
}

/** Valida o ponteiro `latest`; qualquer formato inesperado vira `null`. */
export const toReportRef = (value: unknown): ReportRef | null => {
  if (!value || typeof value !== "object") return null
  const stored = value as Partial<ReportRef>
  if (!nonEmptyString(stored.date) || !isFiniteNumber(stored.generatedAt)) return null
  return { date: stored.date, generatedAt: stored.generatedAt }
}

/**
 * Normaliza um relatório lido do storage. Registro corrompido (sem `report`/`input` ou com a data
 * de outra chave) é descartado com `null`, e a página mostra o estado vazio em vez de quebrar.
 */
export const toStoredReport = (value: unknown, date: string): StoredReport | null => {
  if (!value || typeof value !== "object") return null
  const stored = value as Partial<StoredReport>
  if (
    !stored.report ||
    typeof stored.report !== "object" ||
    !stored.input ||
    typeof stored.input !== "object" ||
    !isFiniteNumber(stored.generatedAt) ||
    !nonEmptyString(stored.model) ||
    !nonEmptyString(stored.promptVersion)
  ) {
    return null
  }
  return {
    date,
    generatedAt: stored.generatedAt,
    model: stored.model,
    promptVersion: stored.promptVersion,
    report: stored.report as DailyReport,
    input: stored.input as DailyReportInput
  }
}

/**
 * Grava o relatório da data pedida e atualiza o ponteiro `latest` na mesma operação. A `date`
 * explícita manda (o `report` internamente também guarda a sua), então a chave nunca fica
 * inconsistente com o conteúdo. Silencioso sem storage.
 */
export const saveReport = async (date: string, report: StoredReport): Promise<void> => {
  const area = localArea()
  if (!area) return
  const stored: StoredReport = { ...report, date }
  try {
    await area.set({
      [reportKey(date)]: stored,
      [REPORT_LATEST_KEY]: { date, generatedAt: stored.generatedAt } satisfies ReportRef
    })
  } catch {
    // Sem storage (extensão recarregada): o relatório daquela sessão segue só em memória.
  }
}

/** Lê o relatório da data pedida; sem storage, sem chave ou com dado corrompido, devolve `null`. */
export const loadReport = async (date: string): Promise<StoredReport | null> => {
  const area = localArea()
  if (!area) return null
  try {
    const key = reportKey(date)
    const items = await area.get(key)
    return toStoredReport(items?.[key], date)
  } catch {
    return null
  }
}

/** Datas dos relatórios guardados, da mais recente para a mais antiga. */
export const listReportDates = async (): Promise<string[]> => {
  const area = localArea()
  if (!area) return []
  try {
    const items = await area.get(null)
    return Object.keys(items ?? {})
      .map(dateFromKey)
      .filter((date): date is string => date !== null)
      .sort((a, b) => b.localeCompare(a))
  } catch {
    return []
  }
}

/**
 * Ponteiro do último relatório. Lê a chave dedicada e, se ela estiver ausente/corrompida, cai para
 * o relatório mais recente das datas listadas — assim uma gravação antiga, feita antes do ponteiro
 * existir, ainda é encontrada. Sem nada guardado, devolve `null`.
 */
export const loadLatestReportRef = async (): Promise<ReportRef | null> => {
  const area = localArea()
  if (!area) return null
  try {
    const items = await area.get(REPORT_LATEST_KEY)
    const ref = toReportRef(items?.[REPORT_LATEST_KEY])
    if (ref) return ref
    const [latest] = await listReportDates()
    if (!latest) return null
    const report = await loadReport(latest)
    return report ? { date: report.date, generatedAt: report.generatedAt } : null
  } catch {
    return null
  }
}
