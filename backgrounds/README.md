# Planos de fundo

O fundo **não é mais imagem**. O app pinta os dois HTML de wash (claro e escuro) em CSS, em `html`, `body` e uma camada `position: fixed` que cobre a viewport inteira — inclusive Safari, Telegram Mini App, notch e home bar.

Arquivos `light.*` / `dark.*` nesta pasta **não são lidos**. Trocar o fundo = editar as variáveis `--wash-light` e `--wash-dark` em `index.html`.
