# Phase 06: Tracking e relatório

Opcional para o MVP. Serve para medir adoção do Pitaco e enriquecer o relatório diário.

## Tasks

- [ ] Adicionar `TrackedPitacoSignal` em `src/lib/tracking/types.ts` com etapa atual, resumo e
  horário.
- [ ] Anexar o sinal à conversa quando um Pitaco for gerado.
- [ ] Contar Pitacos no resumo do dia e no relatório diário.
- [ ] Opcional: registrar se o vendedor copiou alguma pergunta/ponto.
- [ ] Atualizar `summary.ts`, `report.ts`, prompts e testes.

## Critérios de aceite

- O relatório diário mostra o uso do Pitaco sem aumentar o payload com a conversa completa.
- Nada é chamado automaticamente: o sinal deriva de uma geração que o vendedor pediu.
