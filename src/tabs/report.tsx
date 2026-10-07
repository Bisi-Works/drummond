import "~style.css"

import { useEffect, useLayoutEffect, useState } from "react"

import { Wordmark } from "~components/Brand"
import { Spinner } from "~components/Spinner"
import { ThemeToggle } from "~components/ThemeToggle"
import { useTheme } from "~hooks/useTheme"
import { registerBrandFont } from "~lib/brand-font"
import {
  formatDayLabel,
  formatTimestamp,
  reportMetrics,
  reportSections
} from "~lib/report/format"
import { loadLatestReportRef, loadReport, type StoredReport } from "~lib/report/storage"

registerBrandFont()

// Página própria da extensão (tabs/report.html) que mostra o relatório do dia gerado no widget.
// É o artefato que o vendedor leva embora: o mesmo conteúdo do HTML baixado, mas navegável, com o
// tema claro/escuro da extensão e um layout de impressão A4. A data vem de `?date=YYYY-MM-DD`;
// sem ela, a página abre o último relatório gerado (`loadLatestReportRef`) e, se não houver nenhum,
// explica no próprio estado vazio como gerar (botão "Encerrar o dia" no widget do Botconversa).
//
// O trabalho pesado de montar o texto fica em `~lib/report/format`: aqui só se lê o `StoredReport`
// do storage e se escolhe o que renderizar. Os botões de imprimir/baixar entram numa tarefa
// seguinte; esta página já nasce pronta para eles (o `.no-print` esconde a navegação no papel).

/** Data YYYY-MM-DD do parâmetro de busca; `null` quando ausente ou fora do formato. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const requestedDate = (): string | null => {
  try {
    const value = new URLSearchParams(window.location.search).get("date")
    return value && DATE_RE.test(value) ? value : null
  } catch {
    return null
  }
}

// Impressão A4 legível: sem fundo escuro no papel, sem a barra preta do cabeçalho e sem a navegação
// (`.no-print`). O tamanho de página e as margens valem para o "Imprimir / Salvar PDF" do navegador.
const PRINT_STYLE = `
@page { size: A4; margin: 14mm; }
@media print {
  .report-root { background: #ffffff !important; }
  .no-print { display: none !important; }
  .report-shell { max-width: none !important; padding: 0 !important; }
  .report-page { border: 0 !important; border-radius: 0 !important; box-shadow: none !important; background: #ffffff !important; }
  .report-head { background: #ffffff !important; padding: 18px 0 12px !important; }
  .report-head, .report-head * { color: #111827 !important; }
  .report-head .report-meta { color: #4b5563 !important; }
  .report-block { padding-left: 0 !important; padding-right: 0 !important; page-break-inside: avoid; }
  .report-footer { padding-left: 0 !important; padding-right: 0 !important; }
}
`.trim()

type ReportState =
  | { kind: "loading" }
  /** Sem relatório: `date` é a data pedida em `?date=`, quando havia uma. */
  | { kind: "empty"; date: string | null }
  | { kind: "ready"; stored: StoredReport }

/** Um bloco titulado do relatório (mesmo vocabulário visual das seções do painel). */
const SectionBlock = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="report-block px-7 pt-6">
    <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-brand">{title}</h3>
    <div className="mt-2.5">{children}</div>
  </section>
)

/** Lista de itens do relatório; vazia mostra o mesmo aviso do HTML autocontido. */
const ItemList = ({ items }: { items: string[] }) =>
  items.length === 0 ? (
    <p className="text-sm text-fg-subtle">Nenhum item registrado.</p>
  ) : (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  )

/** Métricas do dia montadas do `input` guardado com o relatório (sem nova chamada de IA). */
const MetricsGrid = ({ stored }: { stored: StoredReport }) => (
  <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
    {reportMetrics(stored.input).map((metric) => (
      <div key={metric.label} className="rounded-lg border border-line bg-muted/50 px-3 py-2">
        <dt className="text-[11px] text-fg-subtle">{metric.label}</dt>
        <dd className="mt-0.5 text-xl font-semibold tabular-nums text-fg">{metric.value}</dd>
      </div>
    ))}
  </dl>
)

