# Phase 05: Revisar e Coaching com áudio

A transcrição por mensagem não serve só ao Pitaco. Revisar e Coaching também devem enxergar o
conteúdo dos áudios, reaproveitando exatamente o mesmo cache — um áudio transcrito no Pitaco não
é transcrito de novo no Revisar.

## Tasks

- [ ] Enriquecer a conversa com `transcript` antes de chamar `review-draft` e o coaching.
- [ ] Garantir que o cache seja a única fonte: nenhum fluxo chama STT se a `messageKey` já tem
  transcrição.
- [ ] Ajustar `formatConversation` para incluir a transcrição junto do marcador de áudio,
  neutralizando tags como já acontece com o texto normal.
- [ ] Mostrar discretamente na UI “inclui X áudios transcritos”.
- [ ] Manter o comportamento atual quando a transcrição falta: marcador e proibição de inferir.
- [ ] Testes de prompt com áudio transcrito e sem transcrição.
- [ ] `check:bundle` cobrindo Revisar e Coaching com áudio.

## Critérios de aceite

- Revisar e Coaching usam o contexto dos áudios quando a transcrição existe.
- Nenhuma chamada redundante ao Whisper é feita entre Pitaco, Revisar e Coaching.
- Áudio não transcrito continua sendo tratado como conteúdo desconhecido.
