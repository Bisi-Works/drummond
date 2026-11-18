import "./coach-port"

import { getAdapter } from "~adapters"

// Clicar no ícone da extensão abre o painel lateral de coaching.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("[drummond] setPanelBehavior", error))

// Plataformas sem coaching (o WhatsApp Web, por ora) não abrem o painel. `tab.url` só vem para os
// hosts da extensão; nas outras abas fica ligado, como antes.
chrome.tabs.onUpdated.addListener((tabId, _info, tab) => {
  const host = tab.url ? new URL(tab.url).hostname : ""
  const enabled = getAdapter(host)?.features.coaching ?? true
  chrome.sidePanel.setOptions({ tabId, enabled }).catch(() => {})
})
