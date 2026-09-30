# Working baseline

## Baseline vigente

A baseline de trabalho vigente do MDTXTRT é:

`9c9f8d38313d5f0043283daf06d6ac015f90bded`

- Data de adoção: 2026-09-30.
- Origem: estado de produção após o PR #123, com os fluxos privados do bot consolidados exclusivamente no Mini App e sem os caminhos legados substituídos.
- Natureza: snapshot operacional do estado conhecido e aceito neste momento.
- Esta baseline **não é o produto final**, **não é uma especificação imutável** e **não deve ser preservada contra solicitações de correção ou implementação**.

## Regra de evolução

A baseline existe para dar contexto e permitir comparação. Ela não existe para impedir mudanças.

Quando uma solicitação do usuário exigir correção, refinamento, refatoração ou nova implementação:

1. a solicitação explícita prevalece sobre o estado da baseline;
2. comportamento incorreto presente na baseline deve ser corrigido, não defendido;
3. não introduza fallbacks, compatibilidades ou degradações apenas para manter o comportamento anterior;
4. após uma mudança deliberada e integrada, a baseline pode e deve avançar para o novo estado aceito;
5. referências antigas permanecem apenas como histórico.

Uma regressão não se torna correta por existir na baseline. Um teste antigo não prevalece sobre um requisito atualizado.

## Contrato para agentes e assistentes

Ao trabalhar neste repositório:

- trate `main` como o estado publicado atual, não como prova de que todo comportamento está correto;
- trate esta baseline como ponto de partida descritivo, nunca como objetivo de preservação;
- não conclua que um defeito está corrigido apenas porque existe código correspondente ou um teste automatizado passou;
- não transforme ausência de evidência em evidência positiva;
- não afirme execução em dispositivo real, comportamento físico, persistência de bytes, deploy ou resultado externo sem ter verificado exatamente esse fato;
- diferencie claramente: código implementado, teste automatizado aprovado, deploy concluído e comportamento observado em ambiente/dispositivo real;
- quando o usuário relatar que o comportamento real diverge do teste, investigue o caminho real de interação em vez de usar o teste para invalidar o relato;
- não invente SHAs, run IDs, deployment IDs, resultados ou estados;
- não amplie uma solicitação para mudanças periféricas como forma de evitar a correção central;
- mantenha mudanças focadas e atualize contratos/documentos que ficarem factualmente obsoletos.

Estas regras também estão resumidas em [AGENTS.md](AGENTS.md).

## Uso

Para inspecionar exatamente o estado desta baseline:

```bash
git fetch origin
git checkout 9c9f8d38313d5f0043283daf06d6ac015f90bded
```

Para comparar um estado posterior:

```bash
git diff 9c9f8d38313d5f0043283daf06d6ac015f90bded..HEAD
```

## Histórico

- `7fe51e8401012232281db416ac0d9bd080c18ebf` — baseline anterior após o PR #120; substituída após a evolução dos comandos privados do bot nos PRs #122 e #123, incluindo remoção dos caminhos legados e consolidação dos botões `web_app`.
- `b22aee80bbaa79db63d12ef62ae523d968218aa5` — baseline anterior após o PR #118; substituída após tornar Rascunhos recolhível com a mesma normativa de Publicações no PR #120.
- `db6ae2240cbe2792bd7edb1a9c26399f068ea807` — baseline anterior após o PR #116; substituída após a correção do toque móvel real no PR #118.
- `1dbbdb2dfaeafbd8ef52cea859611ffa5f6699ad` — baseline histórica após o PR #107.
- `aac423e012745c7873908ddc4a76371fb8218aa3` — shell translúcido consolidado após a etapa 2/6, PR #86.
- `dde30467ed9b0d108bac2ae7ad9bcac1137c169e` — referência histórica anterior, merge do PR #53.

## Relação com Release Anchor e validação

Baseline visual, Release Anchor, testes automatizados e evidência de produção são contratos distintos. Nenhum deles, isoladamente, prova que o produto está finalizado ou que todo comportamento está correto.
