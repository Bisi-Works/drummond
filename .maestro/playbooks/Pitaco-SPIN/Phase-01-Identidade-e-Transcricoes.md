# Phase 01: Identidade estável de mensagem e cache de transcrições

Base para o STT e para o Pitaco. Hoje o `ChatMessage.id` é ordinal e recalculado a cada leitura
(a conversa é cortada em `slice(-limit)` e renumerada); ele serve para o prompt citar `#n`, mas
não para guardar nada por mensagem. Precisamos de uma chave estável vinda da plataforma e de um
cache de transcrição por mensagem, com leitura defensiva do `chrome.storage.local`.

## Tasks

- [x] Adicionar `messageKey?: string` e `transcript?: string` ao `ChatMessage`
  (`src/adapters/types.ts`). O `id` continua ordinal, para o prompt.
- [x] Ler `data-message-id` no adapter do Botconversa e devolver `messageKey` em cada mensagem
  (`src/adapters/botconversa.ts`), inclusive depois do `slice(-limit)`.
- [x] Criar `src/lib/transcripts/constants.ts` com prefixo versionado, versão e TTL.
- [x] Criar `src/lib/transcripts/store.ts`:
  - chave `drummond.transcript.v1.<platform>.<conversationKey>.<messageKey>`;
  - `toStoredTranscript` tolerante a dados corrompidos;
  - `loadTranscript`, `loadTranscripts` (lote) e `saveTranscript`;
  - `pruneTranscripts` para remover entradas vencidas ou inválidas;
  - fallback silencioso quando o storage não existe ou lança.
- [x] Testes: `data-message-id` estável em cortes diferentes, round-trip, lote, entrada inválida,
  storage indisponível, falha de escrita e poda.
- [x] Rodar `pnpm test` e `pnpm typecheck`.

> **Feito (2026-10-19):** `ChatMessage` ganhou `messageKey?` e `transcript?`. O adapter do
> Botconversa lê `data-message-id` e mantém a chave depois do recorte (`tests/botconversa.test.ts`
> cobre a estabilidade em `readConversation(3)`). Criado o namespace
> `drummond.transcript.v1.*` com `loadTranscript`, `loadTranscripts`, `saveTranscript`,
> `toStoredTranscript` e `pruneTranscripts` (TTL de 30 dias), sempre com fallback silencioso para
> storage ausente/recarregado. `tests/transcripts.test.ts` cobre round-trip, lote, dados
> corrompidos, storage indisponível, falha de escrita e poda. **412 testes passando (26 arquivos)**
> e `pnpm typecheck` limpo.

## Critérios de aceite

- Duas leituras da mesma conversa com limites diferentes devolvem a mesma `messageKey` para a
  mesma mensagem.
- Nenhuma chamada ao storage lança para o React (extensão recarregada com a página aberta).
- Transcrição salva com uma `messageKey` é lida de volta sem nova chamada de STT.
