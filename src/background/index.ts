import "./coach-port"

// Clicar no ícone da extensão abre o painel lateral de coaching.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error("[drummond] setPanelBehavior", error))
