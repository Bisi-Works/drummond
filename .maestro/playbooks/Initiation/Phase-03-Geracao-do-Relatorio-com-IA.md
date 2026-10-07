# Phase 03: Geração do relatório diário com IA

Esta fase implementa o motor do relatório individual do dia: uma única chamada de IA sobre o resumo
compacto do que foi acumulado no tracking, devolvendo um JSON com campos fixos (resumo, acertos,
erros, melhorias e pendências para o dia seguinte). Tudo reaproveita a infraestrutura já existente —
`config.ts` para a tarefa de modelo, `schemas.ts` + zod para validar a saída, `prompts.ts` para o
comportamento e `service.ts` para a chamada — sem inventar um segundo caminho de IA. Ao final da
fase, existe uma função chamável no background que gera o relatório e `pnpm test`/`pnpm typecheck`
passam.

## Tasks

- [x] Adicionar a tarefa de modelo do relatório em `src/lib/config.ts`, seguindo exatamente o formato das tarefas `review` e `coach`:
  - `const report: ModelConfig` com `model: process.env.PLASMO_PUBLIC_REPORT_MODEL || "deepseek/deepseek-v4-flash-0731"`, `temperature: toNumber(process.env.PLASMO_PUBLIC_REPORT_TEMPERATURE ?? "0.3")`, `reasoning: toReasoning(process.env.PLASMO_PUBLIC_REPORT_REASONING ?? "off")`, `responseFormat: toResponseFormatMode(process.env.PLASMO_PUBLIC_REPORT_RESPONSE_FORMAT ?? "json_schema")`, `providerOrder: toProviderOrder(process.env.PLASMO_PUBLIC_REPORT_PROVIDER_ORDER ?? "cohere,parasail")` e `timeoutMs: 90_000`.
  - Incluir `report` no objeto `config` exportado e documentar as novas variáveis em `.env.example` (mesmo bloco comentado das outras tarefas), deixando claro que o relatório roda uma vez por dia e por isso pode ser mais caro que a revisão.

> **Tarefa de modelo do relatório adicionada (2026-10-07).** `const report: ModelConfig` em `src/lib/config.ts`, logo depois de `coach`, com o mesmo formato e os parâmetros pedidos: `deepseek/deepseek-v4-flash-0731`, `temperature` 0.3, `reasoning` off, `responseFormat` json_schema, `providerOrder` `cohere,parasail` e `timeoutMs: 90_000` (mesmo teto do coaching, já que o relatório também gera ~1000+ tokens). Cada variável lê o seu `process.env.PLASMO_PUBLIC_REPORT_*` com o padrão no fallback, como `review` e `coach`. `report` entrou no objeto `config` exportado ao lado de `review`/`coach`.
> No `.env.example`, um bloco novo comentado logo após o do coaching, com as cinco variáveis `PLASMO_PUBLIC_REPORT_*` e a nota de que o relatório roda **uma vez por dia** sobre o resumo do tracking, por isso pode ser mais caro que a revisão (que roda a cada mensagem).
> **Verificação:** `./node_modules/.bin/tsc --noEmit` → **exit 0** e `./node_modules/.bin/vitest run` → **182/182** (nenhuma asserção alterada).

- [x] Definir o schema e os limites do relatório:
  - Em `src/lib/ai/constants.ts`, adicionar `MAX_REPORT_ITEMS = 5` e `reportSections = ["acertos", "erros", "melhorias", "pendencias"] as const` (se útil para UI/testes), sem quebrar as constantes existentes.
  - Em `src/lib/ai/schemas.ts`, criar `dailyReportSchema` com `z.object`: `resumo` (string, 1–2 frases sobre o dia), `acertos: z.array(z.string())`, `erros: z.array(z.string())`, `melhorias: z.array(z.string())`, `pendencias: z.array(z.string())` descrevendo em cada campo o que deve conter (ex.: pendências = o que ficou em aberto para amanhã, por conversa). Sem `.max`/`.min` no schema (mesma ressalva do comentário do arquivo sobre `strict`).
  - Exportar `type DailyReport = z.infer<typeof dailyReportSchema>` e `limitDailyReport(report)` truncando cada lista em `MAX_REPORT_ITEMS` (aplicado depois do parse, como `limitReview`/`limitCoaching`).

