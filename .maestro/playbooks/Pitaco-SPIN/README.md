# Pitaco + SPIN Selling + transcrição de áudios

Playbook da funcionalidade **Pitaco**: um botão ao lado de **Revisar** que abre um drawer lateral
com orientação de condução da conversa baseada em SPIN Selling, sem escrever a mensagem pronta
para o vendedor. Inclui speech-to-text dos áudios da conversa, com transcrição guardada por
mensagem para não haver chamadas redundantes.

## Decisões fechadas

- **STT:** `openai/whisper-large-v3-turbo` via OpenRouter, usando a chave já existente.
- **UI:** drawer lateral dentro da página, aberto pelo botão **Pitaco** ao lado de **Revisar**.
- **Geração:** clicar em **Pitaco** já lê a conversa, garante as transcrições e gera o Pitaco,
  exibindo o resultado no drawer. O drawer também tem **Atualizar Pitaco**.
- **Saída:** diagnóstico, etapas SPIN, caminho sugerido, pontos a abordar, perguntas e avisos.
  Nunca uma mensagem pronta para enviar; no máximo, copiar uma pergunta ou um ponto.
- **Contexto:** mensagens visíveis no DOM, enriquecidas com transcrições em cache.
- **Sem geração automática** e **sem widget flutuante**.

## Fluxo

1. Vendedor clica em **Pitaco**.
2. O content script lê a conversa aberta e identifica os áudios sem transcrição.
3. Transcreve somente o que falta, pelo background, e grava cada transcrição pela `messageKey`.
4. Envia a conversa enriquecida para `generate-pitaco`.
5. O drawer mostra o resultado; a próxima abertura reaproveita a transcrição e pode reaproveitar
   o último Pitaco da conversa.

## Fases

- [Phase 01 — Identidade estável e transcrições](Phase-01-Identidade-e-Transcricoes.md)
- [Phase 02 — Pipeline de speech-to-text](Phase-02-Transcricao-de-Audio.md)
- [Phase 03 — Backend do Pitaco e SPIN](Phase-03-Pitaco-SPIN-Backend.md)
- [Phase 04 — Botão Pitaco e drawer lateral](Phase-04-Botao-e-Drawer-Pitaco.md)
- [Phase 05 — Revisar e Coaching com áudio](Phase-05-Revisar-e-Coaching-com-Audio.md)
- [Phase 06 — Tracking e relatório](Phase-06-Tracking-e-Relatorio.md)
- [Phase 07 — Verificação, documentação e release](Phase-07-Verificacao-Documentacao-e-Release.md)
