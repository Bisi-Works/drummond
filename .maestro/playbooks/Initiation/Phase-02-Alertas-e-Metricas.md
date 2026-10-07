# Phase 02: Alertas e métricas do dia

Com a base de tracking funcionando, esta fase transforma os dados brutos do dia em informação útil
para o vendedor: agrega tempos de resposta, identifica conversas aguardando ou sem resposta e mostra
um resumo no painel lateral, além de reforçar os alertas do widget. O objetivo é dar ao vendedor
visibilidade imediata de onde ele está perdendo tempo — "cliente respondeu e estou esperando há X" e
"conversa do dia ainda sem resposta" — usando apenas dados locais, sem nenhuma chamada de IA. Ao
final da fase, `pnpm test` e `pnpm typecheck` passam e o painel lateral exibe o resumo do dia.

## Tasks

- [x] Criar `src/lib/tracking/summary.ts` com as agregações puras e testáveis do dia:
  - `conversationStatus(conversation, now)` retornando `{ state: "aguardando" | "respondido" | "sem-mensagem", level: WaitLevel | null, elapsedMs }` a partir de `lastMessageAuthor` e `clientSince`.
  - `summarizeDay(day, now)` retornando totais: conversas acompanhadas, aguardando resposta, aguardando em cada nível (verde/amarelo/laranja/vermelho), respondidas, revisões feitas no dia e trechos de coaching anexados.
  - `averageFirstResponseMs(day)` e `averageResponseMs(day)` quando houver dados suficientes (derivar de `openedAt`/`clientSince`/`lastMessageAt`), retornando `null` em vez de número inventado quando faltar informação.
  - `attentionQueue(day, now)` ordenando as conversas que precisam de ação por severidade (vermelho → verde) e, dentro do mesmo nível, por tempo de espera decrescente.
  - Manter tudo em funções puras com `now` injetado, sem depender de `chrome` nem de relógio global, para testar limites com facilidade.

> **Agregações do dia criadas (2026-10-07).** `src/lib/tracking/summary.ts` (novo) + uma constante em `src/lib/tracking/level.ts`. Nada de `chrome`, IA ou relógio global: `now` é sempre parâmetro.
> - **`conversationStatus(conversation, now)`:** aguardando quando há espera aberta (`clientSince` gravado) **ou** quando a última mensagem vista é do `cliente` (registro parcial sem `clientSince` também precisa de ação, mas aí `elapsedMs`/`level` ficam `null` em vez de inventar tempo); `sem-mensagem` quando nada foi observado ainda; `respondido` no resto — inclusive bot/sistema depois de uma resposta, porque bot/sistema não mexem em `clientSince`. Usa `waitElapsed`/`waitLevel` de `level.ts`, sem duplicar a regra do semáforo.
> - **`summarizeDay(day, now)`:** `{ conversations, waiting, waitingByLevel, alerts, answered, withoutMessage, reviews, coachings, averageFirstResponseMs, averageResponseMs }`. `alerts` = laranja + vermelho (o badge do widget sai daqui); `withoutMessage` separa o registro mínimo (sinal anexado antes do primeiro tick) de uma resposta de verdade; `reviews` soma `reviewCount` e `coachings` conta conversas com `lastCoaching` (o store guarda só o último de cada uma).
> - **Médias:** `averageFirstResponseMs` e `averageResponseMs` preferem os momentos que o store vai gravar (`firstResponseAt`/`lastClientAt`/`lastSellerAt`, lidos como **opcionais** por `ConversationMoments` — dia antigo ou registro parcial não tem) e caem na janela observada (`openedAt` → `lastMessageAt`, só quando a última mensagem é do vendedor) quando faltam. **Nunca devolvem número inventado:** sem amostra, `null`, e o dia vazio dá `null` nas duas. Média arredondada para ms inteiro.
> - **`attentionQueue(day, now)`:** devolve `AttentionItem[]` (`{ conversation, status }`) com só as conversas aguardando, ordenadas por `WAIT_LEVEL_SEVERITY` (vermelho → verde), depois espera decrescente e, por fim, `key` — ordem determinística, independente da ordem de inserção no objeto do `DayLog`.
> - **Decisão de tipo:** `WAIT_LEVEL_SEVERITY` entrou em `level.ts` (junto de `waitLevel`) para ser reusada pela fila de atenção, pelo relatório e por qualquer ordenação futura, em vez de repetir a ordem dos níveis. `ConversationMoments` fica em `summary.ts` por enquanto: a declaração no tipo `TrackedConversation` e a gravação por `observeConversation` são o próximo checkbox, então aqui os campos são lidos por interseção e seguem válidos quando forem promovidos a campos do modelo.
> - **Verificação:** `vitest run` → **132/132** (nenhum teste existente quebrado) e `tsc --noEmit` → **exit 0**. Como o arquivo de testes permanente desta fase é o próximo checkbox (`tests/tracking-summary.test.ts`), as agregações foram exercitadas num rascunho temporário com 12 casos (os três estados, bot/sistema, registro parcial, contagens e níveis de `summarizeDay`, dia vazio, médias com os momentos, com a janela observada e sem dados, e a ordem da `attentionQueue` com desempate) — passou 12/12 e o rascunho foi apagado, no mesmo procedimento da Fase 01. Fica para o próximo checkbox ampliar em `averageResponseMs` o caso com `lastClientAt`/`lastSellerAt` de verdade.

