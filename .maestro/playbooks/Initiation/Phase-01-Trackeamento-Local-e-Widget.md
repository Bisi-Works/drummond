# Phase 01: Trackeamento local do dia + widget flutuante (protótipo funcional)

Esta fase entrega a fundação de todo o Playbook: um registro local (em `chrome.storage.local`) das
conversas que o vendedor abriu no Botconversa ao longo do dia, com os sinais que a extensão já
produz (Revisar / Analisar) anexados a cada conversa — sem nenhuma chamada de IA nova. Em cima disso
nasce o primeiro protótipo visível: um widget flutuante arrastável, injetado pelo content script,
que lista as conversas do dia e pinta um chip de tempo de resposta (verde → vermelho) conforme o
tempo desde a última mensagem do cliente. Ao final, `pnpm test` e `pnpm typecheck` passam e o widget
aparece de verdade na página do Botconversa. Nenhuma decisão do usuário é necessária nesta fase.

<!-- MAESTRO:MODEL tier="high" effort="high" reason="O módulo de tracking precisa acertar virada de dia, sincronização entre abas e cálculo de espera a partir de horários sem data; um erro aqui contamina relatório e alertas, então vale o modelo mais forte pensando com cuidado." -->

## Tasks

- [x] Fazer um reconhecimento rápido e reutilizável do que já existe, registrando os padrões a seguir: leia `src/lib/theme.ts` e `src/hooks/useTheme.ts` (padrão de persistência + reatividade em `chrome.storage.local` e `onChanged`), `src/hooks/useComposerState.ts` (polling leve do DOM do Botconversa), `src/adapters/types.ts` e `src/adapters/botconversa.ts` (formato de `ChatMessage`, `time` com prefixo de dia, `getConversationKey`), `src/contents/companion.tsx` (injeção em shadow DOM, `useTheme`, guard de `composer`/`frame`), `vitest.config.mts` e `tests/theme.test.ts` (alias `~` e estilo de teste). Não crie nenhum arquivo nesta tarefa; só confirme no seu contexto interno onde cada peça nova deve se encaixar. <!-- MAESTRO:MODEL tier="low" effort="low" reason="É apenas leitura e mapeamento de arquivos existentes, sem decisão de design ou risco de regressão." -->

> **Reconhecimento concluído (2026-10-07).** Pontos de encaixe confirmados:
> - **Persistência/reatividade:** `src/lib/theme.ts` + `src/hooks/useTheme.ts` são o modelo para o tracking — chave em `chrome.storage.local`, fallback silencioso quando não há storage, e `chrome.storage.onChanged` filtrado por `area === "local"`.
> - **Polling leve:** `src/hooks/useComposerState.ts` usa `setInterval` + resize/scroll/input e compara estado para evitar re-render. `useDayTracking` deve seguir o mesmo formato (intervalo próprio, cleanup de intervalo e listeners).
> - **Contrato do adapter:** `ChatAdapter` (`src/adapters/types.ts`) expõe `id`, `getConversationKey()` e `readConversation(limit: number): ChatMessage[]`. `ChatMessage.time` é uma string `"<dia> HH:MM"` (adição de dia em `readBotconversaConversation`), **sem data** — por isso a espera se apoia em `clientSince`, não no `time`.
> - **Injeção:** `src/contents/companion.tsx` monta em shadow DOM, usa `useTheme` (só leitura), `getStyle` com `:host(plasmo-csui)`, e hoje sai cedo com `if (!adapter || !composer || !frame) return null` — é esse guard que a Fase 01 vai dividir.
> - **Testes:** `vitest.config.mts` (ambiente apenas de alias `~` → `src`; testes são `tests/**/*.test.ts`) e `tests/theme.test.ts` mostram o estilo: funções puras, `describe`/`it` em português, sem rede.
> - **Sinais de IA a anexar:** `runReview` em `companion.tsx` recebe `ReviewDraftResponse`; o side panel conclui via `requestCoaching`, e `GetConversationResponse` já carrega `conversationKey` (hoje descartado no `sidepanel.tsx`).

