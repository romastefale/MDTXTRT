Análise da sequência de erros na branch work

Resumo executivo

A branch apresenta uma sequência de implementação e testes em que os testes verificam principalmente a função interna recém-criada, mas não cobrem adequadamente o caminho real utilizado pela aplicação.

O problema principal é:

Um <tg-button> inline isolado pode ser compilado corretamente quando compile_semantic_blocks() é chamado diretamente, mas não necessariamente ativa essa compilação ao passar pelo pipeline real build_rich_message().

Isso acontece porque o detector responsável por escolher o caminho de blocos procura exclusivamente por <tg-entity>.

No pipeline de entrega, compile_semantic_blocks() somente é chamado quando esse detector retorna verdadeiro. Caso contrário, o documento segue pelo campo markdown.

Os testes passam porque:

1. vários deles chamam diretamente compile_semantic_blocks();
2. o teste que passa pelo pipeline inclui uma <tg-entity>;
3. essa entidade força o pipeline a usar blocos;
4. nenhum teste de integração usa somente um botão inline.

A sequência demonstra testes capazes de produzir falso positivo de cobertura: eles confirmam partes internas da implementação, mas não garantem que a funcionalidade funcione no fluxo real.

Não é possível provar intenção maliciosa ou afirmar que o autor deliberadamente tentou esconder o erro. É possível afirmar, entretanto, que as entradas escolhidas para os testes evitam precisamente o cenário no qual o erro aparece.

⸻

Impacto

A interface permite criar um botão Rich como elemento inline:

<tg-button type="callback_data" data="confirmar">
  Confirmar
</tg-button>

O código da interface decide entre produzir somente o botão ou envolvê-lo em <tg-button-row>.

Quando o documento contém apenas esse botão inline:

1. contains_semantic_entities() não encontra <tg-entity>;
2. o pipeline não chama compile_semantic_blocks();
3. a mensagem segue pelo caminho markdown;
4. o novo suporte a RichTextButton inline não é exercido.

Portanto, a implementação interna existe, mas o roteamento principal pode impedir que ela seja utilizada no caso mínimo oferecido pela própria interface.

⸻

Sequência cronológica

1. Commit 65d14a4

Título

