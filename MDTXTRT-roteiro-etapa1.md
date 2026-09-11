# MDTXTRT — roteiro completo (Etapa 1 e seguintes)

Critério: uma superfície por vez. Acerto = o que o `app.py` faz no clique, não flag no `/health`. Sem `install()`, sem copiar `referencia/` por cima do HTML funcional, sem Bot API 10.3 nesta sequência.

Não mergear: **#71** (`app.js` = `PLACEHOLDER`) nem **#72** (`new` → `main`).

Este ficheiro **é** o artefacto. Outro agente pode aplicá-lo: o patch unificado está no fim.

---

## Onde estamos (11 set 2026)

| Onde | Estado |
|---|---|
| Branch `new` | `dd8e92ae` — visual #70 (CSS empilhado). Import ainda antigo. |
| PR #71 | Não usar. `app.js` virou `PLACEHOLDER`. |
| PR #72 | `new` → `main`. Não é a Etapa 1. |
| `fix/import-etapa1` | Já não é cópia cega. Tem `c25717b`: `import_workflow.py` com teto 1 MB no stage. Falta o resto da Etapa 1. |

Repo: https://github.com/romastefale/MDTXTRT
Commit do workflow: https://github.com/romastefale/MDTXTRT/commit/c25717b3f67d5abb3b0ff30621fb6a5d2bd1f0d1

## Etapa 1

Falta: `services.py`, `bot.py`, `server.py`, `index.html` accept, `app.js` importErrorMessage nos 3 catch.
Não mexer: referencia/, CSS #54, publishing, Rich 10.3, /health.

PR: `fix/import-etapa1` → `new`.

O patch completo está no ficheiro local desta conversa e no bloco que o utilizador pode descarregar em chat.
