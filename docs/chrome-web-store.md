# Publicação na Chrome Web Store

A extensão vai para a loja como item **privado**: só as contas Google autorizadas conseguem
instalar, e o Chrome de cada vendedor atualiza sozinho quando uma versão nova é aprovada. Depois
da configuração inicial, lançar uma versão é um comando só (`pnpm release`).

Material da loja em `store/`: a imagem promocional (`promo-440x280.png`, gerada a partir do
`.html` ao lado) e o rascunho da política de privacidade (`politica-de-privacidade.md`).

## Antes do primeiro envio

1. **`.env` de produção sem variáveis de teste.** `PLASMO_PUBLIC_INBOX_USER_ID` preenchido faz
   todo vendedor ver os chats daquele membro no lugar dos dele. Mova variáveis de teste para o
   `.env.development.local`: só o `pnpm dev` lê esse arquivo, e o git o ignora. O `pnpm release`
   confere isso e para se encontrar `INBOX_USER_ID`, `REPORT_UNLIMITED=true` ou
   `DENY_DATA_COLLECTION=false` (a política de privacidade promete o `deny`).
2. **Conta de desenvolvedor** em <https://chrome.google.com/webstore/devconsole>, com a conta
   Google da BW (não uma pessoal). A taxa é única, de US$ 5, e a verificação em duas etapas é
   obrigatória.
3. **Política de privacidade numa URL pública.** Revise o rascunho em
   `store/politica-de-privacidade.md` e publique, por exemplo em `bisi.works/drummond/privacidade`.
   A loja exige a política porque a extensão lida com conversas de clientes.
4. **Imagens.** O ícone 128×128 já vai no zip, e a imagem promocional está em
   `store/promo-440x280.png`. Falta pelo menos **um screenshot de 1280×800** (até 5). Tire de uma
   conversa de teste, sem dados de clientes reais: os revisores do Google veem a ficha, e a LGPD
   vale para ela também.

## Primeiro envio (manual)

1. `pnpm release --zip-only` roda as mesmas checagens do release (`.env` e `pnpm verify`) e gera
   `build/chrome-mv3-prod.zip` sem mexer na versão.
2. No painel, clique em **Novo item** e envie o zip.
3. Preencha **Ficha da loja** e **Práticas de privacidade** com os textos abaixo.
4. Em **Distribuição**, escolha a visibilidade **Privada** e quem pode instalar:
   - se os vendedores usam contas do Google Workspace da BW e o administrador liberou a publicação
     no domínio, escolha **todos do domínio**. Pelo Admin console dá até para instalar à força,
     sem cada um precisar abrir o link;
   - senão, crie um **Grupo do Google** com as contas dos vendedores e adicione o grupo ao item.
     Quem entra ou sai do time muda só no grupo.

   Evite **Não listada**: qualquer pessoa com o link instala, e a chave do OpenRouter vai dentro
   do pacote. Mesmo como item privado, quem instala consegue extrair a chave, por isso ela precisa
   continuar sendo uma chave dedicada e com limite de crédito.
5. **Enviar para revisão.** A análise costuma levar menos de um dia, mas pode levar alguns.
6. Anote o **ID do item** (32 letras, na URL do painel). Ele vai no `.env.cws`.

**Para os vendedores:** depois de aprovada, o link de instalação é
`https://chromewebstore.google.com/detail/<ID>`. Antes de instalar, removam a versão carregada sem
compactação. As duas têm IDs diferentes, então ficariam duas cópias rodando. Como cada ID tem o
seu próprio `chrome.storage`, o histórico do dia e a trava do relatório da versão antiga não passam
para a da loja.

**Se o envio for recusado por causa de `web_accessible_resources`:** o manifest gerado pelo Plasmo
lista `companion.*.css` e `tabs/report.*.woff2`, que não existem na build. Os estilos vão
embutidos no JS, e a fonte vai em base64 no CSS. O Chrome ignora isso, mas, se a loja reclamar, o
conserto é tirar essas entradas do manifest depois da build.

## Credenciais da API (uma vez)