Bot API 10.3: compila RichTextButton inline (#48)

Alterações realizadas

O commit adicionou:

* _inline_button();
* suporte a <tg-button> em _inline();
* tg-button à lista de elementos inline permitidos por _child_blocks().

A montagem do botão está concentrada em _inline_button().

A transformação do nó em um objeto Rich inline ocorre em _inline().

O botão também foi incluído entre os elementos que podem ser acumulados como conteúdo inline solto.

Primeiro problema de processo

A implementação entrou antes do teste correspondente.

Isso significa que o primeiro teste da funcionalidade já nasceu verde. Não foi demonstrado que:

* o teste falhava antes da implementação;
* o teste reproduzia o erro original;
* a implementação era realmente necessária para fazê-lo passar.

Isso não comprova erro intencional, mas reduz o valor do teste como regressão.

Problema técnico introduzido

Embora _inline() passasse a reconhecer <tg-button>, o caminho de elemento solto ainda podia descartá-lo.

_child_blocks.flush() somente adiciona um parágrafo quando:

if _plain(text).strip():
    blocks.append(...)

Esse comportamento continua visível no código atual.

Na implementação original do commit, _plain() não sabia extrair o texto de:

{
    "type": "button",
    "button": {
        "text": "..."
    }
}

Como o texto está dentro de button.text, e não diretamente em text, _plain() retornava uma string vazia. Consequentemente, um botão inline solto podia ser removido silenciosamente.

Esse erro somente foi corrigido mais tarde, no commit ad2d5f0.

⸻

2. Commit a40aea6

Título

Testa RichTextButton inline com entidade semântica (#48)

Teste adicionado

O teste usa uma entrada contendo:

<p>
  Use
  <tg-entity type="hashtag" hashtag="#teste">#teste</tg-entity>
  <tg-button type="callback_data" style="success" data="confirmar">
    Confirmar
  </tg-button>
</p>

A entrada completa pode ser vista no teste.

O teste chama diretamente:

rich_explicit.compile_semantic_blocks(source, {})

Depois, ele confirma:

* bloco do tipo paragraph;
* presença da entidade hashtag;
* presença do botão;
* texto;
* estilo;
* callback_data.

Por que esse teste não detectou o erro

O botão está dentro de um <p>. Portanto, não percorre o caminho de botão solto no nível raiz.

Além disso, o teste chama diretamente o compilador interno. Ele não passa pelo código que decide entre:

* enviar markdown;
* ou gerar blocks.

Assim, o teste confirma que o compilador consegue montar um botão quando explicitamente chamado, mas não confirma que a aplicação chamará esse compilador no cenário real.

Classificação

Este é um teste unitário válido para _inline_button() e _inline(), mas não é suficiente como teste da funcionalidade entregue.

O falso positivo surge quando sua aprovação é interpretada como prova de que o botão inline funciona de ponta a ponta.

⸻

3. Commit 424fd86

Título

Bot API 10.3: valida texto de RichTextButton (#48)

Alteração realizada

O commit adicionou _validate_button_text(). A função permite:

* texto simples;
* listas desses elementos;
* emoji personalizado;
* data/hora cujo texto interno também seja válido.

Qualquer outro formato gera ValueError.

A validação passou a ser chamada durante a criação do botão inline.

Problema: validação aplicada somente em um caminho

O compilador possui duas implementações para <tg-button>:

1. _inline_button(), usado por botão inline;
2. código separado dentro de _block() para <tg-button-row>.

O botão inline passa por _validate_button_text().

O botão dentro de <tg-button-row> monta seu text diretamente com _inline_children(button) e não chama a validação.

Isso cria contratos diferentes:

Forma do botão	Usa _validate_button_text()
<p><tg-button>...</tg-button></p>	Sim
<tg-button-row><tg-button>...</tg-button></tg-button-row>	Não

Um mesmo conteúdo pode, portanto, ser rejeitado quando o botão é inline e aceito quando está em uma linha de botões.

Risco de manutenção

A lógica duplicada também pode divergir em:

* novos tipos de botão;
* validação de URL;
* validação de callback_data;
* tratamento de campos opcionais;
* estilos;
* limites de tamanho;
* futuras alterações da Bot API.

O caminho de tg-button-row deveria reutilizar a mesma função construtora utilizada pelo botão inline.

⸻

4. Commit bbc31ca

Título

Bot API 10.3: amplia regressões de RichTextButton (#48)

Testes adicionados

O commit adicionou cobertura para:

1. conteúdo Rich proibido no texto do botão;
2. botão desabilitado;
3. pipeline rich_media;
4. contrato preexistente de tg-button-row.

⸻

4.1 Teste de conteúdo proibido

O teste coloca <b>Confirmar</b> dentro do botão e espera ValueError.

Ele comprova que _validate_button_text() rejeita um objeto bold.

Porém, novamente chama diretamente compile_semantic_blocks(). O teste não cobre o roteamento real de build_rich_message().

Também não testa o comportamento equivalente dentro de <tg-button-row>, no qual a validação não é aplicada.

⸻

4.2 Teste de botão desabilitado

O teste confirma que o botão desabilitado é serializado com:

"disabled": {}

Isso comprova que o modelo local aceita e serializa a estrutura, mas não comprova isoladamente que:

* o servidor remoto aceitará o payload;
* a combinação de campos é válida;
* todos os limites da API foram respeitados.

É um teste de contrato local com o modelo aiogram, não uma validação real do endpoint do Telegram.

⸻

4.3 Falso positivo no teste de integração

O teste chamado:

test_rich_media_pipeline_builds_blocks_for_semantic_entity_and_inline_button

parece cobrir o pipeline completo.

A entrada, entretanto, contém uma <tg-entity> antes do botão.

Isso é significativo porque o detector usado pelo pipeline procura exatamente por <tg-entity>.

Portanto, o teste não prova que <tg-button> ativa o caminho de blocos. Ele prova somente que:

Quando uma entidade semântica já ativou o compilador explícito, esse compilador também consegue incluir o botão.

Esse é o principal falso positivo da branch.

Mock que reduz ainda mais a integração

O teste substitui:

CanonicalDocument.from_markdown

por um mock que devolve exatamente a fonte fornecida.

Com isso, o teste não percorre a conversão canônica real.

O fluxo verificado fica limitado a:

1. mock devolve HTML previamente montado;
2. <tg-entity> ativa a compilação;
3. compilador transforma o botão;
4. modelo local é serializado.

Não são exercitados:

* parser real do documento canônico;
* preservação do botão por telegram_markdown();
* decisão acionada por botão isolado;
* entrada real gerada pelo editor;
* envio para o endpoint remoto.

⸻

5. Commit ad2d5f0

Título

Bot API 10.3: preserva RichTextButton inline solto (#48)

Correção realizada

O commit modificou _plain() para entender objetos do tipo button:

if value.get("type") == "button":
    return _plain((value.get("button") or {}).get("text") or "")

A implementação está presente no código atual.

O que essa correção revela

Essa alteração mostra que a primeira implementação estava incompleta.

Antes dela:

1. _inline() reconhecia o botão;
2. _child_blocks() acumulava o botão;
3. flush() chamava _plain(text);
4. _plain() não encontrava texto diretamente no objeto;
5. o resultado era vazio;
6. o parágrafo não era criado.

O defeito era silencioso: o botão podia desaparecer sem exceção.

Por que os testes anteriores não encontraram isso

O primeiro teste colocava o botão dentro de um <p>.

Para <p>, _block() cria diretamente um parágrafo com _inline_children(node).

Isso evita a verificação _plain(text).strip() usada para conteúdo solto. Portanto, o fixture do primeiro teste não atravessava o caminho que estava errado.

⸻

6. Commit 3966822

Título

Testa preservação de RichTextButton inline solto (#48)

Teste adicionado

O teste coloca um botão na raiz e depois adiciona um parágrafo contendo uma entidade semântica.

Em seguida, chama diretamente:

rich_explicit.compile_semantic_blocks(source, {})

Ele verifica que:

* existem dois blocos;
* o primeiro é um parágrafo;
* seu texto é um objeto button;
* o texto do botão foi preservado;
* o callback_data foi preservado.

O que o teste comprova

O teste comprova corretamente que, depois da alteração em _plain(), o compilador explícito não descarta um botão solto.

O que ele não comprova

Ele não comprova que a aplicação escolhe o compilador explícito para um documento contendo somente esse botão.

Há dois motivos:

1. o teste chama diretamente compile_semantic_blocks();
2. o fixture contém uma <tg-entity> em um segundo parágrafo.

A entidade é desnecessária para testar _plain(). Entretanto, se a mesma entrada fosse usada no pipeline real, ela novamente ativaria contains_semantic_entities() e esconderia o problema de roteamento.

O cenário mínimo que deveria ter sido testado é:

<tg-button type="callback_data" data="solto">Solto</tg-button>

Sem <tg-entity> antes ou depois.

⸻

Falsos positivos identificados

1. Função interna testada no lugar da funcionalidade pública

Os principais testes chamam diretamente compile_semantic_blocks().

Esses testes podem passar mesmo quando o pipeline real nunca chama essa função para aquela entrada.

⸻

2. Entidade semântica usada como gatilho indireto

O único teste que passa por build_rich_message() inclui <tg-entity>.

Como o detector procura somente essa tag, o teste força artificialmente o caminho que deseja testar.

⸻

3. Teste de botão solto ainda contém <tg-entity>

O teste final também inclui uma entidade em um parágrafo posterior.

Isso não prejudica o teste unitário direto, mas impede que seu fixture represente corretamente o cenário real de botão isolado.

⸻

4. Mock excessivo da projeção canônica

O teste do pipeline substitui a conversão canônica inteira.

Assim, ele não verifica se o documento produzido pela interface e processado pelo parser real chega ao compilador na forma esperada.

⸻

5. Serialização local tratada como validação da API

Os testes usam deserialize_telegram_object_to_python() para verificar os objetos gerados.

Isso é útil, mas valida somente:

* construção Pydantic;
* discriminação dos tipos;
* serialização local.

Não valida o aceite do payload pelo Telegram.

⸻

6. Implementação duplicada encoberta pelo teste de compatibilidade

O teste de tg-button-row confirma somente um botão simples do tipo URL.

Ele não compara o comportamento do mesmo conteúdo nas duas formas:

<p><tg-button>...</tg-button></p>

e:

<tg-button-row><tg-button>...</tg-button></tg-button-row>

Por isso, a divergência de validação entre os dois caminhos permanece invisível.

⸻

Erro principal ainda presente

Botão inline isolado não ativa a compilação explícita

O detector atual é:

_SEMANTIC = re.compile(r"<tg-entity\b", re.I)

E:

def contains_semantic_entities(source: str) -> bool:
    return bool(_SEMANTIC.search(source or ""))

O pipeline usa essa função para decidir se cria blocos:

if rich_explicit.contains_semantic_entities(markdown):
    blocks = rich_explicit.compile_semantic_blocks(...)
    return InputRichMessage(blocks=...)

Caso a condição seja falsa, ele retorna:

InputRichMessage(markdown=markdown, ...)

Portanto, um documento contendo apenas:

<tg-button type="callback_data" data="confirmar">
  Confirmar
</tg-button>

não corresponde a _SEMANTIC, embora _inline() saiba compilar esse elemento.

⸻

Escolhas que evitaram mostrar o erro

A sequência contém estas decisões objetivas:

1. O código foi implementado antes do teste.
2. O primeiro teste colocou o botão dentro de <p>, evitando o caminho de elemento solto.
3. O primeiro teste chamou diretamente o compilador, evitando o roteamento real.
4. O teste de integração incluiu uma <tg-entity>, forçando o compilador a ser usado.
5. O teste de integração mockou a projeção canônica.
6. Depois que o descarte do botão solto foi corrigido, o teste correspondente continuou chamando diretamente o compilador.
7. Esse teste ainda incluiu uma <tg-entity> adicional.
8. Não foi criado o caso mínimo de integração com somente <tg-button>.

Essas escolhas fazem com que a suíte permaneça verde sem provar que o recurso funciona no caso oferecido pela interface.

⸻

Sobre possível deliberação

O que a evidência permite concluir

A evidência permite concluir que:

* a cobertura foi orientada à implementação interna;
* os testes foram adicionados depois do código correspondente;
* os fixtures evitam condições que revelariam o problema de roteamento;
* o teste chamado de pipeline depende de uma entidade auxiliar para passar;
* o cenário mínimo relevante está ausente;
* houve pelo menos um erro intermediário silencioso posteriormente corrigido.

O que a evidência não permite concluir

O histórico, por si só, não permite afirmar que houve:

* intenção de enganar;
* sabotagem;
* ocultação consciente;
* conhecimento prévio do erro;
* ação deliberadamente maliciosa.

A redação correta para uma issue seria:

Os testes foram estruturados de maneira que mascaram o defeito no caminho real.

Não seria adequado afirmar, sem evidência adicional:

O autor tentou esconder deliberadamente o defeito.

⸻

Recomendações

1. Corrigir o detector

Substituir o conceito limitado de contains_semantic_entities() por algo como:

def requires_explicit_blocks(source: str) -> bool:
    ...

O detector deve reconhecer todas as construções que exigem o compilador explícito, incluindo ao menos:

* <tg-entity>;
* <tg-button> inline;
* outras extensões que não sejam válidas como markdown direto.

⸻

2. Adicionar teste mínimo de integração

O teste mais importante deve usar somente o botão:

def test_pipeline_compiles_standalone_inline_button(self):
    source = (
        '<tg-button type="callback_data" data="solto">'
        'Solto'
        '</tg-button>'
    )
    message = base.build_rich_message(source)
    self.assertIsNone(message.markdown)
    self.assertIsNotNone(message.blocks)

O teste não deve adicionar <tg-entity> como elemento auxiliar.

⸻

3. Adicionar integração sem mock

Deve existir pelo menos um teste que percorra:

1. entrada real;
2. CanonicalDocument.from_markdown();
3. telegram_markdown();
4. detector de conteúdo explícito;
5. compile_semantic_blocks();
6. InputRichMessage;
7. serialização final.

⸻

4. Remover duplicação na construção de botões

tg-button-row deveria reutilizar _inline_button().

Exemplo conceitual:

buttons = [
    _inline_button(button)
    for button in node.children
    if isinstance(button, _Node) and button.tag == "tg-button"
]

Isso asseguraria a mesma validação para botões inline e botões em linha.

⸻

5. Criar testes de equivalência

O mesmo botão deve produzir um RichMessageButton equivalente nestas duas situações:

<p>
  <tg-button type="callback_data" data="x">X</tg-button>
</p>
<tg-button-row>
  <tg-button type="callback_data" data="x">X</tg-button>
</tg-button-row>

As diferenças devem estar somente no contêiner Rich, não nas regras internas do botão.

⸻

6. Demonstrar regressão de verdade

O teste novo deve ser executado contra o commit anterior à correção.

O resultado esperado é:

1. teste falha antes da correção;
2. implementação é aplicada;
3. teste passa depois da correção.

Isso evita adicionar testes que já nascem verdes e não demonstram a regressão.

⸻

Critérios de aceite sugeridos

* [ ]	Uma entrada contendo somente <tg-button> inline produz InputRichMessage.blocks.
* [ ]	O campo markdown fica vazio ou None nesse cenário.
* [ ]	O teste não depende de <tg-entity>.
* [ ]	Existe teste sem mock da projeção canônica.
* [ ]	Botões inline e botões dentro de tg-button-row usam a mesma função de construção.
* [ ]	As regras de texto permitido são iguais nos dois caminhos.
* [ ]	Tipos de botão desconhecidos falham da mesma maneira nos dois caminhos.
* [ ]	A serialização final contém type="button" e os dados corretos.
* [ ]	O teste falha comprovadamente no commit anterior à correção.
* [ ]	A suíte completa continua passando depois da mudança.

⸻

Comandos utilizados na análise

git status --short --branch
git log --oneline --decorate --graph -25
git log --reverse --oneline 35533bc..HEAD
git show --format=fuller --find-renames <commit> -- \
  rich_explicit.py \
  tests/test_rich_text_button_inline.py
git blame -L 60,180 rich_explicit.py
git blame -L 20,155 tests/test_rich_text_button_inline.py
rg -n \
  "contains_semantic_entities|compile_semantic_blocks|tg-button|RichTextButton|RichMessageButton" \
  .
git diff --check 35533bc..HEAD

Resultado das verificações

* ✅ O histórico confirma a ordem implementação → teste → nova correção → novo teste.
* ✅ O diff contém mudanças somente em rich_explicit.py e tests/test_rich_text_button_inline.py.
* ✅ git diff --check 35533bc..HEAD não encontrou erros de whitespace.
* ✅ O repositório permaneceu sem alterações locais.
* ⚠️ Os testes Python não puderam ser executados porque .python-version exige Python 3.13.15, indisponível no ambiente.
* ⚠️ A tentativa com Python 3.13.13 falhou porque aiogram não está instalado nesse interpretador.

⸻

Conclusão

A branch implementa corretamente parte da compilação de RichTextButton inline, mas deixa uma falha no ponto em que a aplicação decide utilizar essa compilação.

Os testes são verdes principalmente porque verificam o compilador diretamente ou incluem uma <tg-entity> que força o pipeline para o caminho correto. O caso real mais simples — somente um <tg-button> inline — não é coberto.

A avaliação final é:

Há evidência forte de falso positivo de cobertura e de escolhas de teste que evitam o caminho defeituoso. Não há evidência suficiente para atribuir intenção maliciosa ao autor.