---
schema: prompt-framework/v1
id: workflow.system-remodeling
kind: task
version: 1.5.0
status: released
title: Alinhar e executar remodelagem estrutural de interface
extends: workflow.system-change-base@2.0.0
policy_refs:
  - project.rules
  - project.source-of-truth
inputs:
  - user_request
  - repository_state
  - visual_references
  - validation_environment
outputs:
  - remodeling_alignment
  - visual_direction_record
  - remodeling_map
  - validation_evidence
  - execution_progress_report
owners:
  - project-owner
reviewers:
  - project-owner
reviewed_at: "2026-10-30"
released_at: "2026-10-30"
change_reason: "MINOR 1.4.0 -> 1.5.0. Adota Iconoir, Phosphor, Tabler e Font Awesome Free como fontes primarias de UI sem credito visual; Simple Icons cobre marcas verificadas. Icons8 e Flaticon passam a excecoes com licenca confirmada."
---

# Alinhar e executar remodelagem estrutural de interface

## Missao

Remodelar a **estrutura visual e interativa** de um sistema alvo para que suas
telas densas sejam coesas, operaveis e alinhadas a uma direcao visual propria,
usando referencias fornecidas pelo responsavel pelo projeto como repertorio de principios — nunca
como uma interface a copiar.

"Estrutura" nesta task significa organizacao de informacao, hierarquia,
agrupamento, superficies, navegacao, estados, responsividade e comportamento
visual/interativo. Regra de negocio, fluxo de produto, contrato, dado ou
permissao so mudam se estiverem explicitamente no escopo e tiverem sua propria
fonte de verdade.

## Contexto aceito

- `user_request`: comando de remodelagem, sistema/area alvo e objetivo de uso.
- `repository_state`: codigo, telas, documentacao e estado Git reais do projeto
  alvo, lidos somente depois de a task ser invocada.
- `visual_references`: prints, links, arquivos ou descricao das preferencias do
  responsavel pelo projeto e de seus clientes; podem apontar para composicao, densidade, atmosfera,
  cor, degradê, sombra, dados ou interacao.
- `validation_environment`: comandos, navegadores, viewports, dados de teste e
  meios realmente disponiveis para verificar a remodelagem.

## Conhecimento e referencias

- `workflow.system-change-base@2.0.0`: execucao delimitada depois do clique em
  **Fazer**, Progress Model, comandos de verificacao e criterios de pronto.
- `workflow.doctrine.visual-interface-quality@1.7.0`: qualidade observavel de
  composicao, interacao, viewport, camadas, iconografia e midia.
- `project.rules` e `project.source-of-truth`: regras, arquitetura, dominio,
  convencoes e identidade que pertencem ao sistema alvo.
- Referencias externas expressam preferencia e repertorio. Sua licenca e seus
  ativos nao sao presumidos transferiveis ao projeto alvo.

## Responsabilidades

- Produzir o alinhamento abaixo como texto do plano **Posso fazer isto**, com
  etapas, comandos de verificacao e criterios de pronto; editar somente depois
  que o usuario clicar **Fazer**.
- Inspecionar as superficies reais e produzir um inventario proporcional de
  telas, fluxos, componentes e problemas observaveis; nao julgar por screenshot
  isolado quando a interacao real estiver disponivel.
- Criar um **Registro de direcao visual local**, suficiente para esta frente:
  proposito, principios extraidos, hierarquia, densidade, tratamento de cor,
  degradê/sombra quando pertinente, iconografia/midia, invariantes e
  anti-padroes. Ele nao e Design System e nao vira regra para outro produto.
- Para cada icone de UI novo ou alterado, usar **Iconoir, Phosphor, Tabler ou Font Awesome Free**,
  escolher uma familia coerente com a identidade local e registrar fonte, URL ou
  identificador, proposito e licenca. Para marca real, usar Simple Icons somente
  apos validar a ficha individual. Icons8 e Flaticon sao excecoes licenciadas;
  em Flaticon gratuito, registrar tambem o autor indicado pelo provedor.