/** Estado sem relatório: diz qual data faltou e como gerar pelo widget do Botconversa. */
const EmptyState = ({ date }: { date: string | null }) => (
  <div className="space-y-4 px-7 py-8">
    <p className="text-sm text-fg">
      {date
        ? `Não encontrei um relatório para ${formatDayLabel(date)}.`
        : "Ainda não há nenhum relatório gerado neste navegador."}
    </p>
    <div className="rounded-lg border border-dashed border-line bg-muted/40 px-4 py-4 text-sm text-fg-muted">
      <p className="font-medium text-fg">Como gerar o relatório do dia</p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5">
        <li>
          Abra o Botconversa e deixe o widget do Drummond acompanhar as conversas do dia (ele grava
          tudo em <code>chrome.storage.local</code>, sem chamar a IA).
        </li>
        <li>
          No widget, use o botão <strong>Encerrar o dia</strong> para gerar o relatório com a IA.
        </li>
        <li>
          O relatório é salvo e abre nesta página. Para reabrir um dia específico, use{" "}
          <code>?date=AAAA-MM-DD</code> no endereço.
        </li>
      </ol>
    </div>
  </div>
)

const ReportPage = () => {
  const [state, setState] = useState<ReportState>({ kind: "loading" })
  const { theme, setTheme } = useTheme()

  // Aplica o tema antes da primeira pintura, como no painel lateral, para não piscar o claro.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [theme])

  useEffect(() => {
    let alive = true

    const load = async () => {
      const date = requestedDate()
      const fallback = date ?? (await loadLatestReportRef())?.date ?? null
      const stored = fallback ? await loadReport(fallback) : null
      if (!alive) return
      setState(stored ? { kind: "ready", stored } : { kind: "empty", date })
    }

    void load().catch(() => {
      // Storage indisponível (extensão recarregada com a página aberta): estado vazio, sem quebrar.
      if (alive) setState({ kind: "empty", date: requestedDate() })
    })

    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    document.title =
      state.kind === "ready"
        ? `Relatório ${formatDayLabel(state.stored.date)} — Drummond by BW`
        : "Relatório do dia — Drummond by BW"
  }, [state])

  const title =
    state.kind === "ready" ? `Relatório do dia — ${formatDayLabel(state.stored.date)}` : "Relatório do dia"
  const meta =
    state.kind === "ready"
      ? `Modelo ${state.stored.model} · prompt ${state.stored.promptVersion} · gerado em ${formatTimestamp(
          state.stored.generatedAt
        )}`
      : "Drummond by BW — relatório diário do vendedor"

  return (
    <main className="report-root min-h-screen bg-muted font-sans text-fg">
      <style>{PRINT_STYLE}</style>
      <div className="report-shell mx-auto max-w-3xl px-4 py-8">
        <article className="report-page overflow-hidden rounded-2xl border border-line bg-surface shadow-xl">
          <div className="h-1.5 bg-brand" />
          <header className="report-head bg-black px-7 py-6 text-white">
            <div className="flex items-start justify-between gap-4">
              <Wordmark as="h1" />
              <div className="no-print -mr-1 -mt-1">
                <ThemeToggle theme={theme} onChange={setTheme} />
              </div>
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h2>
            <p className="report-meta mt-1 text-xs text-gray-400">{meta}</p>
          </header>

          {state.kind === "loading" && (
            <div className="flex items-center gap-3 px-7 py-10 text-sm text-fg-muted" aria-live="polite">
              <Spinner />
              Carregando o relatório…
            </div>
          )}

          {state.kind === "empty" && <EmptyState date={state.date} />}

          {state.kind === "ready" && (
            <>
              <SectionBlock title="Resumo geral">
                <p className="text-base leading-relaxed text-fg">{state.stored.report.resumo}</p>
              </SectionBlock>

              {reportSections(state.stored.report).map((section) => (
                <SectionBlock key={section.title} title={section.title}>
                  <ItemList items={section.items} />
                </SectionBlock>
              ))}

              <SectionBlock title="Métricas do dia">
                <MetricsGrid stored={state.stored} />
              </SectionBlock>

              <footer className="report-footer mt-7 border-t border-line px-7 py-5 text-xs text-fg-subtle">
                Relatório gerado por Drummond by BW — uso interno.
              </footer>
            </>
          )}
        </article>
      </div>
    </main>
  )
}

export default ReportPage
