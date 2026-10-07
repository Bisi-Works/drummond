# Phase 02: Alertas e métricas do dia

Com a base de tracking funcionando, esta fase transforma os dados brutos do dia em informação útil
para o vendedor: agrega tempos de resposta, identifica conversas aguardando ou sem resposta e mostra
um resumo no painel lateral, além de reforçar os alertas do widget. O objetivo é dar ao vendedor
visibilidade imediata de onde ele está perdendo tempo — "cliente respondeu e estou esperando há X" e
"conversa do dia ainda sem resposta" — usando apenas dados locais, sem nenhuma chamada de IA. Ao
final da fase, `pnpm test` e `pnpm typecheck` passam e o painel lateral exibe o resumo do dia.

## Tasks

- [ ] Criar `src/lib/tracking/summary.ts` com as agregações puras e testáveis do dia:
  - `conversationStatus(conversation, now)` retornando `{ state: "aguardando" | "respondido" | "sem-mensagem", level: WaitLevel | null, elapsedMs }` a partir de `lastMessageAuthor` e `clientSince`.
  - `summarizeDay(day, now)` retornando totais: conversas acompanhadas, aguardando resposta, aguardando em cada nível (verde/amarelo/laranja/vermelho), respondidas, revisões feitas no dia e trechos de coaching anexados.
  - `averageFirstResponseMs(day)` e `averageResponseMs(day)` quando houver dados suficientes (derivar de `openedAt`/`clientSince`/`lastMessageAt`), retornando `null` em vez de número inventado quando faltar informação.
  - `attentionQueue(day, now)` ordenando as conversas que precisam de ação por severidade (vermelho → verde) e, dentro do mesmo nível, por tempo de espera decrescente.
  - Manter tudo em funções puras com `now` injetado, sem depender de `chrome` nem de relógio global, para testar limites com facilidade.

- [ ] Cobrir as agregações em `tests/tracking-summary.test.ts`:
  - `conversationStatus` para os três estados, `elapsedMs` correto e `level` nulo quando não aguarda.
  - `summarizeDay` com um dia sintético com conversas em níveis diferentes, conferindo as contagens.
  - `averageFirstResponseMs`/`averageResponseMs` incluindo o caso sem dados (`null`).
  - `attentionQueue` respeitando a ordem por severidade e o desempate por tempo, sem depender da ordem de inserção no objeto.

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
