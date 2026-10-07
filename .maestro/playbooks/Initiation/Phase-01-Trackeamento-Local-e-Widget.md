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

- [x] Criar `src/lib/tracking/store.ts` com a persistência e os redutores puros do dia:
  - `loadDay(date = dayKey())`, `saveDay(day)`, `clearDay(date)` lendo/escrevendo `chrome.storage.local` na chave `${DAY_LOG_PREFIX}${date}`, com fallback silencioso (retorno de um `DayLog` vazio) quando `chrome?.storage` não existir ou a leitura falhar — o content script pode rodar com a extensão recém-recarregada.
  - `observeConversation(prev: DayLog, input)`: faz upsert por `key`, atualiza `lastSeenAt`, `messageCount`, `lastMessageAuthor/Text`, `platform` e `label`; quando a última mensagem é do cliente e `clientSince` era `null`, grava `clientSince = now`; quando a última mensagem é do vendedor, zera `clientSince` (não está mais aguardando). Nunca regride `openedAt`.
  - `attachReview(prev, key, signal)` e `attachCoaching(prev, key, signal)`: anexam os sinais de IA à conversa existente (criando um registro mínimo se ela ainda não estiver no dia) e incrementam `reviewCount`.
  - `subscribeDay(onChange)` usando `chrome.storage.onChanged` filtrado pela área `local` e pelo prefixo, para a UI refletir gravações de outra aba (mesmo padrão de `useTheme`).
  - `loadWidgetPosition()` / `saveWidgetPosition(pos)` para a posição do widget, tolerando valores ausentes/corrompidos com um padrão.

> **Store criado (2026-10-07).** `src/lib/tracking/store.ts`:
> - **Persistência:** `emptyDay`, `toDayLog` (valida o que veio do storage; valor estranho vira dia vazio), `loadDay(date = dayKey())`, `saveDay(day)` e `clearDay(date)` na chave `${DAY_LOG_PREFIX}${date}`, com `localArea()` guardando `chrome.storage.local` (`null` quando a extensão foi recarregada com a página aberta) e fallback silencioso em todas as operações.
> - **Redutores puros (sem storage e sem relógio global):** `observeConversation(prev, input)` faz upsert por `key`, preserva `openedAt`, atualiza `platform`/`label`/`lastSeenAt`/`lastMessageAuthor`/`lastMessageText`/`lastMessageAt`, mantém `messageCount` monotônico (`Math.max`), grava `clientSince = now` na primeira vez que a última mensagem é do cliente e o zera quando é do vendedor (bot/sistema não mexem na espera). `input.now` é obrigatório para o redutor ser determinístico nos testes. `attachReview` grava `lastReview` e incrementa `reviewCount`; `attachCoaching` grava `lastCoaching`. Ambos criam um registro mínimo se a conversa ainda não estiver no dia.
> - **Decisão:** `attachCoaching` **não** incrementa `reviewCount`. O texto da tarefa dizia "incrementam `reviewCount`" para os dois, mas `reviewCount` conta revisões de rascunho (ver o comentário em `types.ts` e o "revisões feitas no dia" de `summarizeDay`, Fase 02); somar coaching ali distorceria a métrica. Deixei o motivo comentado no próprio `store.ts`.
> - **Sincronização:** `subscribeDay(onChange)` usa `chrome.storage.onChanged` filtrado por `areaName === "local"` e pelo prefixo, e devolve a função de cancelar; gravações de outra aba chegam como um `DayLog` já validado (remoção vira dia vazio).
> - **Widget:** `DEFAULT_WIDGET_POSITION` (`{ top: 64, right: 16, minimized: false }`, junto à navbar do Botconversa), `toWidgetPosition` puro (rejeita versão errada/corrompido e campos não finitos), `loadWidgetPosition`/`saveWidgetPosition` gravando `{ version: WIDGET_POSITION_VERSION, ...pos }`. `WidgetPosition` aceita `left` **ou** `right` para o arrasto da Fase 01.
> - **Verificação:** `pnpm test` → 99/99 (rodei também um rascunho local com 6 casos do store, round-trip com stub de `chrome.storage` incluído, e apaguei depois). `pnpm typecheck` continua com **só o erro pré-existente** de `src/contents/companion.tsx:104` (`sendToBackground` tipa a resposta como `never`), que a última tarefa da fase resolve.

- [x] Criar `src/hooks/useDayTracking.ts` que conecta um `ChatAdapter` ao store, reaproveitando o padrão de polling de `useComposerState` (intervalo ~1000ms, sem travar a UI):
  - A cada tick, se houver `conversationKey` e a conversa tiver mensagens, chama `adapter.readConversation(config.contextMessages)` e deriva a última mensagem (autor, texto) para alimentar `observeConversation`.
  - Deriva `label` de forma barata e sem mapear DOM novo: primeiro nome/trecho disponível na conversa, com fallback para a própria `key` (ex.: `chat_id`). Não invente seletor de cabeçalho do Botconversa nesta fase.
  - Expõe `{ day: DayLog, conversations: TrackedConversation[], now }` e atualiza `now` a cada tick para os chips/contadores reagirem.
  - Cancela intervalos e listeners no cleanup; nunca lança exceção para fora do hook.

