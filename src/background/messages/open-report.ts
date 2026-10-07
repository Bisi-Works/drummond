import type { PlasmoMessaging } from "@plasmohq/messaging"

import type { OpenReportRequest, OpenReportResponse } from "~lib/messages"

// Abrir `tabs/report.html` é trabalho do background: `chrome.tabs` é usado pelo service worker e
// pelas páginas da extensão, mas **não** existe no content script em que o widget roda (só
// `runtime`/`storage`/`i18n`/`dom` chegam lá). O widget pede pela rota e o `chrome.tabs.create`
// acontece aqui — mesmo padrão de `review-draft`/`generate-report`, com o nome do arquivo
// registrando a rota para o `@plasmohq/messaging` (sem registro manual no `index.ts`).
//
// O `tabs/report.html` não precisa de `web_accessible_resources`: quem navega até ele é a própria
// extensão (o background), não a página do Botconversa. Também não exige a permissão `tabs` —
// `chrome.tabs.create` funciona sem ela.

/** Mesmo formato de `?date=` aceito pela página do relatório; qualquer outra coisa cai no último. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const handler: PlasmoMessaging.MessageHandler<OpenReportRequest, OpenReportResponse> = async (
  req,
  res
) => {
  const date = req.body?.date
  const path = date && DATE_RE.test(date) ? `tabs/report.html?date=${date}` : "tabs/report.html"
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL(path) })
    res.send({ ok: true })
  } catch (error) {
    res.send({
      ok: false,
      error: error instanceof Error ? error.message : "Não foi possível abrir a página do relatório."
    })
  }
}

export default handler
