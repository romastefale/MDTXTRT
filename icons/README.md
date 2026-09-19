# Ícones — leia-me

Substitua os arquivos desta pasta para trocar os ícones da interface. Use o **mesmo nome** do botão. Não é preciso mudar nada fora daqui.

## Como trocar

1. Exporte o ícone com o nome da lista abaixo.
2. Coloque o arquivo nesta pasta, no lugar do antigo.
3. Se quiser outro formato, apague o arquivo que o app está usando hoje (o `.svg` vence se existir).

O app procura, nesta ordem: **`.svg` → `.png` → `.webp`**. Só o primeiro que existir entra.

Exemplos:

- `bold.svg` — ícone de negrito
- Apague `bold.svg` e coloque `bold.png` para usar o PNG
- `heading.webp` só vale se não houver `heading.svg` nem `heading.png`

## Formato

| Formato | Quando usar | Observação |
| --- | --- | --- |
| **SVG** | Preferido | Segue a cor do texto (claro/escuro). Traço ou preenchimento **preto** (`#000`) em fundo transparente. |
| **PNG** | Foto ou desenho colorido | Aparece **na cor original** — não muda com o tema. Fundo transparente. |
| **WebP** | Igual ao PNG, arquivo menor | Mesma regra de cor do PNG. |

Não use JPEG: não tem transparência.

## Tamanho

Os botões desenham o ícone em cerca de **16×16 a 18×18 pixels** na tela.

| Tipo | Medida | Detalhe |
| --- | --- | --- |
| **SVG** | `viewBox="0 0 24 24"` | Quadrado 24×24. Traço ~2. Mantenha ~2 px de folga nas bordas para o traço não cortar. |
| **PNG / WebP** | **48×48** ou **72×72** px | Quadrado. 48 = 3× o tamanho na tela; 72 se quiser mais nitidez em telas densas. |

Não envie 512×512 nem 1024×1024: pesa e o recorte fica mole. Arquivo SVG: alguns kilobytes. PNG/WebP: de preferência abaixo de **20 KB**.

## Desenho

- Quadrado, centralizado, sem texto no glifo.
- Fundo **transparente**.
- SVG: `fill="none"` + `stroke="#000"` (como os atuais) **ou** silhueta preenchida preta. A interface recolore.
- PNG/WebP: desenhe já na cor final. Se precisar funcionar no claro **e** no escuro, use um SVG.
- Sem sombra, sem fundo branco, sem moldura.

## Nomes (não renomeie)

Barra e cabeçalho:

| Arquivo | Botão |
| --- | --- |
| `plus` | Menu + |
| `bold` | Negrito |
| `italic` | Itálico |
| `underline` | Sublinhado |
| `quote` | Citação |
| `link` | Link |
| `heading` | Títulos |
| `list` | Lista |
| `undo` | Desfazer |
| `redo` | Refazer |
| `edit` | Editar |
| `send` | Publicar |

Menu de título (H):

| Arquivo | Botão |
| --- | --- |
| `h1` … `h6` | Título H1 a H6 |
| `paragraph` | Corpo |
| `footer` | Rodapé Telegram |

Menu + e arquivos:

| Arquivo | Botão |
| --- | --- |
| `task` | Tarefa |
| `table` | Tabela |
| `more` | Citação expansível |
| `details` | Details |
| `document` | Documento |
| `buttons` | Botões |
| `import` | Importar |
| `file` | Arquivo |
| `copy` | Copiar |
| `open` | Abrir página |
| `paste` | Colar |

Só esses nomes são lidos. Outro nome nesta pasta não aparece na interface.
