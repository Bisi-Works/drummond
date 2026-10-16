import { describe, expect, it } from "vitest"

import type { DailyReport } from "~lib/ai/schemas"
import {
  buildStandaloneHtml,
  escapeHtml,
  formatDayLabel,
  formatDuration,
  reportFileName
} from "~lib/report/format"
import type { StoredReport } from "~lib/report/storage"
import type { DailyReportInput } from "~lib/tracking/report"

// Helpers puros da página do relatório (Fase 04), sem `chrome`, sem React e sem rede: só o
// `StoredReport` entrando e texto saindo. Cobrem os rótulos da página/download e o documento
// autocontido do "Baixar HTML", com atenção especial ao escape — texto do modelo nunca pode virar
// markup no arquivo baixado.

const report: DailyReport = {
  resumo: "Dia corrido, com uma pendência em aberto.",
  acertos: ["Respondeu rápido a Maria (botconversa)."],
  erros: ["Demora para confirmar o prazo."],
  melhorias: ["Confirmar o prazo antes de enviar o orçamento."],
  pendencias: ["Maria aguarda o orçamento combinado."]
}

const input: DailyReportInput = {
  date: "2026-10-07",
  totals: {
    conversations: 3,
    waiting: 1,
    answered: 1,
    withoutMessage: 1,
    reviews: 2,
    coachings: 1,
    waitingByLevel: { verde: 1, amarelo: 0, laranja: 0, vermelho: 0 },
    alerts: 0,
    averageFirstResponseMs: 120_000,
    averageResponseMs: null
  },
  conversations: []
}

const stored = (over: Partial<StoredReport> = {}): StoredReport => ({
  date: "2026-10-07",
  generatedAt: 1_800_000,
  model: "deepseek/deepseek-v4-flash-0731",
  promptVersion: "2026-10-07.1",
  report,
  input,
  ...over
})

describe("formatDuration", () => {
  it("usa segundos abaixo de um minuto", () => {
    expect(formatDuration(0)).toBe("0 s")
    expect(formatDuration(45_000)).toBe("45 s")
    expect(formatDuration(59_000)).toBe("59 s")
  })

  it("usa minutos inteiros abaixo de uma hora", () => {
    expect(formatDuration(60_000)).toBe("1 min")
    expect(formatDuration(120_000)).toBe("2 min")
    expect(formatDuration(3_599_000)).toBe("59 min")
  })

  it("usa a forma compacta com horas", () => {
    // Hora cheia perde o resto; com resto, os minutos vão com dois dígitos.
    expect(formatDuration(3_600_000)).toBe("1 h")
    expect(formatDuration(3_900_000)).toBe("1 h 05")
    expect(formatDuration(7_200_000)).toBe("2 h")
  })

  it("nunca devolve duração negativa", () => {
    expect(formatDuration(-5_000)).toBe("0 s")
  })
})

describe("formatDayLabel", () => {
  it("converte YYYY-MM-DD em DD/MM/AAAA", () => {
    expect(formatDayLabel("2026-10-02")).toBe("02/10/2026")
  })

  it("devolve a entrada original quando o formato não é reconhecido", () => {
    expect(formatDayLabel("2026")).toBe("2026")
  })
})

describe("escapeHtml", () => {
  it("neutraliza os caracteres que quebram markup ou atributo", () => {
    expect(escapeHtml("<b>& \"'</b>")).toBe("&lt;b&gt;&amp; &quot;&#39;&lt;/b&gt;")
  })
})

describe("reportFileName", () => {
  it("é estável para uma data fixa", () => {
    expect(reportFileName("2026-10-02")).toBe("drummond-relatorio-2026-10-02.html")
  })
})

describe("buildStandaloneHtml", () => {
  it("inclui as seções, o resumo e as métricas do relatório", () => {
    const html = buildStandaloneHtml(stored())

    // Cabeçalho e marca.
    expect(html).toContain("<!doctype html>")
    expect(html).toContain("Drummond")
    expect(html).toContain("by BW")
    expect(html).toContain("07/10/2026")

    // Títulos das seções na ordem de leitura.
    expect(html).toContain("Resumo geral")
    expect(html).toContain("Acertos")
    expect(html).toContain("Erros / padrões a evitar")
    expect(html).toContain("Melhorias")
    expect(html).toContain("Pendências para amanhã")
    expect(html).toContain("Métricas do dia")

    // Textos do relatório e valores das métricas.
    expect(html).toContain(report.resumo)
    expect(html).toContain(report.acertos[0])
    expect(html).toContain(report.pendencias[0])
    expect(html).toContain("Tempo médio de resposta")
    expect(html).toContain("—") // averageResponseMs null vira travessão, nunca zero inventado
  })

  it("escapa um texto malicioso sem vazá-lo como markup", () => {
    const malicious = stored({
      report: {
        ...report,
        resumo: '<script>alert("xss")</script>',
        acertos: ['<img src=x onerror="alert(1)">']
      }
    })

    const html = buildStandaloneHtml(malicious)

    // O payload continua como texto; nenhuma tag do atacante chega ao documento.
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;")
    expect(html).not.toContain("<script>alert")
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;")
    expect(html).not.toContain("<img src=x")
  })

  it("mostra o estado vazio quando a lista não tem itens", () => {
    const empty = stored({ report: { ...report, erros: [] } })

    expect(buildStandaloneHtml(empty)).toContain("Nenhum item registrado.")
  })
})
