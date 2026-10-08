---
type: reference
title: Alertas e métricas do dia
created: 2026-10-07
tags:
  - tracking
  - alertas
  - metricas
  - botconversa
related:
  - '[[Tracking-e-Relatorio-Diario]]'
  - '[[Relatorio-Diario]]'
---

# Alertas e métricas do dia

Referência das agregações que transformam o log bruto do dia em números e na fila de atenção que o
widget e o painel mostram. Tudo aqui é **puro**: as funções recebem o `DayLog` e o `now` já
carregados, sem tocar em `chrome`, IA ou relógio global — por isso são testáveis sem navegador.

- Fluxo completo (adapter → storage → widget/painel): [[Tracking-e-Relatorio-Diario]].
- Como esses números viram o relatório: [[Relatorio-Diario]].

Arquivos: `src/lib/tracking/summary.ts`, `src/lib/tracking/level.ts`,
`src/lib/tracking/constants.ts`.

## Estados de uma conversa

`conversationStatus(conversation, now)` classifica cada conversa acompanhada:

```mermaid
stateDiagram-v2
  [*] --> sem-mensagem: registro criado (sinal de IA antes do tick)
  sem-mensagem --> aguardando: cliente envia mensagem
  aguardando --> respondido: vendedor responde
  respondido --> aguardando: cliente envia nova mensagem
```

| Estado | Quando | `level` / `elapsedMs` |
| --- | --- | --- |
| `aguardando` | Há espera aberta (`clientSince` gravado) ou a última mensagem vista é do cliente. | Preenchidos a partir de `waitElapsed`. |
| `respondido` | A última mensagem é do vendedor — ou de bot/sistema depois de uma resposta. | `null`. |
| `sem-mensagem` | Nenhuma mensagem observada ainda (registro mínimo). | `null`. |

## Semáforo de espera

O tempo de espera é medido desde a mensagem do cliente que aguarda resposta, ancorado em
`clientSince`:

\[
\text{elapsed} = \max(0,\; now - clientSince)
\]

Os limites ficam em `WAIT_LIMITS_MS` (`src/lib/tracking/constants.ts`):

| Nível | Espera | Limite (`mm:ss` de espera) |
| --- | --- | --- |
| verde | até 6 min | \( \le 6 \times 60\,000\) ms |
| amarelo | acima de 6, até 12 min | \( \le 12 \times 60\,000\) ms |
| laranja | acima de 12, até 18 min | \( \le 18 \times 60\,000\) ms |
| vermelho | acima de 18 min, sem teto | \( > 18 \times 60\,000\) ms |

`WAIT_LEVEL_SEVERITY` dá a ordem canônica (`verde: 0` → `vermelho: 3`) usada para ordenar a fila.
**Alerta** é qualquer conversa aguardando em **laranja ou vermelho**; é o número do badge no
cabeçalho do widget (`summary.alerts`).

`conversationLabel` (`src/lib/tracking/level.ts`, `LABEL_MAX = 40`) deriva um rótulo curto do início
da primeira mensagem do cliente — sem mapear seletores novos — e cai para a `key` (o `chat_id`) quando
não há texto.

## Totais do dia (`summarizeDay`)

| Campo | Significado |
| --- | --- |
| `conversations` | Conversas acompanhadas hoje (tudo o que foi registrado). |
| `waiting` | Aguardando resposta agora (soma de `waitingByLevel`). |
| `waitingByLevel` | Contagem por nível do semáforo (`verde`/`amarelo`/`laranja`/`vermelho`). |
| `alerts` | `waitingByLevel.laranja + waitingByLevel.vermelho`. |
| `answered` | Última palavra do vendedor — nada pendente. |
| `withoutMessage` | Registros ainda sem nenhuma mensagem observada. |
| `reviews` | Revisões de rascunho feitas no dia (soma de `reviewCount`). |
| `coachings` | Conversas com um coaching anexado (o store guarda só o último de cada uma). |
| `averageFirstResponseMs` | Média até a primeira resposta do vendedor; `null` sem dados. |
| `averageResponseMs` | Média do intervalo cliente → vendedor mais recente; `null` sem dados. |

As médias usam `averageOf`: devolvem `null` (não `0`) quando não há amostra, para a UI mostrar "—" em
vez de inventar um zero.

### Como as médias são calculadas (e a aproximação)

Os momentos gravados pelo store permitem o cálculo real:

- `firstResponseMs`: de `lastClientAt` (com `openedAt` de reserva) até `firstResponseAt` — a primeira
  resposta do vendedor no ciclo aberto pela última mensagem do cliente. Uma nova mensagem do cliente
  zera `firstResponseAt`.
- `responseMs`: de `lastClientAt` até `lastSellerAt`.

Dia gravado por versão anterior (ou registro parcial, sem os momentos) cai na aproximação
`observedResponseMs`: a janela entre a conversa aberta (`openedAt`) e a resposta do vendedor
(`lastMessageAt`). Não é o tempo real, mas é o melhor que esses dois campos permitem — e continua
`null` enquanto não houve resposta.

## Fila de atenção (`attentionQueue`)

Só entram conversas em `aguardando`, ordenadas por:

1. Severidade do nível (vermelho → verde).
2. Tempo de espera mais longo primeiro, dentro do mesmo nível.
3. `key` como desempate, para a ordem ser determinística.

O widget mostra a fila no topo, com a linha destacada (`WAIT_ROW`/`WAIT_CHIP` em `src/lib/labels.ts`);
o restante vem por `lastSeenAt`. O painel lateral (`DayOverview`) usa exatamente a mesma fila e os
mesmos totais.

## Onde aparece

| Superfície | Arquivo | O que mostra |
| --- | --- | --- |
| Widget flutuante | `src/components/DayWidget.tsx` | Badge de alerta, linhas com chip colorido, fila no topo, totais no rodapé. |
| Painel lateral | `src/components/DayOverview.tsx` | Totais e fila de atenção, lidos do storage sem adapter. |
| Relatório do dia | `src/lib/tracking/report.ts` | Totais e estado por conversa entram no payload da IA e nas métricas da página. |

## Decisão de teste

Os limites do semáforo, as médias e a ordenação da fila são cobertos em
`tests/tracking-summary.test.ts` e `tests/tracking.test.ts`, sempre com `now` injetado — nenhum teste
depende do relógio da máquina.

## Ver também

- [[Tracking-e-Relatorio-Diario]] — arquitetura ponta a ponta.
- [[Relatorio-Diario]] — geração, formato, trava e exportação.
