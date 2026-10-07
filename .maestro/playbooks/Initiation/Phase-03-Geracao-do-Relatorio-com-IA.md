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

- [ ] Definir o schema e os limites do relatório:
  - Em `src/lib/ai/constants.ts`, adicionar `MAX_REPORT_ITEMS = 5` e `reportSections = ["acertos", "erros", "melhorias", "pendencias"] as const` (se útil para UI/testes), sem quebrar as constantes existentes.
  - Em `src/lib/ai/schemas.ts`, criar `dailyReportSchema` com `z.object`: `resumo` (string, 1–2 frases sobre o dia), `acertos: z.array(z.string())`, `erros: z.array(z.string())`, `melhorias: z.array(z.string())`, `pendencias: z.array(z.string())` descrevendo em cada campo o que deve conter (ex.: pendências = o que ficou em aberto para amanhã, por conversa). Sem `.max`/`.min` no schema (mesma ressalva do comentário do arquivo sobre `strict`).
  - Exportar `type DailyReport = z.infer<typeof dailyReportSchema>` e `limitDailyReport(report)` truncando cada lista em `MAX_REPORT_ITEMS` (aplicado depois do parse, como `limitReview`/`limitCoaching`).

- [ ] Criar `src/lib/tracking/report.ts` com o payload compacto que vai para a IA, mantendo o custo sob controle:
  - `buildReportInput(day: DayLog, now): DailyReportInput` com um objeto serializável contendo: `date`, totais de `summarizeDay`, e uma lista por conversa com `label`, `platform`, última mensagem do cliente (texto truncado, ex.: 200 caracteres), tempo de espera/level, se foi respondida e os sinais já anexados (`lastReview`, `lastCoaching`) — nunca a conversa completa.
  - `formatReportInput(input): string` produzindo o texto delimitado (`<dia>…</dia>`) que entra no prompt, com contagens e linhas por conversa.
  - Funções puras, sem `chrome` e sem IA, para permitir teste direto; ignorar conversas sem nenhuma mensagem.

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