O `pnpm release` usa a [API v2 da Chrome Web Store](https://developer.chrome.com/docs/webstore/using-api).

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto (ex.:
   `drummond-release`) e ative a **Chrome Web Store API**.
2. Configure a **tela de consentimento OAuth**:
   - se a conta da loja é do Google Workspace da BW, use o tipo **Interno**;
   - se é uma conta comum, use **Externo**, adicione o próprio e-mail como usuário de teste e,
     depois de gerar o token, clique em **Publicar app**. Em modo Teste, o refresh token expira em
     7 dias, e o release passa a falhar com `invalid_grant`.
3. Crie um **ID do cliente OAuth** do tipo **Aplicativo da Web**, com
   `https://developers.google.com/oauthplayground` como URI de redirecionamento autorizado.
4. No [OAuth Playground](https://developers.google.com/oauthplayground), clique na engrenagem,
   marque **Use your own OAuth credentials** e cole o ID e a chave secreta. Em seguida, autorize o
   escopo `https://www.googleapis.com/auth/chromewebstore` com a conta da loja e clique em
   **Exchange authorization code for tokens**. Guarde o **refresh token**.
5. Copie `.env.cws.example` para `.env.cws` (o git ignora o arquivo) e preencha os campos. O
   **Publisher ID** fica no painel da loja, em **Conta**.

A alternativa é uma **conta de serviço**, sem refresh token. Adicione o e-mail dela em **Conta**
no painel da loja (só cabe uma por publisher) e use `CWS_ACCESS_TOKEN` com o token do
`gcloud auth print-access-token --impersonate-service-account=...` (vale por cerca de 1 hora).
Detalhes em <https://developer.chrome.com/docs/webstore/service-accounts>.

## Lançando uma versão

Com o git limpo:

```sh
pnpm release            # 0.1.0 → 0.1.1
pnpm release minor      # 0.1.1 → 0.2.0
pnpm release 1.0.0      # versão explícita
pnpm release --draft    # envia sem submeter; a submissão fica para o painel
git push --follow-tags  # o script cria o commit e a tag, mas não faz push
```

O script segue esta ordem:
1. Confere o `.env` de produção.
2. Consulta a loja: para se houver versão em revisão e confere se a nova é maior que a publicada.
3. Sobe a versão no `package.json`.
4. Roda `pnpm verify` e `pnpm package`.
5. Envia o zip e submete para revisão.
6. Cria o commit `release: vX.Y.Z` e a tag.

Se algo falhar antes do envio, o `package.json` volta à versão anterior.

Depois da aprovação, o Chrome dos vendedores atualiza sozinho em algumas horas. Para forçar,
abra `chrome://extensions`, ative o modo do desenvolvedor e clique em **Atualizar**.

Se você mudar a visibilidade no painel, publique uma vez pelo próprio painel antes de voltar a
usar o `pnpm release`. A API publica com a última visibilidade que foi publicada.

## Testando antes de liberar

- **Local**, como antes: `pnpm dev`, ou a build de produção carregada sem compactação.
- **Item beta na loja**, para testar a versão da loja com algumas pessoas antes do time todo:
  1. Crie um segundo item privado, só com os testadores.
  2. Termine o nome com `BETA` e inclua na descrição a frase "THIS EXTENSION IS FOR BETA TESTING".
     A política da loja exige isso, e sem isso os **dois** itens podem ser removidos.
  3. O item beta tem outro ID e precisa de uma build com outro nome. O `pnpm release` ainda não faz
     isso.
- O lançamento gradual (porcentagem de usuários) só existe para itens com mais de 10 mil usuários
  ativos.

## Textos para o painel

### Ficha da loja

- **Nome** e **resumo**: vêm do manifest (`displayName` e `description` do `package.json`).
- **Categoria**: Produtividade, na subcategoria de comunicação ou de fluxo de trabalho.
- **Idioma**: Português (Brasil).
- **Descrição**:

  > O Drummond ajuda vendedores que atendem pelo Botconversa a escrever melhor e a não deixar
  > nenhum cliente esperando.
  >
  > • Revisar rascunho: um botão na caixa de mensagem revisa o texto com IA antes do envio, mostra
  > as diferenças e deixa aplicar ou copiar a sugestão.
  > • Coaching da conversa: o painel lateral analisa as mensagens já enviadas, sugere melhorias
  > prontas para usar e mostra o checklist BANT (orçamento, autoridade, necessidade e prazo).
  > • Widget do dia: lista as conversas do dia com o tempo de espera de cada cliente e destaca
  > quem aguarda há mais tempo.
  > • Relatório diário: ao encerrar o dia, gera um relatório que pode ser salvo em PDF, HTML ou
  > JSON.
  >
  > Uso interno: distribuída apenas para as equipes autorizadas pela Bisi Works. Requer uma conta
  > do Botconversa.

### Práticas de privacidade

**Finalidade única**

Ajudar vendedores que atendem pelo Botconversa com IA: revisar mensagens antes do envio, dar
coaching sobre a conversa e acompanhar as conversas do dia.

**Justificativa das permissões**

- `sidePanel`:
Mostra o painel lateral com o coaching da conversa e o resumo do dia, aberto quando o vendedor
clica no ícone da extensão.
- `storage`:
Guarda no próprio navegador o acompanhamento das conversas do dia, os relatórios gerados, o limite de um relatório por dia e as preferências (tema e posição do widget).
- **Permissão de host** (`app.botconversa.com.br` e `openrouter.ai`):
app.botconversa.com.br: o content script lê a conversa aberta e o rascunho, adiciona o botão "Revisar" e o widget do dia e consulta a lista de chats do vendedor na API do Botconversa, usando a sessão da própria página. openrouter.ai: é o único serviço de IA usado. Recebe o texto a revisar ou analisar quando o vendedor pede. Também recebe as mensagens curtas do cliente, junto com a mensagem anterior do vendedor, para decidir se o cliente só se despediu e a conversa não está mais aguardando resposta.

**Código remoto**: *Não, não estou usando código remoto.* Todo o JavaScript vai no pacote, e o
OpenRouter devolve só dados (JSON).

**Uso de dados** (marque):
- **Informações de identificação pessoal**: nomes e telefones de clientes que aparecem nas
  conversas.
- **Comunicações pessoais**: as mensagens do chat.
- **Conteúdo do site**: o texto da página do Botconversa.
- **Informações de autenticação**: o token de sessão do Botconversa. A extensão o lê só em memória
  e o envia só ao próprio Botconversa, para ler a lista de chats. Não é obrigatório marcar, mas
  declarar evita questionamento na revisão.

Deixe desmarcados: saúde, financeiro, localização, histórico da web e atividade do usuário.
Marque as três certificações: não vende os dados, não os usa para fins não relacionados à
finalidade única e não os usa para avaliar crédito.

**Política de privacidade**: a URL onde você publicou o `store/politica-de-privacidade.md`.
