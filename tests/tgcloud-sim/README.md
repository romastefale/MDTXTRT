# Simulação local do backend tgcloud

`sdk.mjs` e `sdkdb.mjs` imitam, em memória, o subconjunto do SDK da plataforma usado em `tgcloud/`
(escritos a partir de `docs/tgcloud-sdk.md` do scaffold oficial). **Não são a plataforma**: provam a lógica
do código, não o comportamento real do banco, do `fetch` ou do Bot API. `npm test` roda as duas suítes.
