# Phase 04: Página de relatório em HTML e exportação para PDF

Esta fase entrega o artefato que o vendedor leva embora: uma página própria da extensão que renderiza
o JSON do relatório (gerado na fase anterior) dentro de um template HTML com a identidade da BW, com
botão de imprimir/exportar em PDF e de baixar o HTML. Também adiciona o botão "Encerrar o dia" no
widget, que dispara a geração, guarda o resultado no `chrome.storage` e abre a página do relatório.
Ao final, `pnpm test`/`pnpm typecheck` passam e o fluxo completo — encerrar o dia → relatório em
página externa → PDF — funciona de ponta a ponta.

## Tasks

- [x] Criar `src/lib/report/storage.ts` para persistir e recuperar relatórios:
  - Chaves `REPORT_STORAGE_PREFIX = "drummond.report."` (um por data) e `REPORT_LATEST_KEY = "drummond.report.latest"` com `{ date, generatedAt }`.
  - `saveReport(date, report)`, `loadReport(date)`, `listReportDates()`, `loadLatestReportRef()` com fallback silencioso quando `chrome?.storage` não existir, seguindo o padrão de `src/lib/tracking/store.ts`.
  - Tipo `StoredReport = { date: string; generatedAt: number; model: string; promptVersion: string; report: DailyReport; input: DailyReportInput }` — guardar também o input permite reabrir a página depois sem nova chamada de IA.

- [x] Criar `src/lib/report/format.ts` com helpers puros usados pela página e pelos testes:
  - `reportFileName(date)` (ex.: `drummond-relatorio-2026-10-02.html`), `formatDayLabel(date)` (ex.: "02/10/2026") e `formatDuration(ms)` legível ("2 min", "1 h 05").
  - `buildStandaloneHtml(stored: StoredReport): string` que gera um documento HTML completo e autocontido (CSS embutido, sem dependência do bundle) a partir do mesmo conteúdo da seção do relatório — usado no download `.html`. Manter a marca e as cores (`#e7191f`, preto, branco) do projeto.
  - `escapeHtml(text)` para todo texto vindo do modelo/das conversas, evitando que conteúdo do cliente quebre o HTML.

> **Formatos fixados (2026-10-07):** `formatDuration` devolve `"45 s"` / `"2 min"` / `"1 h 05"` (minutos com dois dígitos quando há hora; hora cheia sem resto vira `"1 h"`), ou seja, um formato compacto diferente do `formatDuration` de `~lib/tracking/format` (`"1 h 5 min"`), que o widget/painel continua usando. `formatDayLabel` é **reexportado** de `~lib/tracking/format` (mesmo rótulo nas duas telas), e `reportFileName` é `drummond-relatorio-<YYYY-MM-DD>.html`.
> Além dos três helpers, o módulo exporta `REPORT_LIST_SECTIONS`, `reportSections(report)` e `reportMetrics(input)` para a página e o HTML autocontido montarem as mesmas seções sem duplicar títulos ("Resumo geral", "Acertos", "Erros / padrões a evitar", "Melhorias", "Pendências para amanhã", "Métricas do dia"). `buildStandaloneHtml` traz a marca "Drummond by BW", as cores `#e7191f`/preto/branco e um `@media print` com página A4. Verificado com `tsc --noEmit` limpo e a suíte existente (217/217) verde; os testes próprios ficam na tarefa `tests/report-format.test.ts` mais abaixo.

- [x] Criar a página da extensão `src/tabs/report.tsx` (convenção de tabs do Plasmo, acessível em `tabs/report.html`):
  - Ler a data do `location.search` (`?date=YYYY-MM-DD`); sem data, cair para `loadLatestReportRef()` e, se não houver, mostrar um estado vazio explicando como gerar o relatório no widget.
  - Renderizar o template com `Wordmark`/marca de `src/components/Brand.tsx`, fonte Geist (`registerBrandFont`), seções: cabeçalho (data, modelo, versão do prompt), Resumo geral, Acertos, Erros/Padrões a evitar, Melhorias, Pendências para amanhã, e um bloco de métricas vindo de `input`/`summarizeDay` (conversas acompanhadas, aguardando, respondidas, tempo médio de resposta).
  - Suportar tema claro/escuro com as variáveis CSS já existentes (`bg-surface`, `text-fg`, `border-line`) e um layout de impressão A4 legível.

