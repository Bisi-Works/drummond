# Phase 02: Pipeline de speech-to-text

Transcrever os áudios da conversa sob demanda, usando `openai/whisper-large-v3-turbo` via
OpenRouter, e guardar o resultado por mensagem. Nada é transcrito ao abrir a página: a transcrição
acontece quando Revisar, Coaching ou Pitaco precisam da conversa. O cache da Fase 01 evita
repetir a chamada.

## Modelo e particularidades

- `openai/whisper-large-v3-turbo` é um modelo `audio->transcription`: recebe `input_audio` em
  base64 e devolve texto. Não aceita `response_format`, temperatura nem raciocínio.
- Por isso a chamada de STT **não** usa `require_parameters: true` com esses parâmetros. A
  política `data_collection: deny` continua sendo enviada.
- Provedores disponíveis no OpenRouter: DeepInfra (mais barato) e Groq. Padrão
  `deepinfra,groq`.
- Formatos comuns: `ogg` (áudio do WhatsApp), `mp3`, `wav`, `m4a`, `aac`, `flac`.
- O custo efetivo vem do `usage.cost`; a estimativa por texto não cobre áudio, então o dev mostra
  o custo efetivo da transcrição.

## Tasks

- [x] Adicionar ao adapter uma forma de obter o áudio por `messageKey`
  (`readAudio(messageKey)` ou equivalente), a partir do DOM e, se necessário, da API.
- [x] Descobrir na API do Botconversa se o áudio vem em URL/campo próprio.
  **Confirmado no app real (20/10/2026, inbox com áudios de cliente e vendedor):** o player é
  próprio (`_audioWaveform_` + `canvas` + botão `_custom_`), **não** existe `<audio>`, `<source>`,
  `[data-audio-url]` nem `blob:` no DOM. A URL vem no payload da mensagem, em
  `media[0].mediaS3Url` (fallback `mediaExternalUrl`), e é consumida pelas React props do
  componente (`Ap({ message })` → `Dm({ s3Url })`, que faz `fetch` direto). No WhatsApp oficial a
  mídia sai de `GET jwt_api/chat/get_media_url/`; fora dele o download é um `POST` autenticado
  (`downloadMediaFile`: `{ message, message_type }`). Conclusão: `readBotconversaAudioSource`
  **sempre devolve `null`** no app real.
- [x] Normalizar a fonte de áudio a partir do payload: `toInboxMessage` passou a expor `key`
  (`message_id`, o mesmo de `[data-message-id]`) e `media` (`media_s3_url` → `media_external_url`,
  além de `mime_type`, `file_size`, `duration`, `media_id`). `loadBotconversaMedia` consulta
  `jwt_api/messages/<chat_id>/` (janela de 25, cache de 10 s por conversa), e `readAudio` usa a API
  como caminho principal, com o DOM como fallback (um `src` que falha também cai para a API),
  baixando a URL com `credentials` só no próprio Botconversa. Evidências extras úteis: o app guarda
  blobs no IndexedDB (`MediaCache`, chave = `messageId`, com `transcript`) e expõe transcrição por
  `api/v1/messages/audio_transcription?connection_id=&message_id=` (o payload também traz
  `transcript`), o que pode evitar chamadas ao Whisper em mensagens já transcritas.
- [x] Configurar a tarefa `stt` em `src/lib/config.ts` e `.env.example`:
  - `PLASMO_PUBLIC_STT=on|off`;
  - `PLASMO_PUBLIC_STT_MODEL=openai/whisper-large-v3-turbo`;
  - `PLASMO_PUBLIC_STT_TIMEOUT_MS=60000`;
  - `PLASMO_PUBLIC_STT_MAX_BYTES=10485760`;
  - `PLASMO_PUBLIC_STT_DAILY_LIMIT=1000` (teto diário por instalação).
- [x] Estender `src/lib/ai/openrouter.ts` para uma chamada de transcrição em
  `/api/v1/audio/transcriptions` (`input_audio` + `language: "pt"`; só `data_collection` em
  `provider` — a ordem de provedores não se aplica a esse endpoint).
- [x] Criar `src/background/messages/transcribe-audio.ts`:
  - recebe `conversationKey`, `messageKey`, bytes e mime;
  - confere o cache antes de chamar o provedor;
  - deduplica chamadas em andamento por chave;
  - grava a transcrição somente depois do sucesso.
- [x] Criar o hook/rotina `prepareConversation` no content script:
  - carrega o cache em lote;
  - busca áudios faltantes e chama o background;
  - concorrência limitada (2);
  - falha parcial não bloqueia a análise; o áudio fica como não transcrito.
- [x] Incluir a transcrição no texto enviado à IA, junto do marcador de áudio (Revisar).
  **Pendente:** Coaching (Fase 05).
- [x] Registrar a rota em `plasmo-messaging.d.ts` e `messages.ts`.
- [x] Testes: cache hit não chama o provedor, dedupe concorrente, falha parcial, formato não
  suportado e custo efetivo no dev. **Pendente:** áudio grande no teste unitário (QA da Fase 07).
