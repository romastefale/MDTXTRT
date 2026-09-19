# Planos de fundo — leia-me

Esta pasta **é** a fonte dos papéis de parede. O app lê os arquivos que estão aqui no disco. Salve `light` e `dark` nesta pasta — o fundo da tela passa a ser esses arquivos.

## Como trocar

1. Exporte duas imagens: uma para o tema claro, outra para o escuro.
2. Salve nesta pasta como `light` e `dark`, com uma das extensões abaixo.
3. Apague o arquivo antigo do mesmo nome se a extensão for outra.

O app lê o que está **nesta pasta no disco**. Se houver mais de um arquivo com o mesmo nome (`light.jpg` e `light.PNG`, por exemplo), vale o que você **salvou por último**.

Exemplos:

- `light.jpg` e `dark.jpg` — o que o app usa agora
- Para usar WebP no claro: apague `light.jpg` (e `light.jpeg`, se houver) e salve `light.webp`

Não misture `bg-light` nem outros nomes. Só `light` e `dark`.

## Tamanho da imagem

O fundo cobre a tela inteira (`cover`, centro). Sobra nas bordas é recortada; o assunto precisa estar no meio.

| | Recomendado | Atual |
| --- | --- | --- |
| Orientação | Retrato (celular) | Retrato |
| Largura | **1080 px** (mínimo 720) | 1080 px |
| Altura | **1920 px ou mais** | 2521 px |
| Proporção | ~9:19 a 9:21 | ~9:21 |
| Enquadramento | Assunto no centro vertical | — |

Celulares altos (19,5:9, 20:9, 21:9) cortam topo e base. Evite texto, logos ou o ponto de interesse colado nas bordas. Deixe ~15% de folga em cima e em baixo.

Não use paisagem 16:9: as laterais somem no telefone.

## Formato e peso

| Formato | Quando |
| --- | --- |
| **JPEG (`.jpg`)** | Preferido para foto. sRGB, qualidade 70–85. |
| `.jpeg` | Igual ao JPEG; só vale se não houver `.jpg`. |
| **PNG** | Só se precisar de transparência (o fundo de cor do app aparece atrás). Arquivo maior. |
| **WebP / AVIF** | Foto com menos peso. AVIF só entra se não houver jpg/jpeg/png/webp. |

Peso:

- Alvo: **30–150 KB** (os atuais têm ~30–36 KB).
- Teto confortável: **400 KB**.
- Evite passar de **1 MB** — a Mini App abre em 4G.

Sem metadados de GPS. Sem perfil de cor exótico (sRGB). Sem progressive demais se o arquivo inflar.

## Claridade

- **`light`** — cena clara. A interface no claro é texto escuro e vidro branco; o fundo não pode ser preto.
- **`dark`** — cena escura. Texto claro e vidro escuro; o fundo não pode estourar de branco no centro.

Um único arquivo não serve para os dois modos: o app escolhe `light` ou `dark` conforme o tema (Telegram, se estiver no Mini App; senão, o do sistema).