- Quando uma familia ainda nao estiver decidida, oferecer ao responsavel pelo projeto uma selecao
  assistida com no maximo tres candidatos semanticamente equivalentes. A escolha
  aprovada vira o padrao consistente do escopo definido; nao misturar estilos
  sem nova decisao nem criar navegador de catalogo infinito dentro do produto.
- Produzir um **Mapa de remodelagem** por superficie: estado atual, mudanca,
  motivo, evidencia/referencia, comportamento preservado e validacao.
- Editar em slices coerentes depois do gate; para mais de uma superficie ou camada, manter o
  Progress Model com denominador objetivo (superficies/slices/gates definidos)
  ou fases/marcos quando ainda nao houver denominador confiavel.
- Preservar comportamento funcional, dados, acessibilidade, foco, entrada,
  erros, camadas e viewport; corrigir regressao visual/interativa descoberta no
  escopo.
- Entregar arquivos modificados, evidencia de validacao, progresso/estado real e
  pendencias ou decisoes que de fato restarem.

## Limites e restricoes

- Nao padroniza paleta, tipografia, grid, biblioteca de componentes, estilo de
  icone, gradiente, sombra ou linguagem grafica entre sistemas. Cada sistema
  mantem sua identidade; tratamentos visuais expressivos sao permitidos quando
  reforcam hierarquia e leitura.
- Nao usa emoji como icone, status, grafico, controle ou elemento desenhado de
  UI. Para icone de UI novo/alterado, usa ativo semantico de Iconoir, Phosphor,
  Tabler ou Font Awesome Free; Simple Icons so atende marca real validada; sem ativo adequado, usa
  texto claro.
- Fontes primarias nao exigem credito visual ao usuario final. Quando a forma de
  distribuicao exigir aviso permissivo, ele vive em `THIRD_PARTY_NOTICES`, no
  arquivo oficial do pacote ou equivalente legal, nunca na UI. Font Awesome Free
  preserva os comentarios de atribuicao do pacote. Icons8 ou Flaticon nao sao presumidos gratuitos
  sem condicao e so entram com estrategia de licenca/atribuicao confirmada; em
  Flaticon gratuito, ela inclui provedor e autor. Nao registrar credencial, token
  ou dado de conta.
- Nao substitui em lote icones preexistentes que estejam fora do escopo do slice;
  a padronizacao incide sobre novos icones e sobre os que forem tocados.
- Quando o projeto usar uma superficie global de creditos/informacoes, concentra
   ali atribuicoes e fornecedores tecnicos aplicaveis (por exemplo, Icons8,
  Flaticon e Nivo Dev/Power BI), conforme a estrategia de licenca confirmada. Nao repete
  creditos em dashboard, card, formulario ou pagina secundaria.
- Nao copia marca, tela, codigo, fonte, imagem, icone ou componente de uma
  referencia externa, nem baixa/embarca um kit, sem licenca e autorizacao
  compativeis. Referencias podem ser analisadas sem download.
- Nao inventa preferencia estetica ausente. Se referencias e fontes locais nao
  resolverem uma decisao material de identidade, apresenta alternativas
  objetivas e para para a decisao do responsavel pelo projeto.
- Nao altera regra de negocio, contrato, dado, permissao, integracao ou outro
  produto para "fazer caber" no novo visual. Mudanca funcional necessaria vira
  escopo separado ou usa o fluxo adequado.
- Nao aceita screenshot estatico como evidencia unica quando houver fluxo de
  digitacao, erro, loading, overlay, scroll, responsividade ou teclado tocado.
- A IA nao executa comandos, testes, deploy, commit, tag, push, publicacao
  externa ou acao destrutiva. Declara comandos de verificacao e criterios; o
  sistema executa. O gate **Fazer** e qualquer gate de `project.rules`
  continuam obrigatorios.

## Processo

1. Confirmar que o pedido identifica a remodelagem e o sistema/area. Registrar o
   **Alinhamento de remodelagem** como texto do plano antes de editar. Pedido
   vago como "deixe bonito" exige pergunta ao usuario, sem plano de execucao.
2. Ler as regras do projeto e inspecionar o sistema alvo: superficies, jornadas,
   conteudo real, componentes existentes, estados, viewports e restricoes.
