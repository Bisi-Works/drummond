# Phase 07: Verificação, documentação e release

Fechar a funcionalidade com as mesmas garantias das fases anteriores: testes, typecheck, build de
produção e `check:bundle` executando os bundles.

## Tasks

- [ ] Rodar `pnpm verify` e `node scripts/check-bundle.mjs build/chrome-mv3-dev`.
- [ ] QA manual:
  - áudio do cliente e do vendedor;
  - áudio sem fonte acessível;
  - dois áudios e clique repetido;
  - troca de conversa durante a geração;
  - extensão recarregada;
  - áudio grande ou formato não suportado;
  - falha do STT;
  - conversa só com cliente;
  - drawer aberto junto do widget do dia.
- [ ] Medir latência e custo de STT + Pitaco antes de liberar.
- [ ] Atualizar `README.md` e `.env.example`.
- [ ] Criar doc de arquitetura em `docs/architecture/`.
- [ ] Atualizar `docs/chrome-web-store.md` e `store/politica-de-privacidade.md`: o áudio também
  vai para o OpenRouter.
- [ ] Rollback documentado: `PLASMO_PUBLIC_PITACO=off` e `PLASMO_PUBLIC_STT=off`.
- [ ] Rollout gradual para um grupo pequeno antes de liberar para todos.

## Critérios de aceite

- `pnpm verify` verde nas builds de produção e dev.
- Custo e latência medidos e documentados.
- Privacidade e justificativa da loja refletem o envio de áudio.
