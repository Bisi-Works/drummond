# Phase 04: Botão Pitaco e drawer lateral

O botão **Pitaco** fica ao lado de **Revisar**, na barra do campo de texto. Clicar já lê a
conversa, garante as transcrições e gera o Pitaco, abrindo o resultado no drawer. O drawer também
tem **Atualizar Pitaco**.

## Decisões de desenho (20/10/2026)

- **Posição:** drawer preso à direita, na altura inteira. Ocupa o espaço à direita do campo de
  texto (o painel "Perfil"), entre 320 e 400 px, para não cobrir o botão de enviar. Em janelas
  estreitas, em que o Botconversa esconde o Perfil, ele fica com 320 px e cobre a ponta do campo.
- **Clique fora não fecha:** o vendedor consulta o Pitaco enquanto escreve. Fecha pelo ✕, pelo Esc
  ou pelo próprio botão Pitaco (que fica preenchido enquanto o drawer está aberto).
- **Só as perguntas são copiáveis:** os pontos são direção de raciocínio, não texto para colar.
- **Widget do dia:** o drawer (z-60) fica por cima do widget (z-50), sem mexer na posição nem no
  "minimizado" salvos pelo vendedor.
- **Cabeçalho:** retrato + "Pitaco · SPIN" + nome do contato. O "Drummond by BW" quebrava no drawer
  de 320 px. *(Mudou na visão simples, abaixo: "Pitaco" e, no modo avançado, "Pitaco · Avançado".)*

## Visão simples e modo Avançado (20/10/2026)

O drawer completo tinha conteúdo demais para ler antes de responder. Agora ele **abre sempre** numa
visão simples com duas caixas: verde **Fazer** (até 4 tópicos; o primeiro é o próximo movimento) e
vermelha **Não fazer** (até 3). O botão **Avançado** no cabeçalho alterna para a análise completa
(SPIN, BANT, diagnóstico, caminho, pontos, perguntas copiáveis e "Confirme antes de falar") e vira
**Simples** para voltar. "Atualizar" mantém o modo escolhido; fechar e reabrir volta ao simples.

- **Mesma chamada:** o schema ganhou `bant` (status + evidência, sem pergunta pronta) logo depois de
  `stages`, e `doNow` + `avoid` no fim. O resumo é gerado por último, como síntese do SPIN, do BANT,
  da pergunta pendente do cliente e dos `warnings`. "Evite agora" deixou o modo avançado: virou o
  "Não fazer".
- **Prompt 2026-10-20.5:** tópicos começam pelo verbo, até 12 palavras, sem jargão de método, sem
  `#n` e sem mensagem pronta; o "Não fazer" vem sem o "não" na frente e sem negação dupla ("não
  ignorar X" é Fazer). O nome do cliente em terceira pessoa ("Responder à saudação da Carla") é
  permitido: é instrução, não mensagem.
- **Service:** descarta tópico vazio, com mais de 160 caracteres ou com quebra de linha. Se o Fazer
  ficar vazio, o drawer mostra o caminho no lugar.
- **`pnpm bench:pitaco`** (4 casos × 5): preço no meio da descoberta, só saudação, decisão de outra
  pessoa (BANT) e objeção de preço. Com o prompt .5: 20/20. Antes da regra "sem o não", todos os
  itens de evitar começavam com "Não…" e alguns eram "Não ignorar…". Tempo: mediana 5,6 s antes →
  6,5 s depois, na mesma janela (~+1 s pelos campos novos); o provedor oscilou entre 7 e 28 s em
  outras rodadas.
- **No app real (Sergio Alves, 2 áudios):** visão simples em 4,6 s (~US$ 0,001, 1.215 tokens de
  saída); Avançado mostra SPIN e BANT clicáveis; Atualizar mantém o modo; Esc + reabrir volta ao
  simples sem nova geração. `check:bundle` 54/54 na produção e 53/53 no dev; 472 testes.

## Tasks

- [x] Transformar o botão atual num container flexível com **Revisar** e **Pitaco**, mantendo o
  posicionamento em relação ao campo e o fallback em telas estreitas.
- [x] Criar `src/components/PitacoDrawer.tsx`:
  - cabeçalho “Pitaco · SPIN” e fechar;
  - stepper S → P → I → N com a etapa atual;
  - diagnóstico, caminho sugerido, pontos, perguntas, “evite agora” e avisos;
  - botão **Atualizar Pitaco**;
  - copiar pergunta (sem aplicar mensagem inteira; pontos não são copiáveis, ver decisões);
  - estados de carregando, transcrevendo, erro, vazio e resultado.
- [x] Criar o hook `usePitaco`:
  - lê a conversa no clique;
  - chama `prepareConversation` (transcrições);
  - envia para `generate-pitaco`;
  - ignora resposta antiga ao trocar de conversa;
  - reaproveita o último resultado da conversa e permite atualizar.
- [x] Abrir um painel fecha o outro (Revisar × Pitaco).
- [x] Esc fecha o drawer (clique fora não, ver decisões); foco e `aria-live` acessíveis.
- [x] Evitar sobreposição com o `DayWidget` (drawer acima ou widget recolhido).
- [x] Temas claro/escuro e responsividade.
- [x] `check:bundle` valida botão, drawer e fluxo com transcrição.

> **Feito (20/10/2026):** `usePitaco` guarda o último Pitaco de cada conversa em memória (enquanto a
> página está aberta); a conversa sem mensagem do cliente nem do vendedor vira um estado vazio sem
> chamar o background. O progresso real aparece no `aria-live` ("Lendo a conversa…",
> "Transcrevendo áudios 1 de 2…", "Gerando o Pitaco…"). Prompt 2026-10-20.2: perguntas sem
> vocativo (o modelo começava com "Sergio, …").
>
> **No app real (conversa com 2 áudios):** gera em 8–10 s (~US$ 0,0008), rodapé "inclui 2 áudios
> transcritos" vindo do cache, Esc fecha, reabrir mostra o guardado sem nova geração, e trocar de
> conversa durante o "Atualizar" mostra "ainda não foi gerado" na nova conversa, sem vazar a
> resposta da anterior. Visto só no tema escuro; o claro usa os mesmos tokens do card do Revisar.
> `check:bundle` com 6 checagens novas (botões, transcrição antes de gerar, drawer, sem "Aplicar",
> Esc + cache, sem erro): 50/50 na produção; 466 testes.

## Critérios de aceite

- Clicar em Pitaco gera e exibe o resultado sem passo extra.
- Não há botão para aplicar a mensagem inteira.
- Trocar de conversa durante a geração não mostra o resultado da conversa anterior.
- O drawer não quebra com áudio não transcrito, erro da IA ou conversa vazia.
