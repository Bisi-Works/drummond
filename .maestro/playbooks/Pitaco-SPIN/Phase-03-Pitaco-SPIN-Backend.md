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

- [x] Adicionar constantes de SPIN em `src/lib/ai/constants.ts`.
- [x] Criar `pitacoSchema` em `src/lib/ai/schemas.ts`.
- [x] Criar `TASK_PITACO` e `buildPitacoPrompt` em `src/lib/ai/prompts.ts`:
  - usar a conversa inteira, com transcrições;
  - não repetir perguntas já respondidas;
  - não apresentar solução antes da Necessidade;
  - tratar objeção com empatia;
  - citar `#n` das mensagens que sustentam cada ponto;
  - nunca escrever a mensagem que o vendedor deve enviar.
- [x] Incrementar `PROMPT_VERSION`.
- [x] Implementar `generatePitaco(conversation)` em `src/lib/ai/service.ts`:
  - aceitar conversa só com cliente ou só com vendedor;
  - não chamar a IA sem mensagens;
  - validar, limitar e descartar evidências inexistentes;
  - devolver custo só no dev.
- [x] Configurar a tarefa `pitaco` (`PLASMO_PUBLIC_PITACO_*`).
- [x] Criar a rota `generate-pitaco` e registrar em `messages.ts` e
  `plasmo-messaging.d.ts`.
- [x] Testes de schema, prompt, guardas e custo.
- [x] `check:bundle`: rota executada com conversa fictícia e sem custo na produção.

> **Feito (20/10/2026):** / (com ), status e tipos de ponto em
> ;  com as etapas antes de / e  em
> pontos e perguntas;  +  ( 2026-10-20.1), que manda tratar a
> transcrição como o que foi dito no áudio;  +  (tira  inexistente,
> descarta item que só citava mensagem inventada, pergunta > 200 caracteres ou com quebra de linha e
> esvazia dica > 160); tarefa  em  com  para rollback;
> rota . **466 testes** (13 novos em ), typecheck, build e
>  (44/44 produção, 43/43 dev) ok.
>
> **Chamada real (DeepSeek V4 Flash via Cohere):** schema strict aceito; conversa de frete com áudio
> transcrito gerou etapa , perguntas ancoradas em #4 e nenhuma mensagem pronta, em ~8–10 s
> e ~US$ 0,0007. A primeira versão pôs "não responder o valor da parcela" em ; a regra 2
> passou a exigir acolher a pergunta direta do cliente e combinar o retorno.

## Critérios de aceite

- Nenhuma resposta do Pitaco contém uma mensagem pronta para enviar.
- As perguntas e os pontos citam evidências reais.
- Conversa sem vendedor gera sugestões de descoberta; conversa sem cliente gera sugestões de
  abertura.