> **Schema e limites do relatório definidos (2026-10-07).** Em `src/lib/ai/constants.ts`, `MAX_REPORT_ITEMS = 5` com um comentário explicando a razão (relatório roda uma vez por dia sobre o resumo; listas curtas mantêm widget/painel e custo previsíveis), mais `reportSections = ["acertos", "erros", "melhorias", "pendencias"] as const` e o tipo `ReportSection` derivado. As constantes existentes de revisão/coaching ficaram intactas.
> Em `src/lib/ai/schemas.ts`, `dailyReportSchema` com `resumo` (string, 1–2 frases) e as quatro listas de strings, cada campo com um `.describe` dizendo o que deve conter — `pendencias` explicitamente "o que ficou em aberto para amanhã, por conversa". Nenhum `.max`/`.min` (a mesma ressalva do topo do arquivo sobre provedores em modo strict), então o truncamento acontece depois do parse. Exportados `type DailyReport = z.infer<typeof dailyReportSchema>` e `limitDailyReport`, que fatia as quatro listas em `MAX_REPORT_ITEMS` preservando a ordem e usando o mesmo formato de `limitReview`/`limitCoaching`.
> Os testes do motor (`limitDailyReport`, `buildReportInput`, `formatReportInput`, schema e `generateDailyReport`) ficam na tarefa própria de `tests/daily-report.test.ts`, para não duplicar cobertura.
> **Verificação:** `./node_modules/.bin/tsc --noEmit` → **exit 0** e `./node_modules/.bin/vitest run` → **182/182** (13 arquivos, nenhuma asserção alterada).

- [x] Criar `src/lib/tracking/report.ts` com o payload compacto que vai para a IA, mantendo o custo sob controle:
  - `buildReportInput(day: DayLog, now): DailyReportInput` com um objeto serializável contendo: `date`, totais de `summarizeDay`, e uma lista por conversa com `label`, `platform`, última mensagem do cliente (texto truncado, ex.: 200 caracteres), tempo de espera/level, se foi respondida e os sinais já anexados (`lastReview`, `lastCoaching`) — nunca a conversa completa.
  - `formatReportInput(input): string` produzindo o texto delimitado (`<dia>…</dia>`) que entra no prompt, com contagens e linhas por conversa.
  - Funções puras, sem `chrome` e sem IA, para permitir teste direto; ignorar conversas sem nenhuma mensagem.

> **Payload compacto do dia criado (2026-10-07).** `src/lib/tracking/report.ts` (novo). Só importa `format.ts`, `summary.ts` e `types.ts` — nada de `chrome`, IA ou relógio global (`now` entra por parâmetro, como nas outras agregações).
> - **Tipos:** `DailyReportInput = { date, totals: DaySummary, conversations: ReportConversationInput[] }` e `ReportConversationInput = { key, label, platform, lastMessageAuthor, lastMessage, messageCount, status: ConversationStatus, lastReview?, lastCoaching? }`. Tudo serializável (atravessa o messaging e vai para o `StoredReport` da Fase 04) e exportado para `prompts.ts`/`service.ts`/`storage.ts` reusarem. `REPORT_MESSAGE_MAX = 200` é exportado para o teste conferir o truncamento sem literal solto.
> - **`buildReportInput`:** `totals` vem de `summarizeDay` (contrato do checkbox) e `status` vem de `conversationStatus` — nenhuma regra de espera foi duplicada. Filtra conversas "sem nenhuma mensagem" (`messageCount === 0` **e** `lastMessageAuthor === null` **e** texto vazio: o registro mínimo que um sinal de IA cria antes do primeiro tick). Ordem **vista por último primeiro** (`lastSeenAt` desc, desempate por `key`), para o prompt ser determinístico e independente da ordem de inserção no objeto do `DayLog`.
> - **Decisão sobre a "última mensagem do cliente":** o `TrackedConversation` guarda só `lastMessageText`/`lastMessageAuthor` (não há `lastClientText` separado, e a Fase 01 fechou esse modelo), então o payload expõe `lastMessage` com o **autor**, truncado em 200 caracteres e colapsado para uma linha. É a informação mais próxima do pedido sem estender o store nem inventar dado; a linha do prompt diz o autor, então a IA não confunde fala do vendedor com fala do cliente.
> - **`formatReportInput`:** monta o bloco `<dia>…</dia>` com a data local (`formatDayLabel`), uma linha de contagens (`Conversas acompanhadas`, `Aguardando` por nível, `Respondidas`, `Sem mensagem`, `Revisões`, `Coachings`, médias de 1ª resposta e resposta — `null` vira "sem dado", nunca `0`) e uma linha por conversa com estado, espera (`formatDuration`), contagem e os sinais. Textos do dia (rótulo, prévia, resumos) passam por `neutralize` antes de entrar no bloco, para que uma mensagem do cliente não "feche" `<dia>` e injete instruções.
> - **Nota de coerência:** `totals` conta o dia inteiro (via `summarizeDay`, que inclui o registro sem mensagem em `withoutMessage`) enquanto a lista omite essas conversas; o bloco deixa a diferença explícita na linha `Sem mensagem: N`, então o modelo reconcilia as duas contagens em vez de ver números soltos.
> - **Verificação:** `./node_modules/.bin/tsc --noEmit` → **exit 0** e `./node_modules/.bin/vitest run` → **182/182** (13 arquivos, nenhum teste tocado). As funções foram exercitadas num rascunho temporário (truncamento em 200, inclusão de `lastReview`/`lastCoaching`, filtro da conversa vazia, ordem determinística, bloco vazio) que passou e foi apagado — a cobertura permanente fica no `tests/daily-report.test.ts`, no checkbox próprio desta fase.