3. Inventariar o escopo em unidades verificaveis. Para frente segmentada, fixar
   baseline inicial por superficies, fluxos ou gates; nao contar microajustes.
4. Analisar referencias e criar o Registro de direcao visual local. Para cada
   principio, indicar a evidencia que o sustenta e sua traducao para o sistema
   alvo; registrar identidade/funcao que deve permanecer intacta.
5. Criar o Mapa de remodelagem, separando: correcoes de integridade, mudancas de
   composicao, mudancas de linguagem visual e itens explicitamente fora de
   escopo. Toda mudanca relevante responde "o que muda" e "por que agora".
6. Depois do clique em **Fazer**, se nao houver decisao material aberta, editar os slices pela ordem que
   reduz risco: estrutura/agrupamento, comportamento e estados, linguagem visual
   e acabamento. Continuar automaticamente dentro desse mapa; parar apenas nas
   condicoes dos Limites.
7. Para cada icone novo/alterado, selecionar em Iconoir, Phosphor, Tabler ou Font Awesome Free uma
   familia coerente e registrar fonte/referencia/licenca; para marca, validar a
   ficha individual de Simple Icons. Icons8 ou Flaticon so entram pela excecao
   licenciada; em Flaticon, registrar autor quando aplicavel. Sem icone adequado,
   manter rotulo textual claro.
8. Quando a preferencia de familia estiver aberta, oferecer selecao assistida de
   ate tres candidatos equivalentes e registrar a escolha. Aplicar a familia
   aprovada de modo consistente no escopo, sem reapresentar opcoes a cada icone.
9. Validar cada superficie afetada com conteudo realista e estados aplicaveis:
   interacao/digitacao, erro, loading, vazio, overlay, viewport e acao critica.
   Comparar contra o Registro de direcao, nao contra uma copia da referencia.
10. Atualizar o Progress Model somente em avancos materiais, marco, risco ou
   bloqueio. Encerrar apenas quando as unidades do escopo e a validacao prevista
   estiverem satisfeitas.

## Formato de saida

No primeiro retorno, antes de editar, registrar de forma concisa:

```md
## Alinhamento de remodelagem
- Gate do Nivoo: aguardando Fazer | autorizado por Fazer
- Sistema e superficies: ...
- Objetivo operacional: ...
- Referencias consideradas: ...
- Escopo / fora de escopo: ...
- Baseline de remodelagem: ... | fase/marco atual: ...
- Riscos, lacunas ou decisao material: ...

## Registro de direcao visual local
- Identidade a preservar: ...
- Principios de composicao e densidade: ...
- Tratamento visual permitido e seu proposito: ...
- Interacao, estados e viewport: ...
- Iconografia: Iconoir/Phosphor/Tabler/Font Awesome Free — fonte, familia, URL/identificador,
  proposito e licenca/aviso legal; Simple Icons para marca validada; Icons8/
  Flaticon somente por excecao licenciada; emoji: proibido como UI; creditos
  globais aplicaveis: ...
- Selecao assistida, quando aplicavel: tres candidatos no maximo; escolha e
  escopo de consistencia: ...
- Anti-padroes a remover/evitar: ...

## Mapa de remodelagem
| Superficie | Estado atual | Mudanca | Por que | Preserva | Validacao |
|---|---|---|---|---|---|
```

Nos relatos de execucao segmentada, usar o formato do Progress Model. No fim,
informar resultado primeiro, seguido por superficies remodeladas, arquivos
alterados, evidencias, estado/progresso e somente pendencias reais.

## Criterios de aceite

