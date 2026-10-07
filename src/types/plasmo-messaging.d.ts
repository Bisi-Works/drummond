// Rotas de mensagem do background tipadas para o `sendToBackground`.
//
// O Plasmo gera `.plasmo/messaging.d.ts` com o nome de cada arquivo de `src/background/messages`,
// mas só ao rodar `plasmo dev`/`plasmo build` — e `.plasmo/` é gerado e ignorado pelo git. Sem
// essa declaração, `MessageName` cai para `never` num clone limpo e `pnpm typecheck` acusa
// `name: "review-draft"` como `Type 'string' is not assignable to type 'never'`.
//
// Ao criar uma rota nova em `src/background/messages/`, acrescente o nome dela aqui (o formato
// `{}` é o mesmo que o Plasmo gera, para as duas declarações se fundirem sem conflito).
import "@plasmohq/messaging"

declare module "@plasmohq/messaging" {
  interface MessagesMetadata {
    "review-draft": {}
    "generate-report": {}
  }
}
