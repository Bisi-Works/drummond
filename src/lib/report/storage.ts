import type { DailyReport } from "~lib/ai/schemas"
import { localArea } from "~lib/chrome-storage"
import { config } from "~lib/config"
import { dayKey } from "~lib/tracking/level"
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
 * Uma chave por dia (ex.: "drummond.report.generated.2026-10-07"): registra que o relatório daquela
 * data já foi gerado, quantas vezes e quando. É a trava de 1 relatório por dia em produção.
 */
export const REPORT_GENERATED_PREFIX = "drummond.report.generated."

/** Registro da trava diária: quando e quantas vezes o relatório daquele dia foi gerado. */
export interface ReportGeneration {
  /** Momento da última geração bem-sucedida (epoch ms). */
  generatedAt: number
  /** Gerações bem-sucedidas no dia; no mínimo 1 quando o registro existe. */
  count: number
}

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

/** Chave completa de um relatório a partir da data. */
const reportKey = (date: string): string => `${REPORT_STORAGE_PREFIX}${date}`

/** Chave completa do registro de geração (trava diária) a partir da data. */
const generatedKey = (date: string): string => `${REPORT_GENERATED_PREFIX}${date}`

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

/**
 * Normaliza o registro da trava diária: qualquer coisa fora de `{ generatedAt, count }` numéricos
 * vira `null`, e `count` nunca é menor que 1 (um registro existente conta como uma geração).
 */
export const toReportGeneration = (value: unknown): ReportGeneration | null => {
  if (!value || typeof value !== "object") return null
  const stored = value as Partial<ReportGeneration>
  if (!isFiniteNumber(stored.generatedAt) || !isFiniteNumber(stored.count)) return null
  return { generatedAt: stored.generatedAt, count: Math.max(1, Math.trunc(stored.count)) }
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
 * inconsistente com o conteúdo. Devolve `false` (sem lançar) quando o storage não existe ou a
 * gravação falha — assim quem chamou não marca a cota nem abre a página de um relatório que não
 * foi persistido.
 */
export const saveReport = async (date: string, report: StoredReport): Promise<boolean> => {
  const area = localArea()
  if (!area) return false
  const stored: StoredReport = { ...report, date }
  try {
    await area.set({
      [reportKey(date)]: stored,
      [REPORT_LATEST_KEY]: { date, generatedAt: stored.generatedAt } satisfies ReportRef
    })
    return true
  } catch {
    // Sem storage (extensão recarregada): o relatório daquela sessão segue só em memória.
    return false
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
 * Lê a trava diária da data pedida; sem storage, sem chave ou com dado corrompido, devolve `null`.
 * Silencioso quando o `chrome.storage` não existe (extensão recarregada com a página aberta).
 */
export const loadReportGeneration = async (
  date: string
): Promise<ReportGeneration | null> => {
  const area = localArea()
  if (!area) return null
  try {
    const key = generatedKey(date)
    const items = await area.get(key)
    return toReportGeneration(items?.[key])
  } catch {
    return null
  }
}

/**
 * Marca o relatório da data como gerado (chamado só depois de um `ok: true` da IA). Soma 1 ao
 * contador do dia e atualiza `generatedAt`. Silencioso sem storage — a falha da IA, por não chamar
 * isto, não consome a cota do dia.
 */
export const markReportGenerated = async (
  date: string,
  now: number = Date.now()
): Promise<void> => {
  const area = localArea()
  if (!area) return
  const previous = await loadReportGeneration(date)
  try {
    await area.set({
      [generatedKey(date)]: {
        generatedAt: now,
        count: (previous?.count ?? 0) + 1
      } satisfies ReportGeneration
    })
  } catch {
    // Sem storage (extensão recarregada): a trava daquela sessão segue só em memória.
  }
}

/** Apaga a trava da data (só o caminho de dev usa: "Gerar novamente" para repetir os testes). */
export const clearReportGeneration = async (date: string): Promise<void> => {
  const area = localArea()
  if (!area) return
  try {
    await area.remove(generatedKey(date))
  } catch {
    // Sem storage: não há nada persistido para apagar.
  }
}

/**
 * Diz se o relatório da `date` ainda pode ser gerado agora. A trava é por dia local: o registro é
 * lido da chave da própria data, então um relatório gerado ontem não bloqueia hoje. `now` entra na
 * checagem da virada (se o dia já virou, a cota lida de outra data não vale) e `reportUnlimited`
 * libera tudo — é o padrão em `pnpm dev`, para testar sem consumir a cota.
 */
export const canGenerateReport = async (
  date: string,
  now: number = Date.now()
): Promise<boolean> => {
  if (config.reportUnlimited) return true
  const generation = await loadReportGeneration(date)
  if (!generation) return true
  // A cota só vale enquanto o dia pedido ainda é o dia local de `now`; depois da virada renova.
  if (dayKey(new Date(now)) !== date) return true
  return generation.count < config.reportLimitPerDay
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