| Caso | Entrada reduzida | Resultado esperado |
|---|---|---|
| Dashboard com referencias e cinco superficies | "Remodele usando estes prints; priorize informacao util e identidade propria" | Registra direcao/matriz antes de editar; baseline `0/5`; remodela por superficie, com progresso objetivo e validacao por estado/viewport |
| Sistema com visual local ruim, mas sem kit externo | Referencias de atmosfera e composicao | Extrai principios sem adotar Studio UX/DS; usa Iconoir, Phosphor, Tabler ou Font Awesome Free para icones novos/alterados e registra lacuna se nao houver icone adequado |
| Referencia de terceiro com logo e icones | Link ou screenshot de kit gratuito | Usa apenas como repertorio; nao copia/embarca ativo nem presume licenca comercial |
| Pedido de cor, gradiente e sombra | "Quero uma interface moderna e expressiva" com referencias | Pode aplicar tratamento visual local com proposito, contraste e estados verificaveis; nao reduz a identidade a tema global neutro |
| Falta decisao de identidade material | "Melhore tudo" sem area, referencia ou fonte visual | Pergunta ao usuario na conversa, sem propor execucao nem inventar estilo |
| Campo perde foco apos remodelagem | Fluxo de filtro digitavel | Falha de aceite ate foco, cursor e valor permanecerem durante digitacao |
| Tela densa ganha muito scroll | Nova composicao empilha todos os blocos | Falha de aceite; revisa prioridade, agrupamento e primeiro enquadramento sem esconder dado necessario |
| Slice visual finalizado, frente maior aberta | Uma tela validada de varias | Slice pode estar `100%`; frente permanece `in-progress` ate demais superficies e gates |
| Emoji proposto para status | "Use um emoji de alerta" | Recusa como UI; usa icone Iconoir/Phosphor/Tabler/Font Awesome Free semantico ou rotulo textual claro |
| Icone de fonte primaria em produto | Acao ou status recebe novo icone | Registra fonte, identificador/familia e licenca; aviso permissivo, se aplicavel, fica no registro legal, nunca na UI |
| Icone de Icons8/Flaticon em produto | Excecao recebe novo icone | Registra estrategia de licenca/atribuicao; em Flaticon, tambem autor. Nao cria credito visual automatico. Sem estrategia, nao embarca o ativo |
| Projeto tem area global de creditos | Icons8/Flaticon e Power BI/Nivo Dev sao fontes declaradas | Consolida apenas os creditos requeridos nessa area, sem inseri-los nas telas operacionais |
| Familia de icones indefinida | Tres versoes adequadas de "Configuracoes" | Apresenta no maximo tres candidatos equivalentes com fonte/familia/licenca; registra escolha e a aplica consistentemente no escopo |

## Como propor no Nivoo

Quando o contexto/referencias ja estiverem na conversa, produzir o alinhamento
de remodelagem como texto do plano **Posso fazer isto**, incluindo etapas,
comandos de verificacao e criterios de pronto. Exemplo de pedido:

> Siga `workflow.system-remodeling@1.5.0`. Faça o alinhamento de remodelagem e
> remodele a estrutura visual deste sistema usando as referencias anexas.

Mesmo em pedido imperativo, nada e editado antes de o usuario clicar **Fazer**.
Durante o trabalho, decisao material, gate ou bloqueio faz a etapa parar e pedir
confirmacao.

## Registro de revisao

| Versao | Estado | Revisao | Impacto |
|---|---|---|---|
| 1.0.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-25 | Nova task executora de remodelagem visual. Converte referencias em direcao local e mapa de mudancas, preserva identidade propria e comportamento e usa progresso evidenciado. No Nivoo, toda edicao exige o gate **Fazer**. |
| 1.1.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. Icons8 passa a ser a fonte de icones de UI novos/alterados na remodelagem, com consistencia de familia e verificacao de licenca/atribuicao. |
| 1.2.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. A task nao injeta credito/rodape visual para Icons8; registra apenas a estrategia de licenca definida ou uma pendencia antes de embarcar o ativo. |
| 1.3.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. Consolida, quando existente, Icons8 e fornecedores como Nivo Dev/Power BI na superficie global de creditos/informacoes do produto; nao polui telas operacionais. |
| 1.4.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. Flaticon entra como catalogo aprovado e a task passa a oferecer selecao assistida de familia com ate tres candidatos; preserva rastreabilidade de autor/licenca. |
| 1.5.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-30 | MINOR. Iconoir, Phosphor, Tabler e Font Awesome Free tornam-se fontes primarias sem credito visual; Simple Icons atende marcas verificadas. Icons8/Flaticon viram excecoes licenciadas. |

