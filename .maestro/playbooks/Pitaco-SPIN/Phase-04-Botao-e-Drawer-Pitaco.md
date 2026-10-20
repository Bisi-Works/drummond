# Phase 04: Botão Pitaco e drawer lateral

O botão **Pitaco** fica ao lado de **Revisar**, na barra do campo de texto. Clicar já lê a
conversa, garante as transcrições e gera o Pitaco, abrindo o resultado no drawer. O drawer também
tem **Atualizar Pitaco**.

## Tasks

- [ ] Transformar o botão atual num container flexível com **Revisar** e **Pitaco**, mantendo o
  posicionamento em relação ao campo e o fallback em telas estreitas.
- [ ] Criar `src/components/PitacoDrawer.tsx`:
  - cabeçalho “Pitaco · SPIN” e fechar;
  - stepper S → P → I → N com a etapa atual;
  - diagnóstico, caminho sugerido, pontos, perguntas, “evite agora” e avisos;
  - botão **Atualizar Pitaco**;
  - copiar pergunta/ponto (sem aplicar mensagem inteira);
  - estados de carregando, transcrevendo, erro, vazio e resultado.
- [ ] Criar o hook `usePitaco`:
  - lê a conversa no clique;
  - chama `ensureTranscripts`;
  - envia para `generate-pitaco`;
  - ignora resposta antiga ao trocar de conversa;
  - reaproveita o último resultado da conversa e permite atualizar.
- [ ] Abrir um painel fecha o outro (Revisar × Pitaco).
- [ ] Esc e clique fora fecham o drawer; foco e `aria-live` acessíveis.
- [ ] Evitar sobreposição com o `DayWidget` (drawer acima ou widget recolhido).
- [ ] Temas claro/escuro e responsividade.
- [ ] `check:bundle` valida botão, drawer e fluxo com transcrição.

## Critérios de aceite

- Clicar em Pitaco gera e exibe o resultado sem passo extra.
- Não há botão para aplicar a mensagem inteira.
- Trocar de conversa durante a geração não mostra o resultado da conversa anterior.
- O drawer não quebra com áudio não transcrito, erro da IA ou conversa vazia.