- [x] Criar `src/lib/tracking/types.ts` e `src/lib/tracking/constants.ts` com o modelo do dia e as regras fixas de tempo de resposta:
  - Tipos: `WaitLevel = "verde" | "amarelo" | "laranja" | "vermelho"`; `TrackedConversation` com `key`, `platform`, `label`, `openedAt`, `lastSeenAt`, `lastMessageAuthor: ChatAuthor | null`, `lastMessageText`, `lastMessageAt: number | null`, `clientSince: number | null`, `messageCount`, `reviewCount`, `lastReview?: { status, summary, at }`, `lastCoaching?: { summary, nextStep, at }`; `DayLog` com `date: string` (YYYY-MM-DD local), `conversations: Record<string, TrackedConversation>`, `updatedAt: number`.
  - Constantes: `WAIT_LIMITS_MS = { amarelo: 6*60_000, laranja: 12*60_000, vermelho: 18*60_000 }` (verde abaixo do primeiro limite; vermelho a partir do último, sem teto), `DAY_LOG_PREFIX = "drummond.dayLog."`, `WIDGET_POSITION_KEY = "drummond.widgetPosition"`, `WIDGET_POSITION_VERSION = 1`.
  - Funções puras exportadas aqui mesmo ou em `src/lib/tracking/level.ts`: `dayKey(at = new Date()): string` usando data LOCAL (não `toISOString`, que usa UTC e erra a virada de dia no Brasil); `waitLevel(elapsedMs: number): WaitLevel` com verde `<= 6min`, amarelo `<= 12min`, laranja `<= 18min`, vermelho acima de 18min; `waitElapsed(conversation, now)` retornando `null` quando a conversa não está aguardando.
  - Comentários curtos em português, no mesmo estilo do restante do projeto, explicando que `time` do adapter só traz "HH:MM" (com prefixo de dia) sem data e por isso o cálculo de espera se apoia em `clientSince`.

> **Modelo do dia criado (2026-10-07).** `src/lib/tracking/types.ts`, `src/lib/tracking/constants.ts` e `src/lib/tracking/level.ts`:
> - **Tipos** (`types.ts`): `WaitLevel`, `TrackedReviewSignal` (`status: "ok" | "ajustes"`, alinhado ao `DraftReview`), `TrackedCoachingSignal`, `TrackedConversation` e `DayLog` exatamente com os campos da tarefa. `lastMessageAt` é documentado como o epoch ms em que a mensagem foi observada (não o `time` do adapter, que não tem data).
> - **Constantes** (`constants.ts`): `WAIT_LIMITS_MS` (6/12/18 min), `DAY_LOG_PREFIX`, `WIDGET_POSITION_KEY` e `WIDGET_POSITION_VERSION`.
> - **Funções puras** (`level.ts`, opção prevista na tarefa): `dayKey` (data LOCAL, com `padStart`, sem `toISOString`), `waitLevel` (verde ≤ 6, amarelo ≤ 12, laranja ≤ 18, vermelho acima) e `waitElapsed` (`null` quando `clientSince` é `null`).
> - **Verificação:** `pnpm test` → 99/99 passam. `pnpm typecheck` aponta **um erro pré-existente** em `src/contents/companion.tsx:104` (`sendToBackground` tipa a resposta como `never`), sem relação com os arquivos novos — fica para a última tarefa da fase, que pede o typecheck limpo.

- [ ] Criar `src/lib/tracking/store.ts` com a persistência e os redutores puros do dia:
  - `loadDay(date = dayKey())`, `saveDay(day)`, `clearDay(date)` lendo/escrevendo `chrome.storage.local` na chave `${DAY_LOG_PREFIX}${date}`, com fallback silencioso (retorno de um `DayLog` vazio) quando `chrome?.storage` não existir ou a leitura falhar — o content script pode rodar com a extensão recém-recarregada.
  - `observeConversation(prev: DayLog, input)`: faz upsert por `key`, atualiza `lastSeenAt`, `messageCount`, `lastMessageAuthor/Text`, `platform` e `label`; quando a última mensagem é do cliente e `clientSince` era `null`, grava `clientSince = now`; quando a última mensagem é do vendedor, zera `clientSince` (não está mais aguardando). Nunca regride `openedAt`.
  - `attachReview(prev, key, signal)` e `attachCoaching(prev, key, signal)`: anexam os sinais de IA à conversa existente (criando um registro mínimo se ela ainda não estiver no dia) e incrementam `reviewCount`.
  - `subscribeDay(onChange)` usando `chrome.storage.onChanged` filtrado pela área `local` e pelo prefixo, para a UI refletir gravações de outra aba (mesmo padrão de `useTheme`).
  - `loadWidgetPosition()` / `saveWidgetPosition(pos)` para a posição do widget, tolerando valores ausentes/corrompidos com um padrão.

