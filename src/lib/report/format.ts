import type { DailyReport } from "~lib/ai/schemas"
import { formatDayLabel } from "~lib/tracking/format"
import type { DailyReportInput } from "~lib/tracking/report"

import type { StoredReport } from "./storage"

// Helpers puros da página do relatório (Fase 04). Nada aqui toca `chrome`, React ou o relógio
// global: as funções recebem o `StoredReport`/`DailyReportInput` já carregado e devolvem texto,
// para a página e os testes usarem o mesmo rótulo sem duplicar regra. O download `.html` usa
// `buildStandaloneHtml`, que monta um documento completo com o CSS embutido — sem depender do
// bundle do Plasmo (a página aberta fora da extensão continua legível).
//
// Todo texto vindo do modelo ou das conversas passa por `escapeHtml` antes de entrar no HTML: uma
// mensagem de cliente com `<script>` não pode virar markup no documento baixado.

/**
 * Data local YYYY-MM-DD em "DD/MM/AAAA" — o mesmo rótulo do widget e do painel. Reexportado de
 * `~lib/tracking/format` em vez de reimplementado: as duas telas mostram a data igual.
 */
export { formatDayLabel }

/**
 * Duração em texto curto para a coluna de métricas: "45 s", "2 min", "1 h 05". Nunca negativa.
 *
 * A página do relatório pede a forma compacta com os minutos alinhados (`1 h 05`), diferente do
 * `formatDuration` de `~lib/tracking/format` ("1 h 5 min"), que é o rótulo corrido do widget e do
 * painel. Os dois convivem porque são superfícies diferentes; não troque um pelo outro sem
 * conferir a largura da coluna de destino.
 */