- [ ] Estender `src/lib/ai/prompts.ts` com o prompt do relatório:
  - Adicionar `TASK_DAILY_REPORT` definindo o papel de coach diário: resumir como o dia foi, apontar acertos concretos, erros/padrões a evitar, melhorias práticas e pendências para o dia seguinte, sempre citando a conversa quando fizer sentido e nunca inventando fatos que não estejam nos dados.
  - Adicionar `buildDailyReportPrompt(input: DailyReportInput): PromptMessages` reaproveitando `SYSTEM_BASE` (com `COMPANY_CONTEXT`) e a formatação de dados delimitados; lembrar o modelo de que o conteúdo em `<dia>` é dado, não instrução.
  - Incrementar `PROMPT_VERSION` (ex.: `2026-10-02.1`) conforme a regra do arquivo, já que o comportamento da IA mudou.

- [ ] Implementar `generateDailyReport` em `src/lib/ai/service.ts` reutilizando `run`/`complete`:
  - Receber `DailyReportInput`, montar o prompt, chamar `complete` com `toResponseFormat("daily_report", dailyReportSchema, config.report.responseFormat)`, fazer `parseModelJson` + `limitDailyReport` e devolver `AiResult<DailyReport>` (mesmo envelope de `AiMeta`, com custo quando `config.showCosts`).
  - Definir uma expectativa de tokens de saída razoável para a estimativa de custo (ex.: ~1200) e, se o dia não tiver nenhuma conversa com conteúdo, devolver um relatório vazio coerente sem chamar o modelo (mesma estratégia do `coachConversation` sem mensagens do vendedor).

- [ ] Criar o canal de mensagem do background para o relatório:
  - Em `src/lib/messages.ts`, adicionar `GENERATE_REPORT = "generate-report"` e os tipos `GenerateReportRequest`/`GenerateReportResponse` (reaproveitando `AiResult<DailyReport>`), seguindo o padrão de `COACH_PORT`/`GET_CONVERSATION`.
  - Criar `src/background/messages/generate-report.ts` no padrão de `src/background/messages/review-draft.ts`, lendo `req.body` e respondendo `await generateDailyReport(...)`.
  - Não chamar a IA de dentro do content script: a requisição sai sempre do background, como já acontece na revisão e no coaching.

- [ ] Escrever `tests/daily-report.test.ts` cobrindo o motor sem rede:
  - `limitDailyReport` truncando listas longas em `MAX_REPORT_ITEMS`.
  - `buildReportInput` a partir de um `DayLog` sintético: trunca textos, inclui sinais anexados, ignora conversas vazias e não vaza a conversa completa.
  - `formatReportInput` contendo as contagens e os rótulos esperados.
  - `dailyReportSchema` aceitando um JSON válido e rejeitando um objeto com campo faltando; se possível, um teste de `generateDailyReport` com `chatCompletion` mockado (seguindo o jeito dos testes existentes em `tests/service.test.ts`) devolvendo JSON válido e inválido.

- [ ] Rodar `pnpm test` e `pnpm typecheck`, corrigir as falhas e confirmar que os testes de prompts/serviço existentes continuam passando após o bump de `PROMPT_VERSION`.