- [ ] Criar `src/hooks/useDayTracking.ts` que conecta um `ChatAdapter` ao store, reaproveitando o padrão de polling de `useComposerState` (intervalo ~1000ms, sem travar a UI):
  - A cada tick, se houver `conversationKey` e a conversa tiver mensagens, chama `adapter.readConversation(config.contextMessages)` e deriva a última mensagem (autor, texto) para alimentar `observeConversation`.
  - Deriva `label` de forma barata e sem mapear DOM novo: primeiro nome/trecho disponível na conversa, com fallback para a própria `key` (ex.: `chat_id`). Não invente seletor de cabeçalho do Botconversa nesta fase.
  - Expõe `{ day: DayLog, conversations: TrackedConversation[], now }` e atualiza `now` a cada tick para os chips/contadores reagirem.
  - Cancela intervalos e listeners no cleanup; nunca lança exceção para fora do hook.

- [ ] Ligar a captura dos sinais de IA já existentes ao tracking, sem criar nenhuma requisição nova:
  - Em `src/contents/companion.tsx` (`runReview`), ao receber `ReviewDraftResponse` com `ok: true`, chamar `attachReview` com `{ status, summary, at }` (derive um resumo curto de `changes`/`warnings` quando existir) usando o `conversationKey` atual.
  - No `src/sidepanel.tsx`, ao concluir `requestCoaching` com `response.ok`, chamar `attachCoaching` com `{ summary, nextStep, at }` para a conversa lida (o `conversationKey` vem de `GetConversationResponse`; ajuste `readActiveConversation` para devolvê-lo se hoje ele é descartado).
  - Manter o comportamento atual intacto: nenhuma chamada de IA muda e a UI de revisão/coaching não ganha dependência do tracking.

- [ ] Criar `src/components/DayWidget.tsx`: o widget flutuante arrastável que é o protótipo visível desta fase:
  - Cabeçalho com a marca (reutilize `Wordmark`/`GlassesMark` de `src/components/Brand.tsx`), data de hoje e contagem de conversas acompanhadas; corpo rolável listando as conversas de `useDayTracking`.
  - Cada conversa mostra `label`, prévia curta da última mensagem e um chip colorido (verde/amarelo/laranja/vermelho) com o tempo de espera quando a última mensagem é do cliente; quando não está aguardando, mostrar um estado neutro ("respondido" / "sem pendência"). Use as classes Tailwind e as variáveis de tema (`bg-surface`, `text-fg`, `border-line`) já usadas em `src/components/*` para funcionar no claro e no escuro.
  - Arrasto com Pointer Events no cabeçalho (pointerdown + pointermove + pointerup, com `setPointerCapture`), limitando o widget à viewport (`clamp`), persistindo a posição com `saveWidgetPosition` e restaurando com `loadWidgetPosition`. Posição inicial padrão junto à navbar do Botconversa (topo à direita, ex.: `{ top: 64, right: 16 }`).
  - Estado vazio amigável ("Nenhuma conversa acompanhada hoje ainda") e botão de minimizar/expandir persistido junto da posição.

- [ ] Reestruturar `src/contents/companion.tsx` para o widget existir independentemente do campo de texto:
  - O guard atual `if (!adapter || !composer || !frame) return null` deve deixar de esconder o widget: renderizar `<DayWidget />` sempre que `adapter` existir (mesmo sem conversa aberta), e manter o botão "Revisar" e o `SuggestionCard` exatamente como hoje, apenas quando `composer` e `frame` existirem.
  - Garantir que o widget respeite o tema (`dark` vindo do `useTheme`) e o shadow DOM já montado, sem vazar CSS para a página.

- [ ] Escrever `tests/tracking.test.ts` cobrindo a lógica pura (sem depender de rede ou de IA):
  - `waitLevel` nos limites exatos (6/12/18 min e acima), `dayKey` com uma data local fixa, e `waitElapsed` para os casos aguardando vs. respondido.
  - `observeConversation`: abertura nova, atualização da mesma conversa, `clientSince` gravado só uma vez, zerado quando o vendedor responde, e `openedAt` preservado.
  - `attachReview`/`attachCoaching` anexando a conversa certa e incrementando `reviewCount`.
  - Virada de dia: `DayLog` de datas distintas não se misturam ao chamar as funções com `date` explícita.

- [ ] Rodar `pnpm test` e `pnpm typecheck`, corrigir todas as falhas e, se algum teste antigo quebrar por causa do novo hook/componente, ajustar sem afrouxar a cobertura existente.
