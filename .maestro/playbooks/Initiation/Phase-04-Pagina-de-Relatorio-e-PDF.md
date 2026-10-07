# Phase 04: Página de relatório em HTML e exportação para PDF

Esta fase entrega o artefato que o vendedor leva embora: uma página própria da extensão que renderiza
o JSON do relatório (gerado na fase anterior) dentro de um template HTML com a identidade da BW, com
botão de imprimir/exportar em PDF e de baixar o HTML. Também adiciona o botão "Encerrar o dia" no
widget, que dispara a geração, guarda o resultado no `chrome.storage` e abre a página do relatório.
Ao final, `pnpm test`/`pnpm typecheck` passam e o fluxo completo — encerrar o dia → relatório em
página externa → PDF — funciona de ponta a ponta.

## Tasks

- [ ] Criar `src/lib/report/storage.ts` para persistir e recuperar relatórios:
  - Chaves `REPORT_STORAGE_PREFIX = "drummond.report."` (um por data) e `REPORT_LATEST_KEY = "drummond.report.latest"` com `{ date, generatedAt }`.
  - `saveReport(date, report)`, `loadReport(date)`, `listReportDates()`, `loadLatestReportRef()` com fallback silencioso quando `chrome?.storage` não existir, seguindo o padrão de `src/lib/tracking/store.ts`.
  - Tipo `StoredReport = { date: string; generatedAt: number; model: string; promptVersion: string; report: DailyReport; input: DailyReportInput }` — guardar também o input permite reabrir a página depois sem nova chamada de IA.

- [ ] Criar `src/lib/report/format.ts` com helpers puros usados pela página e pelos testes:
  - `reportFileName(date)` (ex.: `drummond-relatorio-2026-10-02.html`), `formatDayLabel(date)` (ex.: "02/10/2026") e `formatDuration(ms)` legível ("2 min", "1 h 05").
  - `buildStandaloneHtml(stored: StoredReport): string` que gera um documento HTML completo e autocontido (CSS embutido, sem dependência do bundle) a partir do mesmo conteúdo da seção do relatório — usado no download `.html`. Manter a marca e as cores (`#e7191f`, preto, branco) do projeto.
  - `escapeHtml(text)` para todo texto vindo do modelo/das conversas, evitando que conteúdo do cliente quebre o HTML.

- [ ] Criar a página da extensão `src/tabs/report.tsx` (convenção de tabs do Plasmo, acessível em `tabs/report.html`):
  - Ler a data do `location.search` (`?date=YYYY-MM-DD`); sem data, cair para `loadLatestReportRef()` e, se não houver, mostrar um estado vazio explicando como gerar o relatório no widget.
  - Renderizar o template com `Wordmark`/marca de `src/components/Brand.tsx`, fonte Geist (`registerBrandFont`), seções: cabeçalho (data, modelo, versão do prompt), Resumo geral, Acertos, Erros/Padrões a evitar, Melhorias, Pendências para amanhã, e um bloco de métricas vindo de `input`/`summarizeDay` (conversas acompanhadas, aguardando, respondidas, tempo médio de resposta).
  - Suportar tema claro/escuro com as variáveis CSS já existentes (`bg-surface`, `text-fg`, `border-line`) e um layout de impressão A4 legível.

- [ ] Adicionar as ações de exportação na página do relatório:
  - Botão "Imprimir / Salvar PDF" chamando `window.print()`, com `@media print` escondendo botões/navegação e ajustando margens e cores (evitar fundo preto no papel).
  - Botão "Baixar HTML" gerando um `Blob` de `buildStandaloneHtml(stored)` e disparando o download via link `URL.createObjectURL` + `a[download]`, revogando a URL depois.
  - Botão "Copiar JSON" (opcional, útil para depurar) copiando o relatório serializado com `navigator.clipboard.writeText`.

- [ ] Adicionar o botão "Encerrar o dia" no `src/components/DayWidget.tsx`:
  - Ficará desabilitado (com dica) quando não houver nenhuma conversa acompanhada no dia; caso contrário, ao clicar: monta `buildReportInput(day, now)`, chama `sendToBackground<GenerateReportRequest, GenerateReportResponse>({ name: "generate-report", body })`, e em caso de sucesso salva com `saveReport` e abre `chrome.tabs.create({ url: chrome.runtime.getURL(`tabs/report.html?date=${date}`) })`.
  - Estados visíveis de carregamento e erro no próprio widget, reaproveitando o `Spinner` de `src/components/Spinner.tsx`; erros de IA mostram a mensagem devolvida no `AiResult` sem quebrar o widget.
  - Exibir custo da geração quando `config.showCosts` (dev), reaproveitando `CostPanel`/`formatUsd`.

- [ ] Registrar no `src/background/index.ts` (ou onde os handlers são carregados) o novo handler de mensagem, se a convenção do Plasmo exigir, e confirmar que `generate-report` é alcançável a partir do content script sem expor a chave da API.
  - Verificar junto de `src/background/messages/review-draft.ts` como o `@plasmohq/messaging` descobre o handler e replicar exatamente; ajustar o manifesto se algum `web_accessible_resources`/permissão for necessário para abrir `tabs/report.html` a partir do content script (`chrome.runtime.getURL` não exige `tabs`).

- [ ] Escrever `tests/report-format.test.ts`:
  - `formatDuration` e `formatDayLabel` nos casos comuns e nos extremos (0 ms, 59 s, mais de 1 h).
  - `escapeHtml` neutralizando `<`, `>`, `&` e aspas.
  - `buildStandaloneHtml` contendo as seções e os textos do relatório e escapando um texto malicioso (`<script>`) sem vazá-lo como markup.
  - `reportFileName` estável para uma data fixa.

- [ ] Rodar `pnpm test`, `pnpm typecheck` e `pnpm build`, corrigindo as falhas; em seguida rodar `pnpm check:bundle` para garantir que a nova tab e o novo handler não quebram a build de produção (o Plasmo pode descartar código no tree-shaking, como o README alerta).