> **Página do relatório entregue (2026-10-07).** `src/tabs/report.tsx` é uma tab do Plasmo — a build gera `tabs/report.html` + `tabs/report.*.js|css`. Lê `?date=YYYY-MM-DD` (só aceita o formato, via regex), cai para `loadLatestReportRef()` sem data e, quando não há relatório, mostra um estado vazio explicando o fluxo do widget. Renderiza com `Wordmark` + `registerBrandFont()` e o tema claro/escuro do `useTheme` (classe `dark` na raiz, como o painel); as seções saem de `reportSections`/`reportMetrics` (Resumo geral, Acertos, Erros / padrões a evitar, Melhorias, Pendências para amanhã, Métricas do dia), sem duplicar títulos. O cabeçalho ganhou `formatTimestamp`, recém-exportado de `~lib/report/format` para a página e o `buildStandaloneHtml` mostrarem o mesmo instante. O CSS de impressão A4 vai embutido na página (`.no-print`, sem fundo preto no papel) e já deixa o lugar dos botões de exportação da próxima tarefa.
>
> **Verificação:** `corepack pnpm typecheck` → exit 0; `corepack pnpm test` → **217/217**; `corepack pnpm build` → `tabs/report.html` presente; `corepack pnpm check:bundle` → 20/20 OK (rodei com um `.env` temporário só com a chave de fumaça, removido em seguida; o script lê `.env` e exige a chave). `pnpm` não está no PATH deste shell — usei `corepack pnpm`. Observação: o Plasmo renomeou o `web_accessible_resources` do woff2 compartilhado de `companion.*.woff2` para `tabs/report.*.woff2` (a fonte é embutida em base64; o arquivo não é emitido), o mesmo comportamento de antes, sem regressão de build.

- [x] Adicionar as ações de exportação na página do relatório:
  - Botão "Imprimir / Salvar PDF" chamando `window.print()`, com `@media print` escondendo botões/navegação e ajustando margens e cores (evitar fundo preto no papel).
  - Botão "Baixar HTML" gerando um `Blob` de `buildStandaloneHtml(stored)` e disparando o download via link `URL.createObjectURL` + `a[download]`, revogando a URL depois.
  - Botão "Copiar JSON" (opcional, útil para depurar) copiando o relatório serializado com `navigator.clipboard.writeText`.

> **Barra de exportação entregue (2026-10-07).** `src/tabs/report.tsx` ganhou o componente `ExportActions`, montado logo abaixo do cabeçalho e **apenas** quando há relatório carregado (`state.kind === "ready"`), dentro do bloco `no-print` — o `@media print` que já existia na página esconde a barra inteira no papel, então o PDF/impressão sai só com cabeçalho, resumo, seções, métricas e rodapé. Os três botões:
>
> - **Imprimir / Salvar PDF** (primário, vermelho da marca) chama `window.print()`; as margens A4 e a remoção do fundo preto já vinham do `PRINT_STYLE` da tarefa anterior.
> - **Baixar HTML** (secundário) monta `new Blob([buildStandaloneHtml(stored)], { type: "text/html;charset=utf-8" })` e dispara o download por um `<a download>` temporário (`downloadBlob`), com `URL.revokeObjectURL` 1 s depois do clique — revogar na hora pode salvar arquivo vazio. O nome vem de `reportFileName(stored.date)`.
> - **Copiar JSON** (secundário) copia `JSON.stringify(stored, null, 2)` com `navigator.clipboard.writeText`, confirma com "Copiado!" (ícone de check) por 2 s e mostra "Não foi possível copiar" quando o clipboard está bloqueado/indisponível — sem quebrar a página.
>
> Ícones de Feather (impressora, download, cópia e check) em SVG inline, no mesmo estilo do `ThemeToggle`. Os botões reaproveitam as classes Tailwind do projeto (`bg-brand`/`hover:bg-brand-dark` e `border-line bg-surface text-fg`).
>
> **Verificação:** `corepack pnpm typecheck` → exit 0; `corepack pnpm test` → **217/217** (nenhum teste novo nesta tarefa; os testes de `report-format` são a tarefa `tests/report-format.test.ts`). A build/`check:bundle` fica para a tarefa de validação final da fase.