export const formatDuration = (elapsedMs: number): string => {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`
}

/** Nome do arquivo do download `.html`, estável por data (ex.: "drummond-relatorio-2026-10-02.html"). */
export const reportFileName = (date: string): string => `drummond-relatorio-${date}.html`

/**
 * Escapa o texto para interpolar em HTML. Cobre os cinco caracteres que quebram markup ou atributo
 * (`&`, `<`, `>`, `"`, `'`), então o valor serve tanto para conteúdo quanto para `title`/`alt`.
 */
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

/** Campos de lista do relatório; o `resumo` é um parágrafo e não entra aqui. */
type ListKey = "acertos" | "erros" | "melhorias" | "pendencias"

/** Títulos das seções, na ordem de leitura do relatório. Compartilhados com a página React. */
export const REPORT_LIST_SECTIONS: ReadonlyArray<{ key: ListKey; title: string }> = [
  { key: "acertos", title: "Acertos" },
  { key: "erros", title: "Erros / padrões a evitar" },
  { key: "melhorias", title: "Melhorias" },
  { key: "pendencias", title: "Pendências para amanhã" }
]

/** Uma seção do relatório pronta para render (título + itens), sem markup e sem escape. */
export interface ReportSection {
  title: string
  items: string[]
}

/**
 * Seções de lista do relatório na ordem de `REPORT_LIST_SECTIONS`. A página e o HTML autocontido
 * montam a partir daqui, então uma seção nova aparece nos dois sem editar cada template.
 */
export const reportSections = (report: DailyReport): ReportSection[] =>
  REPORT_LIST_SECTIONS.map(({ key, title }) => ({ title, items: report[key] }))

/** Uma métrica do dia (rótulo + valor já legível), para o `<dl>`/grade da página e do HTML. */
export interface ReportMetric {
  label: string
  value: string
}

/** Duração legível; "—" quando não há dado suficiente (nunca inventa zero). */
const durationOrDash = (ms: number | null): string => (ms === null ? "—" : formatDuration(ms))

/**
 * Bloco de métricas do dia, montado do `input` guardado com o relatório (`summarizeDay` da Fase 02)
 * — por isso a página reabre sem uma nova chamada de IA.
 */
export const reportMetrics = (input: DailyReportInput): ReportMetric[] => [
  { label: "Conversas acompanhadas", value: String(input.totals.conversations) },
  { label: "Aguardando", value: String(input.totals.waiting) },
  { label: "Respondidas", value: String(input.totals.answered) },
  { label: "Tempo médio de 1ª resposta", value: durationOrDash(input.totals.averageFirstResponseMs) },
  { label: "Tempo médio de resposta", value: durationOrDash(input.totals.averageResponseMs) }
]

/**
 * Data e hora locais do instante de geração: "02/10/2026 14:30". Usado tanto no cabeçalho da
 * página do relatório quanto no HTML autocontido — o mesmo instante aparece igual nos dois.
 */
export const formatTimestamp = (at: number): string => {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

// CSS embutido no documento baixado. Mantém a identidade da BW (vermelho #e7191f, preto e branco)
// e é legível no papel: o cabeçalho preto e o filete vermelho continuam impressos, sem depender de
// fundo escuro da tela. As margens de A4 valem para o "Imprimir / Salvar PDF" do próprio arquivo.
const STANDALONE_STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 40px 20px 64px;
    background: #f3f4f6;
    color: #111827;
    font-family: "Drummond Geist", Geist, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 15px;
    line-height: 1.55;
  }
  .page {
    max-width: 820px;
    margin: 0 auto;
    padding: 0 0 8px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
  }
  .brandbar { height: 5px; background: #e7191f; }
  .head { padding: 28px 36px 20px; background: #000000; color: #ffffff; }
  .brand { display: flex; align-items: baseline; gap: 8px; font-size: 15px; }
  .brand strong { font-weight: 600; letter-spacing: -0.01em; }
  .brand span { color: #9ca3af; font-weight: 400; }
  h1 { margin: 14px 0 6px; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
  .meta { margin: 0; font-size: 13px; color: #d1d5db; }
  section.block { padding: 22px 36px 0; }
  section.block:last-of-type { padding-bottom: 26px; }
  h2 {
    margin: 0 0 10px;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #e7191f;
  }
  .summary { margin: 0; font-size: 16px; }
  ul { margin: 0; padding-left: 20px; }
  li { margin-bottom: 6px; }
  li.empty { color: #6b7280; list-style: none; margin-left: -20px; }
  .metrics { display: flex; flex-wrap: wrap; gap: 10px; }
  .metric {
    flex: 1 1 150px;
    padding: 10px 12px;
    background: #f3f4f6;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
  }
  .metric dt { font-size: 12px; color: #6b7280; }
  .metric dd { margin: 2px 0 0; font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
  footer {
    margin-top: 26px;
    padding: 14px 36px 26px;
    border-top: 1px solid #e5e7eb;
    font-size: 12px;
    color: #6b7280;
  }
  @media print {
    @page { size: A4; margin: 14mm; }
    body { padding: 0; background: #ffffff; font-size: 12pt; }
    .page { max-width: none; border: 0; border-radius: 0; box-shadow: none; }
    .head { padding: 18px 0 14px; }
    section.block { padding: 16px 0 0; page-break-inside: avoid; }
    section.block:last-of-type { padding-bottom: 0; }
    footer { padding: 12px 0 0; }
    .metric { background: #ffffff; }
    a { color: inherit; text-decoration: none; }
  }
`.trim()

/**
 * Documento HTML completo e autocontido do relatório, para o download ".html". Usa o mesmo conteúdo
 * da página (resumo, seções e métricas do dia) e o CSS embutido acima — nenhuma dependência do
 * bundle, então o arquivo abre em qualquer navegador. Todo texto dinâmico é escapado.
 */
export const buildStandaloneHtml = (stored: StoredReport): string => {
  const dateLabel = formatDayLabel(stored.date)

  const metrics = reportMetrics(stored.input)
    .map((metric) => `        <div class="metric"><dt>${escapeHtml(metric.label)}</dt><dd>${escapeHtml(metric.value)}</dd></div>`)
    .join("\n")

  const sections = reportSections(stored.report)
    .map((section) => {
      const items =
        section.items.length > 0
          ? section.items.map((item) => `          <li>${escapeHtml(item)}</li>`).join("\n")
          : `          <li class="empty">Nenhum item registrado.</li>`
      return [
        `      <section class="block">`,
        `        <h2>${escapeHtml(section.title)}</h2>`,
        `        <ul>`,
        items,
        `        </ul>`,
        `      </section>`
      ].join("\n")
    })
    .join("\n")

  return [
    `<!doctype html>`,
    `<html lang="pt-BR">`,
    `<head>`,
    `  <meta charset="utf-8" />`,
    `  <meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `  <title>Relatório do dia — ${escapeHtml(dateLabel)}</title>`,
    `  <style>`,
    STANDALONE_STYLE,
    `  </style>`,
    `</head>`,
    `<body>`,
    `  <main class="page">`,
    `    <div class="brandbar"></div>`,
    `    <header class="head">`,
    `      <div class="brand"><strong>Drummond</strong> <span>by BW</span></div>`,
    `      <h1>Relatório do dia — ${escapeHtml(dateLabel)}</h1>`,
    `      <p class="meta">Modelo ${escapeHtml(stored.model)} · prompt ${escapeHtml(
      stored.promptVersion
    )} · gerado em ${escapeHtml(formatTimestamp(stored.generatedAt))}</p>`,
    `    </header>`,
    `    <section class="block">`,
    `      <h2>Resumo geral</h2>`,
    `      <p class="summary">${escapeHtml(stored.report.resumo)}</p>`,
    `    </section>`,
    `    <section class="block">`,
    `      <h2>Métricas do dia</h2>`,
    `      <dl class="metrics">`,
    metrics,
    `      </dl>`,
    `    </section>`,
    sections,
    `    <footer>Relatório gerado por Drummond by BW — uso interno.</footer>`,
    `  </main>`,
    `</body>`,
    `</html>`
  ].join("\n")
}