- [x] Cobrir as agregações em `tests/tracking-summary.test.ts`:
  - `conversationStatus` para os três estados, `elapsedMs` correto e `level` nulo quando não aguarda.
  - `summarizeDay` com um dia sintético com conversas em níveis diferentes, conferindo as contagens.
  - `averageFirstResponseMs`/`averageResponseMs` incluindo o caso sem dados (`null`).
  - `attentionQueue` respeitando a ordem por severidade e o desempate por tempo, sem depender da ordem de inserção no objeto.

> **Agregações cobertas por testes (2026-10-07).** `tests/tracking-summary.test.ts` (novo, 23 casos em 4 `describe`) — só importa `summary.ts`/`level.ts`/`types.ts`/o `emptyDay` do store, nada de `chrome` nem relógio global (`NOW` fixo). `pnpm test` → **155/155** (132 anteriores seguem passando) e `tsc --noEmit` → **exit 0**; o rascunho temporário do checkbox anterior foi substituído por estes testes permanentes.
> - **`conversationStatus` (6 casos):** espera aberta com `clientSince` (tempo e nível conferidos contra `waitLevel`, não contra um literal solto), aguardando sem `clientSince` (ação, mas `elapsedMs`/`level` nulos), respondido pelo vendedor, respondido depois de bot/sistema (bot não reabre a espera), sem-mensagem e relógio andando para trás (`elapsedMs` 0, nunca negativo).
> - **`summarizeDay` (4 casos):** dia sintético com um aguardando por nível + respondido + sem-mensagem confere `conversations`/`waiting`/`waitingByLevel`/`alerts`/`answered`/`withoutMessage`; a soma de `reviewCount` (3) e a contagem de `lastCoaching` (1) vêm do mesmo dia; um caso isola o aguardando sem `clientSince` (entra em `waiting`, não em `waitingByLevel`, `alerts` 0); o dia vazio confere o objeto inteiro, com as duas médias em `null`.
> - **Médias (6 casos):** sem amostra e só com conversas aguardando → `null` (não `0`); momentos gravados (`lastClientAt`/`firstResponseAt`/`lastSellerAt`) dão `(3000+4000)/2 = 3500` na primeira resposta e `3000` na atual; `firstResponseMs` conta do `lastClientAt` e cai para `openedAt` quando ele falta; sem momentos, a janela observada (`openedAt` → `lastMessageAt`, só quando o vendedor falou por último) serve de reserva; `lastSellerAt` ausente devolve `null` em vez de inventar intervalo; e a média arredonda meio ms para cima (`1500,5 → 1501`).
> - **`attentionQueue` (6 casos):** ordem vermelho → verde e, dentro do nível, espera decrescente (`vermelho-longo`, `vermelho-curto`, `laranja`, `amarelo`, `verde`); o item carrega `status.level`/`elapsedMs` para os chips da UI; a mesma lista invertida no objeto do `DayLog` produz ordem idêntica; respondido e sem-mensagem ficam fora; o registro sem `clientSince` vai para o fim (severidade branda + espera zero); e nível/tempo iguais desempatam pela `key`.