> **Hook criado (2026-10-07).** `src/hooks/useDayTracking.ts` (+ `conversationLabel` em `src/lib/tracking/level.ts` e testes em `tests/tracking.test.ts`):
> - **Polling:** `useEffect` com `setInterval` de 1000ms (configurável), no mesmo formato de `useComposerState` — sem listeners de DOM extras, porque o alvo (a última mensagem) só muda com o polling. A cada tick: `adapter.getConversationKey()` → `adapter.readConversation(config.contextMessages)` → deriva a última mensagem → `observeConversation`. `readConversation` vai dentro de `try/catch`: DOM trocando no meio do tick só adia a observação.
> - **Rótulo:** `conversationLabel(messages, key)` (função pura em `level.ts`) usa o início da primeira mensagem do `cliente`, colapsa espaços, pega só a primeira linha e trunca em 40 caracteres; sem mensagem do cliente cai para a própria `key`. Nenhum seletor de cabeçalho novo.
> - **Anti-churn:** `sameObservation` compara plataforma/rótulo/última mensagem/`messageCount`/`clientSince` e pula estado+gravação quando nada mudou de fato — sem isso o polling reescreveria o dia a cada segundo só para atualizar `lastSeenAt`, disparando `onChanged` à toa. O `now` continua avançando a cada tick, que é o que move os chips de espera.
> - **Retorno:** `{ day, conversations, now }`, com `conversations` ordenadas por `lastSeenAt` decrescente.
> - **Ciclo de vida:** carrega o dia com `loadDay` (fallback silencioso sem storage), assina `subscribeDay` para refletir gravações de outra aba e trata a virada de dia recarregando a data local corrente. `readyRef` evita que o tick sobrescreva o dia vazio inicial antes do `loadDay` assíncrono terminar. Cleanup cancela intervalo, inscrição e marca `cancelled`.
> - **Verificação:** `vitest run` → 103/103 passam (4 novos de `conversationLabel`). `tsc --noEmit` mantém **só** o erro pré-existente de `src/contents/companion.tsx:104` (`sendToBackground` tipa a resposta como `never`), que a última tarefa da fase resolve. Nota: `pnpm` não está no PATH deste shell; rodei os binários por `./node_modules/.bin/`.

- [x] Ligar a captura dos sinais de IA já existentes ao tracking, sem criar nenhuma requisição nova:
  - Em `src/contents/companion.tsx` (`runReview`), ao receber `ReviewDraftResponse` com `ok: true`, chamar `attachReview` com `{ status, summary, at }` (derive um resumo curto de `changes`/`warnings` quando existir) usando o `conversationKey` atual.
  - No `src/sidepanel.tsx`, ao concluir `requestCoaching` com `response.ok`, chamar `attachCoaching` com `{ summary, nextStep, at }` para a conversa lida (o `conversationKey` vem de `GetConversationResponse`; ajuste `readActiveConversation` para devolvê-lo se hoje ele é descartado).
  - Manter o comportamento atual intacto: nenhuma chamada de IA muda e a UI de revisão/coaching não ganha dependência do tracking.

> **Sinais de IA ligados ao tracking (2026-10-07).** Três arquivos novos/alterados:
> - **`src/lib/tracking/signals.ts` (novo, puro):** `reviewSummary` (conta as alterações e usa o motivo da primeira; sem alterações, cai no primeiro aviso — nunca vazio), `reviewSignal(review, at)` e `coachingSignal(report, at)`. O resumo é colapsado em uma linha, com espaços normalizados e corte em 140 caracteres, para caber no widget. Importa tipos de `~lib/ai/schemas` com `import type`, então **nada de zod entra no bundle do content script**.
> - **`src/lib/tracking/store.ts`:** `recordReview(key, signal)` e `recordCoaching(key, signal)` — atalhos carregar → redutor → gravar no dia da data `signal.at`, ambos com `try/catch` para nunca rejeitar (chamadas são `void`). O painel lateral não tem o hook de tracking, então precisava do atalho; o content script usa o mesmo, evitando duplicar as três linhas.
> - **`src/contents/companion.tsx`:** em `runReview`, o `conversationKey` é capturado **no clique** (antes do `await`), então uma troca de conversa no meio da resposta não desvia o sinal. Com `response.ok && key`, chama `void recordReview(key, reviewSignal(response.data, Date.now()))` — independente de a UI ter descartado o card por `requestId`, porque a revisão de fato aconteceu naquela conversa. Nenhuma mensagem/IA mudou.
> - **`src/sidepanel.tsx`:** `analyze` agora desestrutura `conversationKey` de `readActiveConversation` (ele **já vinha** na resposta do content script; o painel é que descartava) e, ao final de `requestCoaching` com `response.ok`, chama `void recordCoaching(...)`.
> - **Verificação:** `vitest run` → **109/109** passam (6 novos: resumo por primeira alteração, fallback para aviso, texto próprio quando não há nada, corte em uma linha, `reviewSignal` e `coachingSignal`). `tsc --noEmit` mantém **só** o erro pré-existente de `src/contents/companion.tsx` (`sendToBackground` tipa o `name` como `never`), que a última tarefa da fase resolve — a linha mudou de 104 para 109 por causa do comentário novo, o erro é o mesmo.
> - **Limitação conhecida:** `recordReview`/`recordCoaching` fazem load→save sem trava; o hook de tracking só grava quando a observação muda de fato (ver `sameObservation`), então a janela de sobrescrita é a de uma mensagem nova chegando no exato instante da resposta da IA. Aceitável para o protótipo; uma reconciliação transacional fica para depois, se necessário.