- [x] Adicionar o botão "Encerrar o dia" no `src/components/DayWidget.tsx`:
  - Ficará desabilitado (com dica) quando não houver nenhuma conversa acompanhada no dia; caso contrário, ao clicar: monta `buildReportInput(day, now)`, chama `sendToBackground<GenerateReportRequest, GenerateReportResponse>({ name: "generate-report", body })`, e em caso de sucesso salva com `saveReport` e abre `chrome.tabs.create({ url: chrome.runtime.getURL(`tabs/report.html?date=${date}`) })`.
  - Estados visíveis de carregamento e erro no próprio widget, reaproveitando o `Spinner` de `src/components/Spinner.tsx`; erros de IA mostram a mensagem devolvida no `AiResult` sem quebrar o widget.
  - Exibir custo da geração quando `config.showCosts` (dev), reaproveitando `CostPanel`/`formatUsd`.

> **Botão "Encerrar o dia" entregue (2026-10-07).** `src/components/DayWidget.tsx` ganhou um rodapé (fora da lista que rola) com o botão primário da marca e os estados do fluxo. Ele fica desabilitado enquanto `buildReportInput(day, now).conversations.length === 0` (com a dica no `title`) — a checagem é a mesma que filtra o payload, então um dia só com registros "sem mensagem" não gasta uma chamada de IA à toa — e, no clique, monta o payload com a hora do clique, chama `generate-report` pelo `sendToBackground`, guarda o `StoredReport` com `saveReport` e só então abre a página. Estados: **"Gerando relatório…"** com o `Spinner` (e `aria-busy`), erro da IA no `role="alert"` com a mensagem do `AiResult` (o botão volta a ficar disponível para nova tentativa) e o aviso de sucesso — "Relatório de <data> aberto em uma nova aba.", ou "salvo, mas a página não abriu" quando a aba falha. No dev (`config.showCosts`), o `CostPanel` aparece no rodapé depois do sucesso, como no painel lateral.
>
> **Desvio necessário — abrir a aba passa pelo background.** `chrome.tabs` **não existe no content script** (só `runtime`/`storage`/`i18n`/`dom` chegam lá — <https://developer.chrome.com/docs/extensions/reference/api/tabs>), e o widget roda no shadow DOM da página do Botconversa; `window.open` para uma página da extensão também é bloqueado. Por isso a nova rota `src/background/messages/open-report.ts` recebe `{ date }` e faz o `chrome.tabs.create({ url: chrome.runtime.getURL("tabs/report.html?date=…") })` no service worker — o mesmo efeito pedido na tarefa, no único lugar onde a API existe. A rota não exige `web_accessible_resources` (quem navega é a própria extensão) nem a permissão `tabs`. A data é validada com `/^\d{4}-\d{2}-\d{2}$/` e cai para `tabs/report.html` sem `?date=` quando fora do formato. A rota foi declarada em `src/types/plasmo-messaging.d.ts` e os tipos em `src/lib/messages.ts` (`OPEN_REPORT`/`OpenReportRequest`/`OpenReportResponse`).
>
> **Verificação:** `corepack pnpm typecheck` → exit 0; `corepack pnpm test` → **221/221** (4 novos testes em `tests/open-report.test.ts`: URL com `?date=`, data inválida, corpo ausente e falha do navegador); `corepack pnpm build` → `open-report`/`generate-report` presentes no service worker e `Encerrar o dia` no bundle do content script; `corepack pnpm check:bundle` → **20/20**, com "content script executa sem erro" verde (rodei a build com um `.env` temporário só com a chave de fumaça, removido em seguida, como na tarefa anterior). `README.md` fica para a fase 05, que já tem a tarefa de documentação do recurso.

- [x] Registrar no `src/background/index.ts` (ou onde os handlers são carregados) o novo handler de mensagem, se a convenção do Plasmo exigir, e confirmar que `generate-report` é alcançável a partir do content script sem expor a chave da API.
  - Verificar junto de `src/background/messages/review-draft.ts` como o `@plasmohq/messaging` descobre o handler e replicar exatamente; ajustar o manifesto se algum `web_accessible_resources`/permissão for necessário para abrir `tabs/report.html` a partir do content script (`chrome.runtime.getURL` não exige `tabs`).

> **Verificação concluída (2026-10-07): não há handler para registrar.** O `@plasmohq/messaging` descobre cada rota pelo **nome do arquivo** em `src/background/messages/` (é o caso de `review-draft`, `generate-report` e `open-report`): o `src/background/index.ts` continua com duas linhas (importa `./coach-port` e configura o `sidePanel`), sem tabela de rotas. O Plasmo gera a lista em `.plasmo/messaging.d.ts` (`generate-report`, `open-report`, `review-draft`) e o bundle de produção traz as três rotas em `static/background/index.js`; a única declaração que o repo mantém à mão é a de `src/types/plasmo-messaging.d.ts`, porque `.plasmo/` é gerado/ignorado e o `pnpm typecheck` num clone limpo precisa dos nomes.
>
> **Manifesto:** nenhuma permissão ou `web_accessible_resources` novo. `chrome.tabs` só é usado no `open-report.ts`, que roda no service worker, então a build segue com `permissions: ["sidePanel", "storage"]` e sem a permissão `tabs` — o `tabs/report.html` é aberto pela própria extensão (`chrome.runtime.getURL` + `chrome.tabs.create`), não pela página do Botconversa, então não precisa constar em `web_accessible_resources` (o que aparece lá é só o woff2 compartilhado).
>
> **Confirmação automatizada:** `scripts/check-bundle.mjs` ganhou uma checagem que entrega `{ name: "generate-report", body: { report } }` aos listeners do service worker de produção (o mesmo caminho de `sendToBackground` do widget) com um relatório diário falso, provando que a rota responde com um `DailyReport` validado; o teste do content script agora também confere que o bundle referencia `generate-report`/`open-report`. `corepack pnpm build` + `corepack pnpm check:bundle` → **23/23 OK**, com “chave só no background”, “generate-report responde (ok)” e “content script referencia as rotas generate-report/open-report” verdes (build de fumaça com `.env` temporário só com `PLASMO_PUBLIC_OPENROUTER_API_KEY`, removido em seguida, como nas tarefas anteriores).

- [ ] Escrever `tests/report-format.test.ts`:
  - `formatDuration` e `formatDayLabel` nos casos comuns e nos extremos (0 ms, 59 s, mais de 1 h).
  - `escapeHtml` neutralizando `<`, `>`, `&` e aspas.
  - `buildStandaloneHtml` contendo as seções e os textos do relatório e escapando um texto malicioso (`<script>`) sem vazá-lo como markup.
  - `reportFileName` estável para uma data fixa.

- [ ] Rodar `pnpm test`, `pnpm typecheck` e `pnpm build`, corrigindo as falhas; em seguida rodar `pnpm check:bundle` para garantir que a nova tab e o novo handler não quebram a build de produção (o Plasmo pode descartar código no tree-shaking, como o README alerta).
