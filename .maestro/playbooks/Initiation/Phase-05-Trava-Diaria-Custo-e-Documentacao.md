# Phase 05: Trava de 1 relatório por dia, custo e endurecimento final

Última fase do Playbook: protege o uso em produção limitando a geração do relatório a uma vez por dia
por vendedor (em dev fica livre para testes), mostra o custo da geração no dev, cobre os casos de
borda (dia vazio, falha da IA, extensão recarregada) e documenta a arquitetura do que foi construído.
O objetivo é deixar o recurso pronto para os ~15 vendedores que já usam a extensão diariamente, sem
risco de gasto descontrolado nem de tela quebrada quando algo falha.

## Tasks

- [x] Implementar a trava diária em `src/lib/report/storage.ts` e `src/lib/config.ts`:
  - Adicionar `REPORT_GENERATED_PREFIX = "drummond.report.generated."` com `loadReportGeneration(date)` retornando `{ generatedAt: number, count: number } | null`, `markReportGenerated(date)` (grava no sucesso) e `clearReportGeneration(date)`.
  - Em `config.ts`, expor `reportLimitPerDay: toNumber(process.env.PLASMO_PUBLIC_REPORT_LIMIT_PER_DAY) ?? 1` e `reportUnlimited: process.env.NODE_ENV === "development" || process.env.PLASMO_PUBLIC_REPORT_UNLIMITED === "true"`; documentar as duas variáveis em `.env.example`.
  - Criar `canGenerateReport(date, now)` combinando a contagem com o limite, considerando `reportUnlimited` e a virada de dia via `dayKey` (um relatório gerado ontem não bloqueia hoje).
  - _Feito: storage com normalizador `toReportGeneration` (silencioso sem `chrome.storage`), `markReportGenerated` somando `count`; `canGenerateReport` libera no dev/past-unlimited e renova a cota quando `dayKey(now) !== date`. `.env.example` ganhou `PLASMO_PUBLIC_REPORT_LIMIT_PER_DAY` e `PLASMO_PUBLIC_REPORT_UNLIMITED` (default `false`). Coberto em `tests/report-storage.test.ts` (238 testes passando, `tsc --noEmit` limpo)._

- [ ] Aplicar a trava no fluxo de geração do widget (`src/components/DayWidget.tsx`):
  - Antes de chamar o background, checar `canGenerateReport(date)`. Se bloqueado, não disparar request: mudar o botão para "Relatório de hoje já gerado" com uma ação secundária "Abrir relatório" (usa `saveReport`/`loadReport` da data para montar a URL da tab).
  - Só chamar `markReportGenerated` depois de um `ok: true`; falha da IA não consome a cota do dia.
  - Em dev (`config.showCosts`), mostrar um botão "Gerar novamente" que limpa a marca com `clearReportGeneration` para permitir repetir os testes.
  - Deixar claro no texto do widget quando a cota do dia foi usada, sem depender de diálogo do usuário.

- [ ] Endurecer os casos de borda do fluxo e da página:
  - Dia sem conversas: o botão fica desabilitado com dica; se por algum caminho a geração for chamada, o `generateDailyReport` devolve o relatório vazio local (sem request) e a página renderiza um estado coerente.
  - IA fora do formato/erro de rede: mostrar a mensagem de `AiResult.error` na UI, manter o botão disponível para nova tentativa (quando não houver cota consumida) e nunca deixar a tab de relatório aberta sem conteúdo — a página deve tratar `loadReport` nulo com estado vazio.
  - Extensão recarregada com a página aberta: garantir que `chrome.storage` indisponível não gere exceção não tratada nem em `store.ts` nem em `report/storage.ts`, mantendo o padrão de fallback silencioso.
  - Sessão que atravessa a meia-noite: garantir que o widget e a tab usem `dayKey()`/data de parâmetro corretos e não misturem relatórios de dias diferentes.

- [ ] Exibir o custo da geração do relatório no dev, reaproveitando a infraestrutura existente:
  - Garantir que `generateDailyReport` retorne `meta.cost` (estimativa + efetivo) quando `config.showCosts`, do mesmo jeito que `reviewDraft`/`coachConversation`.
  - Na página `src/tabs/report.tsx`, mostrar um bloco discreto "Custo desta geração · dev" com `CostPanel` apenas quando `config.showCosts`, e nada em produção (o `check:bundle` já valida que o caminho de custo não roda em prod).

- [ ] Ampliar os testes para cobrir a trava e a robustez:
  - `canGenerateReport`: permitido sem registro, bloqueado após `markReportGenerated` em prod, permitido quando `reportUnlimited`, e um dia novo liberado.
  - Falha da IA não marca a geração (simular `ok: false` e conferir que `loadReportGeneration` continua nulo).
  - Round-trip de `saveReport`/`loadReport`/`listReportDates` com stub de `chrome.storage.local`, incluindo relatório ausente devolvendo `null`.
  - Caso de borda do dia vazio em `buildReportInput`/`generateDailyReport` (sem conversas).

- [ ] Documentar a arquitetura em `docs/architecture/tracking-e-relatorio-diario.md`, em Markdown estruturado:
  - Front matter YAML com `type: reference`, `title`, `created` (data de hoje), `tags: [tracking, relatorio, arquitetura, botconversa]` e `related: ['[[Alertas-e-Metricas-do-Dia]]', '[[Relatorio-Diario]]']`.
  - Explicar o fluxo: adapter → `useDayTracking` → `chrome.storage` por dia → widget/painel → `generate-report` → JSON validado → tab HTML → PDF.
  - Registrar as decisões e as limitações conhecidas (só chats abertos, `time` sem data, espera ancorada em `clientSince`, 1 geração/dia em prod) e o caminho para preencher `company-context.ts` quando o time quiser mais precisão.
  - Criar também `docs/architecture/alertas-e-metricas-do-dia.md` e `docs/architecture/relatorio-diario.md` com front matter e links `[[Tracking-e-Relatorio-Diario]]`, mantendo o grafo navegável (wiki-links conforme a convenção do projeto).

- [ ] Atualizar o `README.md` com uma seção curta do novo recurso (tracking local do dia, alertas de tempo de resposta, relatório diário com trava de 1x/dia e exportação em PDF), apontando as variáveis de ambiente novas e a página `tabs/report.html`; ajustar a tabela "Onde ajustar" com os novos arquivos (`src/lib/tracking/`, `src/lib/report/`, `src/tabs/report.tsx`).

- [ ] Rodar a verificação completa `pnpm verify` (testes, typecheck, build e `check:bundle`) e corrigir qualquer falha. Ao final, garantir que a build de produção não embute custo nem permite mais de uma geração por dia, e que a página do relatório e o widget continuam funcionando na build de dev.