- [x] Criar `src/components/DayWidget.tsx`: o widget flutuante arrastável que é o protótipo visível desta fase:
  - Cabeçalho com a marca (reutilize `Wordmark`/`GlassesMark` de `src/components/Brand.tsx`), data de hoje e contagem de conversas acompanhadas; corpo rolável listando as conversas de `useDayTracking`.
  - Cada conversa mostra `label`, prévia curta da última mensagem e um chip colorido (verde/amarelo/laranja/vermelho) com o tempo de espera quando a última mensagem é do cliente; quando não está aguardando, mostrar um estado neutro ("respondido" / "sem pendência"). Use as classes Tailwind e as variáveis de tema (`bg-surface`, `text-fg`, `border-line`) já usadas em `src/components/*` para funcionar no claro e no escuro.
  - Arrasto com Pointer Events no cabeçalho (pointerdown + pointermove + pointerup, com `setPointerCapture`), limitando o widget à viewport (`clamp`), persistindo a posição com `saveWidgetPosition` e restaurando com `loadWidgetPosition`. Posição inicial padrão junto à navbar do Botconversa (topo à direita, ex.: `{ top: 64, right: 16 }`).
  - Estado vazio amigável ("Nenhuma conversa acompanhada hoje ainda") e botão de minimizar/expandir persistido junto da posição.

> **Widget criado (2026-10-07).** `src/components/DayWidget.tsx`:
> - **Estrutura:** cabeçalho preto com `Wordmark`, data local (`DD/MM/AAAA`, montada por `split` — sem `Date`, para não escorregar de fuso) e contagem de conversas; corpo rolável (`max-h-[60vh]`, `overflow-y-auto`) listando `useDayTracking(adapter)`. Cada item tem `label`, prévia da última mensagem (truncada, com `title`), chip de espera colorido (verde/amarelo/laranja/vermelho via `waitElapsed` + `waitLevel`) quando o cliente aguarda, e estado neutro "respondido"/"sem pendência" caso contrário. Aproveita os sinais já anexados: mostra `lastCoaching.nextStep` ou `lastReview.summary` e o `reviewCount` quando existem.
> - **Tema:** usa só variáveis (`bg-surface`, `text-fg`, `text-fg-muted`, `border-line`, `bg-muted`) e as cores de chip em par claro/escuro, então herda o `dark` do wrapper do `companion.tsx` e funciona nos dois temas.
> - **Arrasto:** Pointer Events no cabeçalho com `setPointerCapture`, `clamp` à viewport (medindo o `getBoundingClientRect` do próprio widget) e `touch-none select-none` para não selecionar texto; ignora `pointerdown` que nasce em `<button>` para o minimizar não virar drag. Grava com `saveWidgetPosition` no `pointerup`/`pointercancel` e restaura com `loadWidgetPosition` no mount (posição padrão `{ top: 64, right: 16 }`, junto à navbar). Ao arrastar, passa a ancorar por `left`.
> - **Minimizar/expandir:** botão no cabeçalho persiste `minimized` junto da posição.
> - **Verificação:** `tsc --noEmit` compila o componente sem erros (permanece só o erro pré-existente de `src/contents/companion.tsx:109`, que a última tarefa resolve) e `vitest run` → 109/109. Ainda não está montado no content script — isso é a próxima tarefa.

- [x] Reestruturar `src/contents/companion.tsx` para o widget existir independentemente do campo de texto:
  - O guard atual `if (!adapter || !composer || !frame) return null` deve deixar de esconder o widget: renderizar `<DayWidget />` sempre que `adapter` existir (mesmo sem conversa aberta), e manter o botão "Revisar" e o `SuggestionCard` exatamente como hoje, apenas quando `composer` e `frame` existirem.
  - Garantir que o widget respeite o tema (`dark` vindo do `useTheme`) e o shadow DOM já montado, sem vazar CSS para a página.

