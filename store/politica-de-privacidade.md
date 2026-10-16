# Política de privacidade — Drummond by BW

*Vigente a partir de 14/10/2026*

O Drummond by BW é uma extensão do Chrome de uso interno da Bisi Works ("nós"). Ela ajuda
vendedores que atendem pelo Botconversa a revisar mensagens, receber coaching sobre a conversa e
acompanhar as conversas do dia. Esta política explica quais dados a extensão lê, para onde eles
vão e o que fica guardado.

## O que a extensão lê

A extensão só funciona em `app.botconversa.com.br`. Ali, ela lê:

- a conversa aberta na tela e o rascunho que o vendedor está escrevendo;
- a lista de chats atribuídos ao vendedor, consultada na API do Botconversa com a sessão que o
  vendedor já tem aberta. O token dessa sessão é lido só em memória, é enviado apenas ao próprio
  Botconversa e nunca é gravado nem repassado.

Essas informações podem incluir nomes, telefones e mensagens de clientes.

## O que é enviado para fora do navegador

O único destino além do Botconversa é a **OpenRouter** (`openrouter.ai`), que encaminha o pedido ao
provedor do modelo de IA. Os pedidos exigem provedores que não guardam nem usam os dados para
treinar modelos (`data_collection: deny`). O que vai em cada caso:

| Quando | O que é enviado |
| --- | --- |
| O vendedor clica em **Revisar** | O rascunho e as mensagens anteriores da conversa (até 20, na configuração atual) |
| O vendedor clica em **Analisar conversa atual** | As mensagens da conversa carregadas na tela |
| O vendedor clica em **Encerrar o dia** | Um resumo por conversa: nome do contato, a última mensagem (até 200 caracteres) e os indicadores do dia (tempos de espera, revisões e coachings) |
| Automaticamente, quando a última mensagem de um cliente é curta | Essa mensagem e a mensagem anterior do vendedor (até 300 caracteres cada), para decidir se o cliente só se despediu e a conversa não aguarda mais resposta |

A Bisi Works não tem servidor próprio para a extensão: nada é enviado para nós. A extensão não usa
ferramentas de análise, rastreamento nem publicidade.

## O que fica guardado

Tudo fica no armazenamento local do próprio Chrome (`chrome.storage.local`), no computador do
vendedor:

- o acompanhamento das conversas de cada dia: nome do contato, a última mensagem, horários e o
  resumo das revisões e coachings feitos;
- os relatórios diários gerados e o controle de um relatório por dia;
- preferências de tema e a posição do widget.

Esses dados ficam no navegador até a extensão ser removida, o que apaga tudo.

## O que não fazemos

Não vendemos dados, não os usamos para publicidade, não os compartilhamos com ninguém além do
descrito acima e não os usamos para nada além das funções da extensão.

## Contato

Dúvidas ou pedidos sobre dados pessoais: **bw@bisi.works**.