- [ ] Enriquecer o store com o que as métricas precisam, sem quebrar os redutores já testados:
  - Guardar em `TrackedConversation` o instante da primeira resposta do vendedor após o cliente (`firstResponseAt: number | null`) e o último momento em que cada autor falou (`lastClientAt`, `lastSellerAt`), atualizados por `observeConversation`.
  - Garantir que esses campos sejam opcionais na leitura (dias antigos ou registros parciais continuam válidos) e atualizar `tests/tracking.test.ts` para cobrir o cálculo de `firstResponseAt` (gravado só na primeira resposta do ciclo).
  - Fazer `loadDay` normalizar registros parciais (preencher campos ausentes com `null`) para o resto do código não precisar de checagem defensiva.

- [ ] Expor os alertas no `useDayTracking` para que qualquer UI consuma:
  - Retornar também `summary` (resultado de `summarizeDay`), `attention` (de `attentionQueue`) e uma contagem `alertCount` (conversas aguardando em laranja ou vermelho).
  - Recalcular no tick existente apenas quando o dia ou o conjunto de conversas mudar de forma relevante, evitando re-render por milissegundo (compare uma assinatura estável, como `updatedAt` + `now` arredondado ao segundo).

- [ ] Atualizar `src/components/DayWidget.tsx` para usar os alertas:
  - Mostrar um badge no cabeçalho com `alertCount` quando houver conversas em laranja/vermelho e destacar essas linhas no topo da lista (ordem vinda de `attention`).
  - Exibir, no rodapé do widget, totais curtos do dia (acompanhadas, aguardando, respondidas) e o tempo médio de primeira resposta quando disponível.
  - Manter o comportamento responsivo/arrastável e o tema já implementados, sem introduzir dependência de IA.

- [ ] Adicionar um resumo do dia no `src/sidepanel.tsx`:
  - Incluir uma seção "Resumo do dia" (componente novo `src/components/DayOverview.tsx`) acima ou abaixo da análise de coaching, com os totais de `summarizeDay` e a lista `attention` com chips coloridos e tempo de espera.
  - Consumir os mesmos dados do widget via `useDayTracking` (a fonte é o `chrome.storage`, então as duas UIs ficam coerentes automaticamente).
  - Tratar o estado vazio ("Nenhuma conversa acompanhada hoje") e manter o fluxo atual de coaching intacto.

- [ ] Adicionar tratamento explícito de virada de dia e de abas múltiplas:
  - Quando `dayKey()` mudar durante a sessão (ex.: extensão aberta após a meia-noite), iniciar um novo `DayLog` sem descartar o anterior no storage e refletir isso no hook/widget.
  - Sincronizar as UIs via `subscribeDay` (`chrome.storage.onChanged`), garantindo que uma gravação feita em outra aba apareça no widget e no painel.
  - Não reescrever registros de dias anteriores; o dia antigo fica consultável para o relatório.

- [ ] Escrever testes que cubram a virada de dia e a sincronização de forma isolada:
  - Teste de `dayKey` com datas locais próximas da meia-noite (23:59 e 00:01) confirmando chaves distintas.
  - Teste de `loadDay`/`saveDay` com um stub simples de `chrome.storage.local` injetado em `globalThis`, confirmando round-trip e que a falha de storage devolve um dia vazio.
  - Teste garantindo que `summarizeDay` de um dia não enxerga conversas de outro.

- [ ] Rodar `pnpm test` e `pnpm typecheck`, corrigir as falhas e confirmar que nenhum teste anterior foi enfraquecido.