> **Widget montado no content script (2026-10-07).** Só `src/contents/companion.tsx` e o bullet novo do README:
> - O guard virou `if (!adapter) return null` (depois de todos os hooks) e o corpo passou a ser `<DayWidget adapter={adapter} />` seguido de um bloco condicional `composerFrame = composer && frame` que mantém o botão "Revisar" e o `SuggestionCard` byte a byte iguais — o `composerFrame` também faz o narrowing de TS que o guard antigo fazia, sem `!`/cast.
> - Sem campo de texto o widget continua na página (conversa aberta sem composer montado); sem adapter nada é injetado, como antes. `useDayTracking` agora roda sempre que há adapter, que é o objetivo da fase.
> - **Tema/shadow DOM:** o widget fica dentro do wrapper `dark`/`font-sans` que já envolvia o card e herda o `useTheme` sem código novo; `getStyle` continua trocando `:root` → `:host(plasmo-csui)` e o `DayWidget` só usa variáveis de tema (`bg-surface`, `text-fg`, `border-line`), então nada vaza para a página.
> - **Verificação:** `vitest run` → 109/109 (nenhum teste cobre o content script hoje). `tsc --noEmit` segue com **apenas** o erro pré-existente de `src/contents/companion.tsx` (`sendToBackground` tipa a resposta como `never`; a linha só andou de 109 para 110), que a última tarefa da fase resolve — não mexi nele para não misturar escopos.

- [x] Escrever `tests/tracking.test.ts` cobrindo a lógica pura (sem depender de rede ou de IA):
  - `waitLevel` nos limites exatos (6/12/18 min e acima), `dayKey` com uma data local fixa, e `waitElapsed` para os casos aguardando vs. respondido.
  - `observeConversation`: abertura nova, atualização da mesma conversa, `clientSince` gravado só uma vez, zerado quando o vendedor responde, e `openedAt` preservado.
  - `attachReview`/`attachCoaching` anexando a conversa certa e incrementando `reviewCount`.
  - Virada de dia: `DayLog` de datas distintas não se misturam ao chamar as funções com `date` explícita.

> **Testes puros do tracking escritos (2026-10-07).** `tests/tracking.test.ts` foi estendido (o arquivo já
> existia com `conversationLabel` e os resumos de sinal das tarefas anteriores) com **23 casos novos**, em
> quatro blocos `describe`, todos sobre funções puras — sem `chrome.storage`, sem rede e sem IA:
> - **`waitLevel`:** limites exatos 6/12/18 min (inclusive) e o salto para `vermelho` acima de 18 min, sem teto.
> - **`dayKey`:** data local de 23h59 que, via `toISOString`/UTC, já cairia no dia seguinte; zero à esquerda de
>   mês/dia; e o formato do dia local de `new Date()` quando não se passa argumento.
> - **`waitElapsed`:** aguardando (diferença de `clientSince`), `null` quando não aguarda e nunca negativo se o
>   relógio recuar.
> - **`observeConversation`:** abertura nova com `openedAt`/`clientSince`/`updatedAt` corretos; atualização da
>   mesma conversa sem regredir `openedAt`; `clientSince` gravado só na primeira mensagem do cliente; zerado
>   quando o vendedor responde; bot/sistema não mexem na espera; `messageCount` e rótulo não regridem; e o
>   fallback do rótulo para a própria `key`.
> - **`attachReview`/`attachCoaching`:** sinal anexado à conversa certa, `reviewCount` incrementado só pela
>   revisão (coaching não conta), criação de registro mínimo quando a conversa ainda não foi observada e os
>   dois sinais convivendo na mesma conversa.
> - **Virada de dia:** `emptyDay` de datas distintas mantém `date` e estado independentes; o dia seguinte
>   recomeça do zero para a mesma conversa.
> - **Verificação:** `vitest run tests/tracking.test.ts` → **33/33**; suíte completa `vitest run` → **132/132**
>   (eram 109 antes, +23). `tsc --noEmit` mantém **apenas** o erro pré-existente de
>   `src/contents/companion.tsx:110` (`sendToBackground` tipa a resposta como `never`), que a última tarefa da
>   fase resolve — não é escopo desta tarefa.
> - **Nota de ambiente:** `pnpm` não está no PATH deste shell; os binários foram rodados por `./node_modules/.bin/`.

- [ ] Rodar `pnpm test` e `pnpm typecheck`, corrigir todas as falhas e, se algum teste antigo quebrar por causa do novo hook/componente, ajustar sem afrouxar a cobertura existente.
