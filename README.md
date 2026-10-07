# Drummond by BW

Extensão de navegador (uso interno, não publicada) que revisa e dá coaching nas mensagens dos
vendedores no **Botconversa**, usando o DeepSeek V4 Flash via **OpenRouter**. O nome é uma homenagem
a Carlos Drummond de Andrade. A identidade visual segue a da [Bisi Works](https://bisi.works/):
vermelho `#e7191f`, preto, branco e a fonte Geist. O logo é o retrato de Drummond e os óculos dele
marcam o botão de revisão (artes em `assets/`). O tema escuro é o padrão; o botão de sol/lua no
cabeçalho do painel lateral troca para o claro, e a escolha vale também para o card de revisão.

- **Revisar rascunho**: um botão **Revisar**, com os óculos do logo, aparece na barra do campo de
  texto do chat. A IA revisa o que o vendedor digitou, com o histórico recente como contexto, e
  mostra as diferenças. O vendedor pode **Aplicar**, **Copiar** ou fechar.
- **Coaching**: clicar no ícone da extensão abre um painel lateral. "Analisar conversa atual"
  avalia as mensagens que o vendedor já enviou e sugere melhorias prontas para usar. Também
  preenche um **checklist BANT** (Orçamento, Autoridade, Necessidade, Prazo) que mostra se o
  vendedor qualificou o lead. Cada critério aparece como cumprido, parcial ou pendente, e os que
  faltam vêm com uma pergunta pronta para fazer ao cliente. A análise aparece aos poucos, conforme
  o modelo escreve (streaming).
- **Widget do dia**: um painel flutuante e arrastável (posição e minimizado são lembrados) lista as
  conversas abertas no dia, com um chip de tempo de espera (verde → vermelho) desde a última
  mensagem do cliente. O registro é local (`chrome.storage.local`), sincroniza entre as abas e não
  faz nenhuma chamada de IA: revisões e coachings já feitos aparecem anexados à conversa.

Stack: [Plasmo](https://docs.plasmo.com/) (React + TypeScript), Tailwind CSS 3 e OpenRouter.

## Setup

Requisitos: Node 24+ e pnpm 11+.

```sh
pnpm install
cp .env.example .env   # e preencha PLASMO_PUBLIC_OPENROUTER_API_KEY
```

> Todas as variáveis `PLASMO_PUBLIC_*` são embutidas na extensão. Use uma **chave dedicada** do
> OpenRouter com **limite de crédito**. A chave fica só no service worker, mas continua
> extraível por quem tiver a extensão instalada. Não cole o código da build em chats ou tickets.

## Desenvolvimento

```sh
pnpm dev        # gera build/chrome-mv3-dev com hot reload
pnpm test       # vitest: prompts, parse (inclusive o JSON parcial do streaming), serviço e adapter do Botconversa (fixture HTML)
pnpm typecheck
```

**Custos (só no `pnpm dev`):** depois de cada análise, o painel lateral mostra um bloco "Custo
desta análise · dev" com duas linhas:
- **Estimado:** uma faixa calculada antes da chamada, a partir do tamanho do prompt (~3,5
  caracteres por token) e dos preços dos provedores que atendem a `require_parameters`. O preço
  vem da API pública do OpenRouter. A faixa não considera a política de dados nem tokens de
  raciocínio.
- **Efetivo:** o `usage.cost` que o OpenRouter devolve, com os tokens reais, os tokens de
  raciocínio e o provedor usado.

Na build de produção esse bloco some e a busca de preços não roda: `config.showCosts` depende de
`NODE_ENV === "development"`. O `pnpm check:bundle` confere isso, e também roda contra a build de
dev: `node scripts/check-bundle.mjs build/chrome-mv3-dev`.

Para carregar no Chrome ou Edge: abra `chrome://extensions`, ative o **Modo do desenvolvedor**,
clique em **Carregar sem compactação** e selecione `build/chrome-mv3-dev` (ou `-prod`). Abas do
Botconversa que já estavam abertas precisam ser recarregadas.

## Modelo, provedores e build

A revisão e o coaching usam o mesmo modelo, `deepseek/deepseek-v4-flash-0731`, com JSON Schema e
raciocínio desligado. Cada tarefa tem a sua configuração, para dar para trocar uma sem mexer na
outra: a revisão usa temperatura 0.3 e espera até 30 segundos. O coaching também usa 0.3,
espera até 90 segundos e chega em streaming.

Os padrões ficam em `src/lib/config.ts`. O `.env` pode trocar qualquer um com as variáveis
`PLASMO_PUBLIC_REVIEW_*` e `PLASMO_PUBLIC_COACH_*`: modelo, temperatura, raciocínio, formato da
resposta e ordem de provedores (veja o `.env.example`). Para testar outra configuração sem mexer
no `.env`, crie um perfil (ex.: `env/.env.teste`) só com as variáveis que quer trocar:

```sh
pnpm build                          # configuração do .env
pnpm build --env=env/.env.teste     # .env + o que o perfil sobrescreve
pnpm check:bundle                   # executa a build gerada (ver abaixo)
pnpm package                        # zip em build/ para enviar às pessoas que vão usar
```

**Sempre rode `pnpm check:bundle` depois de `pnpm build`** (ou `pnpm verify`, que roda testes,
typecheck, build e a checagem). A build de produção do Plasmo pode quebrar código que funciona
no `pnpm dev`: o tree-shaking do Parcel e o SWC antigo já descartaram o zod e corromperam uma
regex. Por isso a checagem não só compila, ela **executa** os bundles em um navegador simulado:
service worker (com OpenRouter falso, inclusive o streaming), content script (com a fixture do
Botconversa) e side panel (com o relatório chegando aos pedaços). Ela também confere que a chave
só está no background. O modelo ativo e a versão do prompt aparecem no rodapé do card e do painel.

**Provedores.** O mesmo modelo roda em vários provedores, com preço e velocidade bem diferentes.
Sem orientação, o OpenRouter prioriza os mais baratos. Para o DeepSeek V4 Flash, o mais barato
(OpenInference) estava degradado: a revisão levava de 8 a 24 segundos e às vezes estourava o
limite de 30. Por isso as duas tarefas pedem primeiro o **Cohere**, depois o **Parasail**
(`PROVIDER_ORDER=cohere,parasail`). Se os dois falharem, o OpenRouter segue para os demais.
Medido em 30/09/2026, com os mesmos rascunhos e conversa fictícia:

| Provedor | Revisão | Coaching (1º trecho / completo) | Saída (US$/M tokens) |
| --- | --- | --- | --- |
| Cohere | 0,6–2,8 s | 0,4 s / 3–7 s | 0,28 |
| Parasail | 3–4 s | 0,6 s / 11 s | 0,28 |
| Baidu | 1–3 s | 1 s / 6 s | 1,32 |
| Padrão do OpenRouter (OpenInference, Sail…) | 8–24 s | 3–8 s / 55–60 s | 0,13–0,42 |

O Baidu é rápido, mas aceita o JSON Schema sem aplicá-lo: em 18 chamadas, devolveu uma categoria
fora da lista e um JSON inválido. Com o Cohere, cada revisão custa ~US$ 0,0003 e cada coaching
~US$ 0,0006. Para ver os provedores e o que cada um aceita:
`https://openrouter.ai/api/v1/models/<autor>/<modelo>/endpoints` (campos `supported_parameters`,
`status` e `uptime_last_30m`; JSON Schema exige `structured_outputs`). Se a revisão voltar a
ficar lenta, confira ali se o Cohere continua saudável.

**Formato da resposta.** Com `json_schema`, o provedor restringe a saída ao JSON Schema
(*structured outputs*), e a resposta sempre vem no formato. Para um modelo sem provedor que
aceite JSON Schema, use `json_object`: o provedor só garante um JSON válido, o formato vem da
descrição no prompt e o zod valida depois. Se o modelo errar o formato, a extensão mostra "A
resposta da IA veio fora do formato esperado".

As requisições usam `provider.require_parameters: true`, então o OpenRouter só escolhe provedores
que suportam **todos** os parâmetros enviados. Assim, a resposta nunca vem de um provedor que
ignore o formato pedido. O efeito colateral é que enviar temperatura ou raciocínio para um modelo
que não os aceita deixa o modelo sem provedor, e toda chamada falha com 404. Nesse caso, use
`none` (temperatura) ou `default` (raciocínio). Não deixe o valor vazio: o Plasmo ignora vazio e
usa o valor padrão. Somado a `data_collection: deny`, alguns provedores ficam de fora.

**Raciocínio.** O DeepSeek V4 Flash raciocina em esforço alto por padrão. Esses tokens não
aparecem no resultado, mas custam tempo: o coaching levava de 100 a 140 segundos com o
raciocínio padrão. Por isso as duas tarefas usam `REASONING=off`. Para mudar os limites de
espera (30 segundos na revisão, 90 no coaching, tempo total também no streaming), altere
`timeoutMs` de cada tarefa em `src/lib/config.ts`.

**Streaming do coaching.** O painel abre uma conexão com o background (`chrome.runtime.connect`)
e recebe o JSON do relatório em pedaços, conforme o modelo escreve. A cada pedaço, o painel lê o
JSON incompleto (`src/lib/ai/partial-json.ts`) e mostra o que já chegou. O que falta aparece como
espaço reservado. A ordem das seções depende do provedor: alguns escrevem as chaves em ordem
alfabética, então o resumo pode ser o último a aparecer. Os botões de copiar só aparecem no fim.
O resultado final passa pela mesma validação do zod e substitui o parcial, com as melhorias
reordenadas por impacto. Fechar o painel no meio da análise cancela a chamada ao modelo.

**Revisão sem inventar fatos.** Nos testes, os modelos tendiam a "responder" pelo vendedor quando
o cliente tinha feito uma pergunta que o rascunho não respondia (ex.: escrever "sim, emitimos
nota fiscal"). Duas coisas em `prompts.ts`/`schemas.ts` evitam isso, e vale mantê-las ao mexer no
prompt:
- A seção "O que NUNCA fazer no texto sugerido".
- O campo `warnings` vem antes de `suggestedText` no schema. O modelo anota a pergunta sem
  resposta e só depois reescreve o texto.

Com o prompt `2026-09-30.1`, o DeepSeek inventou a resposta em 3 a 4 de 5 rascunhos. Com o
`2026-09-30.2`, não acrescentou nada em 55 revisões.

Com o prompt `2026-10-01.1` (checagem de contexto, regra de tratamento e marcadores de anexo), em 5 a
6 execuções por caso: o quadro "Confira antes de enviar" apareceu em 100% dos rascunhos que ignoravam
o cliente e em 0% do rascunho alinhado; nenhum texto manteve vocativos genéricos ("chefe", "meu bom");
nenhuma sugestão do coaching repetiu o problema apontado nem citou marcadores como `[áudio]`. O
coaching ainda é subjetivo em condução (por exemplo, cobrar prazo de quem diz "ainda estamos
analisando"). O filtro `dropInvalidImprovements` (`service.ts`) descarta melhorias sobre mensagens
que não são texto do vendedor, com trecho inexistente ou sugestão igual ao original.

## Onde ajustar

| O quê | Arquivo |
| --- | --- |
| Modelo e parâmetros de cada tarefa | `.env` (padrões em `src/lib/config.ts`) |
| Comportamento da IA (papel, tom, regras, formato) | `src/lib/ai/prompts.ts`. Incremente `PROMPT_VERSION` a cada mudança |
| Produtos, políticas e termos a evitar | `src/lib/ai/company-context.ts` |
| Formato da resposta (JSON Schema + validação) | `src/lib/ai/schemas.ts` |
| Seletores do Botconversa | `src/adapters/botconversa.ts` (e a fixture em `tests/fixtures/`) |
| Nova plataforma de chat | novo adapter em `src/adapters/`, registrado em `adapters/index.ts` e no `matches` de `src/contents/companion.tsx` |
| Nova rota de mensagem do background | arquivo em `src/background/messages/` **e** o nome da rota em `src/types/plasmo-messaging.d.ts` (o `.plasmo/messaging.d.ts` que o Plasmo gera é ignorado pelo git, e sem essa declaração o `pnpm typecheck` num clone limpo falha) |

### Se o Botconversa mudar a interface

As classes do app são CSS Modules (`_chatInput_kvmgj_16`). O adapter casa só o prefixo estável
(`_chatInput_`), então deploys comuns não quebram a extensão. Se o botão sumir ou a conversa vier
vazia, compare o DOM atual com o comentário no topo de `src/adapters/botconversa.ts`. Depois
atualize os seletores e a fixture.

## Como funciona

```
Botconversa ─ content script (shadow DOM) ── sendToBackground ──► background ── OpenRouter
                 adapter lê conversa/rascunho                    prompt + formato JSON + zod
Side panel ── sendToContentScript("get-conversation") ─► content script
           ── connect("coach-conversation") ◄──trechos── background ◄── OpenRouter (streaming)
```

- As chamadas de IA acontecem só no background, sob demanda. Nada é automático.
- As requisições vão com `provider.data_collection: "deny"`, porque as conversas têm dados de
  clientes (LGPD). Isso pode reduzir os provedores disponíveis para alguns modelos.
- O texto do cliente é tratado como dado, não como instrução: fica entre delimitadores e o prompt
  proíbe seguir ordens vindas da conversa.

## Limitações conhecidas

- O Botconversa não marca no DOM se uma mensagem enviada foi escrita por um humano ou pelo bot.
  Templates (mensagens com botões) vão como `VENDEDOR (modelo)`. Eventos como "Bot parado" e
  "Fulano atribuído por bot" vão como `SISTEMA`, e o prompt usa esses eventos para focar no que o
  vendedor escreveu.
- Só as mensagens carregadas na tela entram na análise. Para incluir mensagens mais antigas, role
  a conversa para cima antes.