- [x] `check:bundle`: rota de transcrição com áudio falso e transcrição fixa (build de produção).

> **Feito (2026-10-19):** o adapter expõe `readAudio(messageKey)` e localiza a fonte em
> `audio[src]`, `audio > source[src]` ou `[data-audio-url]`, com `fetch` credenciado para URLs da
> sessão. O config ganhou `stt` (`PLASMO_PUBLIC_STT_*`), e `openrouter.ts` implementa
> `transcribeAudio` com `input_audio`, sem `response_format`/`require_parameters` e com
> `data_collection: deny`. A rota `transcribe-audio` valida pedido/formato/tamanho, consulta o
> cache antes de chamar o Whisper, deduplica chamadas em andamento e grava por `messageKey`.
> `prepareConversation` carrega o cache em lote, transcreve no máximo 2 áudios por vez, reporta
> progresso e nunca derruba a análise; a Revisar já usa a conversa preparada. `formatConversation`
> anexa `(transcrição: "...")` ao marcador `[áudio]`. **431 testes passando (29 arquivos)**,
> `pnpm typecheck` limpo, `pnpm build` ok e `check:bundle` **41/41 OK** na produção (Whisper,
> `input_audio`, política de dados e custo só no dev). Falta validar a fonte real do áudio no
> Botconversa, o teto diário e a build de dev.
>
> **Confirmado no app real (20/10/2026):** a fonte do áudio **não** está no DOM — o player é
> próprio e a URL só existe no payload (`mediaS3Url`/`mediaExternalUrl`).
>
> **Feito (2026-10-20):** `toInboxMessage` expõe `key` e `media`; `loadBotconversaMedia` busca a
> mídia em `jwt_api/messages/<chat_id>/` casando `message_id` com `[data-message-id]` (janela de
> 25, cache de 10 s, erro nunca lança) e `readAudio` usa a API como caminho principal, com o DOM
> como fallback (se o `src` do DOM falhar, tenta a API). O teto diário entrou como
> `src/lib/transcripts/quota.ts`: reserva antes da chamada, devolução em erro, contador por dia
> local no `chrome.storage.local` e fila para chamadas concorrentes (padrão `1000`, configurável
> por `PLASMO_PUBLIC_STT_DAILY_LIMIT`); cache hit não consome. **449 testes passando (30
> arquivos)**, `pnpm typecheck` limpo, `pnpm build` ok e `check:bundle` 41/41. Falta a build de dev
> e o teste ponta a ponta no app real (os nomes snake_case de `media[]` são defensivos: aceitamos
> snake e camel).
>
> **E2E no app real (20/10/2026, ainda em aberto):** com a build de dev carregada
> (`build/chrome-mv3-dev`), o fluxo Revisar roda, mas `prepareConversation` devolve
> **7 áudios, 0 transcritos, 7 falhas**. Diagnóstico já confirmado:
> - a API `jwt_api/messages/<chat_id>/` responde e casa (`message_id` = wamid do DOM);
> - nesta conta, `media[0]` traz **`media_id` numérico** (ex.: `2242648623129802`) e
>   `mime_type` (`audio/ogg; codecs=opus`), mas `media_s3_url` e `media_external_url` vêm
>   **vazias** — por isso a normalização só por URL não basta;
> - `GET jwt_api/chat/get_media_url/?bot_id=&media_id=` responde **200 `audio/ogg`** (~10 KB);
>   `POST /api/v1/messages/media` responde 404.
>
> Implementado a partir disso: `media_id` numérico aceito (antes só string) e
> `downloadBotconversaAudio` (GET `get_media_url`) como terceiro caminho do `readAudio`
> (DOM → URL pronta → download autenticado), com testes. Mesmo assim o E2E continuou em 0/7 na
> última execução, então falta confirmar o casamento `[data-message-id]` × índice da API e o
> status do GET dentro do content script. Próximo passo: instrumentar `loadBotconversaMedia`
> (`want`/`keys`/`hit`) e `downloadBotconversaAudio` (status/tamanho), rodar uma vez e remover.
>
> **E2E fechado (20/10/2026):** a instrumentação mostrou que a mídia já estava certa (casamento
> `message_id` × `[data-message-id]` ok, `get_media_url` 200 `audio/ogg`); quem recusava era o
> OpenRouter: o Whisper não é aceito no `chat/completions`. A transcrição passou para
> `/api/v1/audio/transcriptions` (resposta `text` + `usage.cost`) e `STT_PROVIDER_ORDER` saiu da
> config (o endpoint ignora `order`). No app real: **2/2 áudios transcritos** (0,7 s e 5,2 s,
> ~US$ 0,00016 no total) e, na segunda execução, `missing: []` — nenhuma chamada repetida.
> Logs removidos; **453 testes**, typecheck, build e `check:bundle` (41/41 produção, 40/40 dev) ok.

## Critérios de aceite

- Um áudio já transcrito nunca é enviado de novo ao Whisper.
- Duas abas/recursos pedindo o mesmo áudio ao mesmo tempo fazem uma única chamada.
- Um áudio que falha não impede o Pitaco; o prompt recebe o marcador e não inventa conteúdo.
