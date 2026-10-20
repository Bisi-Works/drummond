# Phase 05: Revisar e Coaching com áudio

A transcrição por mensagem não serve só ao Pitaco. Revisar e Coaching também devem enxergar o
conteúdo dos áudios, reaproveitando exatamente o mesmo cache — um áudio transcrito no Pitaco não
é transcrito de novo no Revisar.

## Tasks

- [x] Enriquecer a conversa com `transcript` antes de chamar `review-draft` e o coaching.
- [x] Garantir que o cache seja a única fonte: nenhum fluxo chama STT se a `messageKey` já tem
  transcrição.
- [x] Ajustar `formatConversation` para incluir a transcrição, neutralizando tags como já acontece
  com o texto normal. **Mudou de forma:** a transcrição entra como o texto da mensagem, sem
  marcador nem rótulo de áudio (ver abaixo).
- [x] Mostrar discretamente na UI “inclui X áudios transcritos”.
- [x] Manter o comportamento atual quando a transcrição falta: marcador e proibição de inferir.
- [x] Testes de prompt com áudio transcrito e sem transcrição.
- [x] `check:bundle` cobrindo Revisar e Coaching com áudio.

> **Feito (20/10/2026):**
> - **Coaching:** o `get-conversation` do content script ficou assíncrono e devolve a conversa já
>   preparada (`prepareConversation`, mesmo cache) e o resumo de áudios; se a preparação falhar,
>   devolve a conversa crua. O painel mostra "N mensagens analisadas · inclui X áudios transcritos".
> - **Revisar:** o card mostra "Contexto da revisão inclui X áudios transcritos", contando só o
>   recorte que vai ao modelo. O Pitaco usa os mesmos `audioSummary`/`describeAudio`.
> - **Prompt 2026-10-20.4:** a regra de áudio saiu da tarefa do Pitaco e foi para o `SYSTEM_BASE`
>   (vale para as três tarefas): áudios chegam já transcritos, como texto comum, e valem como
>   escritos; as regras de "não suponha" valem para o marcador `[áudio]` (não transcrito).
>
> **Por que a transcrição entra sem rótulo** (`pnpm bench:audio`, DeepSeek V4 Flash via Cohere):
> no caso R3 (rascunho bom respondendo a uma pergunta feita em áudio), o formato
> `[áudio] (transcrição: "…")` dava falso alerta em 5/5, já com o prompt anterior; o rótulo
> `CLIENTE (áudio transcrito)` ficou em ~60% de acerto e `CLIENTE (áudio)` em 3/10. A mesma pergunta
> em texto (controle R3t) dava 10/10. Com a transcrição como texto comum: R3 10/10 e depois 5/5. O
> coaching não vira melhoria sobre o áudio do vendedor porque o `text` dele continua `[áudio]`
> (`dropInvalidImprovements`, com teste).
>
> **Resultado final (5 execuções por caso):** R1 pergunta em áudio sem resposta no rascunho → alerta,
> sem fato inventado 5/5; R2 áudio sem transcrição → nada suposto 5/5; R3 sem falso alerta 5/5;
> R3t controle 5/5; C1 coaching reconhece a resposta dada em áudio 5/5.
>
> **No app real:** Pitaco e Revisar com prompt .4 e "inclui 2 áudios transcritos" (do cache). O
> Coaching não foi exercitado no app (o painel lateral não é alcançável pela automação), só no
> `check:bundle`: Pitaco → Coaching → Revisar fazem **um único** pedido ao Whisper. 470 testes;
> `check:bundle` 53/53 na produção e 52/52 no dev.

## Critérios de aceite

- Revisar e Coaching usam o contexto dos áudios quando a transcrição existe.
- Nenhuma chamada redundante ao Whisper é feita entre Pitaco, Revisar e Coaching.
- Áudio não transcrito continua sendo tratado como conteúdo desconhecido.
