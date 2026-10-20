# Phase 03: Backend do Pitaco e SPIN

O Pitaco não escreve a mensagem do vendedor. Ele ajuda a pensar: onde a conversa está, qual caminho
seguir, quais pontos abordar, quais perguntas fazer e o que evitar. A metodologia é o SPIN Selling
(Situação, Problema, Implicação, Necessidade).

## Contrato do Pitaco

- `stageNow`: etapa atual da conversa.
- `stages`: status e evidência de cada etapa SPIN.
- `diagnosis`: leitura curta da conversa.
- `path`: passos sugeridos, em ordem.
- `points`: pontos a abordar, com etapa, tipo, título, porquê e uma dica curta.
- `questions`: perguntas abertas e curtas.
- `avoid`: o que não fazer agora.
- `warnings`: fatos a confirmar antes de falar.

Não existe campo de mensagem pronta. `hint` é direção de raciocínio, não texto para copiar.

## Tasks

- [ ] Adicionar constantes de SPIN em `src/lib/ai/constants.ts`.
- [ ] Criar `pitacoSchema` em `src/lib/ai/schemas.ts`.
- [ ] Criar `TASK_PITACO` e `buildPitacoPrompt` em `src/lib/ai/prompts.ts`:
  - usar a conversa inteira, com transcrições;
  - não repetir perguntas já respondidas;
  - não apresentar solução antes da Necessidade;
  - tratar objeção com empatia;
  - citar `#n` das mensagens que sustentam cada ponto;
  - nunca escrever a mensagem que o vendedor deve enviar.
- [ ] Incrementar `PROMPT_VERSION`.
- [ ] Implementar `generatePitaco(conversation)` em `src/lib/ai/service.ts`:
  - aceitar conversa só com cliente ou só com vendedor;
  - não chamar a IA sem mensagens;
  - validar, limitar e descartar evidências inexistentes;
  - devolver custo só no dev.
- [ ] Configurar a tarefa `pitaco` (`PLASMO_PUBLIC_PITACO_*`).
- [ ] Criar a rota `generate-pitaco` e registrar em `messages.ts` e
  `plasmo-messaging.d.ts`.
- [ ] Testes de schema, prompt, guardas e custo.
- [ ] `check:bundle`: rota executada com conversa fictícia e sem custo na produção.

## Critérios de aceite

- Nenhuma resposta do Pitaco contém uma mensagem pronta para enviar.
- As perguntas e os pontos citam evidências reais.
- Conversa sem vendedor gera sugestões de descoberta; conversa sem cliente gera sugestões de
  abertura.
