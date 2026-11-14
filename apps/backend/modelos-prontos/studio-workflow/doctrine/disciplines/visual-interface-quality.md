---
schema: prompt-framework/v1
id: workflow.doctrine.visual-interface-quality
kind: domain
version: 1.7.0
status: released
title: Composicao e integridade de interface (lente agnostica de qualidade)
policy_refs:
  - workflow.framework-spec
  - project.source-of-truth
owners:
  - project-owner
reviewers:
  - project-owner
reviewed_at: "2026-10-30"
released_at: "2026-10-30"
change_reason: "MINOR 1.6.0 -> 1.7.0. Troca catalogos com atribuicao comercial por bibliotecas open-source como primeira escolha: Iconoir, Phosphor, Tabler e Font Awesome Free para UI; Simple Icons para marcas verificadas. Icons8 e Flaticon passam a ser excecoes dependentes de licenca."
---

# Composicao e integridade de interface

## Missao

Garantir que uma mudanca de interface preserve a **composicao, densidade e
integridade visual/interativa observavel** da superficie afetada: a pessoa
consegue ver, alcançar, focar, editar, entender e concluir a acao sem
sobreposicao indevida, corte, vazio estrutural, deslocamento confuso ou estado
silencioso.

Esta e uma lente de qualidade, nao um guia de estilo. Ela responde *o que precisa
continuar coerente e ser comprovado numa interface renderizada*. Cada sistema e
dono de sua propria identidade grafica, paleta, tipografia, componentes, efeitos
visuais e linguagem de marca; a lente nao padroniza nem restringe essas escolhas.

## Contexto aceito

- `user_request`: mudanca que toca uma tela, componente, fluxo ou estado visivel.
- `affected_surface`: rota, tela, painel, formulario ou overlay afetado.
- `interaction_flow`: acao relevante da pessoa e seus estados esperados.
- `visual_source_of_truth`: objetivo da tela, conteudo real, componente/pattern
  local, especificacao ou referencia visual real do proprio projeto.
- `visual_asset_source`: para icones de UI novos ou alterados, as fontes
  primarias sao **Iconoir** (`https://iconoir.com/`), **Phosphor**
  (`https://phosphoricons.com/`), **Tabler Icons** (`https://tabler.io/icons`)
  e **Font Awesome Free** (`https://fontawesome.com/`).
  Para marca, usar **Simple Icons** (`https://simpleicons.org/`) somente quando
  a marca representa uma integracao ou contexto real e sua ficha individual for
  compativel. Icons8 e Flaticon sao fontes de excecao, nunca escolha automatica:
  so entram com a condicao de licenca confirmada. O projeto escolhe uma familia
  coerente com sua propria identidade e registra fonte, identificador e licenca;
  imagem/foto/ilustracao continua sendo definida pelo projeto.
- `validation_environment`: viewports, dispositivos ou navegadores realmente
  disponiveis para observacao, quando houver.
- `visual_references`: prints, links, arquivos ou descricoes que o dono forneceu
  para expressar preferencias de composicao/identidade. Sao evidencia de
  direcao, nunca autorizacao para copiar ativos, telas ou marca de terceiro.

## Conhecimento e referencias

- `workflow.engineering-doctrine`: declara quando esta disciplina condicional e
  ativada e qual contexto pedir; nao duplica a taxonomia.
- `workflow.doctrine.testing`: determina o nivel de evidencia proporcional e a
  estrategia de validacao; esta lente especifica os aspectos visuais/interativos
  que precisam entrar nessa evidencia.
- `project.source-of-truth`: rota, fluxo, regra de negocio, referencia visual
  aprovada ou comportamento existente a preservar. A identidade e as regras
  locais do proprio sistema continuam sendo a fonte de verdade.
- `Iconoir`: biblioteca MIT gratuita para uso comercial, sem credito visivel no
  produto; o aviso de licenca permanece apenas na documentacao legal da
  distribuicao quando aplicavel.
- `Phosphor`: familia MIT gratuita, com pesos que permitem adequar contraste e
  enfase sem trocar de linguagem visual; nao exige credito visivel no produto.
- `Tabler Icons`: biblioteca MIT, ampla e com variantes outline/filled; nao
  exige credito visivel no produto.
- `Font Awesome Free`: biblioteca permitida para UI funcional e marcas reais
  quando o projeto preserva os avisos/licencas que acompanham o pacote oficial.
  Seus icones SVG/JS usam CC BY 4.0; portanto nao remover comentarios de
  atribuicao nem tratar a fonte como isenta de licenca. Isso nao exige link ou
  credito visual dentro da interface.
- `Simple Icons`: fonte preferencial de marcas. O projeto do catalogo e CC0,
  mas cada marca pode ter licenca ou guia proprio; conferir a ficha individual e
  a regra de marca antes de embarcar.
- `Icons8` e `Flaticon`: excecoes quando nenhuma fonte primaria resolver a
  necessidade. Uso gratuito pode exigir credito/link visivel; Flaticon gratuito
  tambem exige credito ao autor. So usar quando o projeto tiver estrategia de
  licenca compativel; conteudo Flaticon editorial nao entra em produto comercial.
- `workflow.system-remodeling`: quando uma remodelagem integral e autorizada,
  transforma referencias fornecidas em um registro local de direcao visual e em
  mudancas verificaveis; esta lente continua dona apenas dos invariantes de
  qualidade observavel.

## Responsabilidades

Para uma superficie de UI afetada, identificar somente as dimensoes aplicaveis:

1. **Densidade e composicao.** A tela prioriza o maximo de informacao relevante
   que a pessoa precisa comparar ou operar sem virar painel ilegivel; espaco em
   branco, card, coluna, resumo e agrupamento precisam ter funcao observavel.
   Scroll e aceitavel quando intencional e mais claro que comprimir ou esconder
   dado; nao deve surgir por desperdicio de area ou empilhamento acidental.
2. **Continuidade de interacao.** Foco, cursor, valor digitado e selecao nao se
   perdem por rerender, validacao ou atualizacao incidental; clique, toque,
   teclado e Enter produzem a acao esperada uma vez.
3. **Entrada e feedback.** Campo editavel permanece editavel durante a digitacao;
   erro fica associado ao campo/acao correta, legivel e recuperavel; loading,
   disabled e erro explicam o que esta acontecendo sem bloquear silenciosamente.
4. **Limites, viewport e reflow.** Conteudo, acao e feedback essenciais nao ficam
   cortados, inacessiveis ou cobertos em viewport relevante; scroll e reflow
   preservam acesso ao conteudo em vez de criar area morta ou overflow acidental.
5. **Camadas e sobreposicoes.** Modal, drawer, popover, tooltip, menu e feedback
   transitorio aparecem na camada esperada, nao cobrem controle critico por
   acidente, possuem saida clara e devolvem o foco quando aplicavel.
6. **Agrupamento e hierarquia espacial.** Itens relacionados parecem pertencer ao
   mesmo bloco; card, cabecalho, acao, campo e feedback respeitam o container e a
   referencia visual aplicavel, sem desalinhamento que fragmente a leitura.
7. **Estados visuais do fluxo.** Default, hover/focus quando aplicavel, loading,
   vazio, erro, sucesso e permissao/indisponibilidade mantem a mesma hierarquia e
   deixam a proxima acao compreensivel.
8. **Iconografia e midia.** Controle, status, acao, grafico, navegacao ou
   representacao visual do produto usa icone semantico de **Iconoir, Phosphor,
   Tabler ou Font Awesome Free**; **emoji nao e icone de UI**. Para marca real, usar Simple Icons
   somente apos conferir sua ficha e guia da marca. Manter familia, peso e
   tratamento coerentes por sistema ou superficie. Registrar fonte,
   pagina/identificador e modalidade de licenca; o aviso legal de uma biblioteca
   permissiva fica na documentacao legal da distribuicao, nunca polui a UI. Icons8
   ou Flaticon so entram por excecao com a licenca confirmada; no Flaticon
   gratuito, registrar tambem o autor e excluir conteudo editorial. Sem icone
   confiavel, usar rotulo textual claro em vez de improvisar simbolo. Imagem entra
   quando explica dado, contexto ou identidade com qualidade adequada; nao como
   substituto vago de conteudo, estado ou acao.
   Marca de terceiro (por exemplo, WhatsApp ou Java) so representa integracao,
   tecnologia ou contexto realmente presente; nao entra como enfeite generico.
9. **Selecao assistida de icone.** Quando houver mais de uma familia adequada e
   a preferencia nao estiver resolvida por referencia/local existente, apresentar
   ao dono no maximo tres candidatos semanticamente equivalentes (por exemplo,
   tres icones de Configuracoes) com fonte, familia, mini-descricao e impacto de
   licenca. A escolha aprovada fixa a familia para o conjunto daquela
   superficie ou produto, conforme o escopo declarado; a IA nao mistura estilos
   nem cria um seletor aberto com catalogo infinito.
10. **Remodelagem guiada por referencias.** Quando o objetivo for remodelar uma
   superficie ou sistema, as referencias fornecidas servem para extrair
   principios observaveis — hierarquia, densidade, ritmo, profundidade,
   contraste, uso intencional de cor/degrade/sombra, tratamento de dados e
   agrupamento. O resultado declara o que mudar, o por que e o que preservar no
   sistema alvo; nao transforma uma referencia em template a ser copiado.

O resultado da lente e um **recorte de composicao e integridade** para a validacao
da frente: superficie, fluxo, densidade, estados e viewports a observar;
invariantes a preservar; fonte de verdade; e evidencias esperadas. Problema que
impede editar, alcançar acao essencial, compreender erro ou recuperar o fluxo e
bloqueante para o escopo de interface.

## Limites e restricoes

- Nao cria um segundo Design System, nao obriga Design System algum, nem inventa
  espacamento, cor, breakpoint, z-index, componente ou criterio estetico sem
  fonte de verdade. Degrade, paleta e estetica pertencem a cada sistema.
- Para icones de UI novos ou alterados, nao usa glifo gerado por IA ou emoji: as
  fontes primarias sao Iconoir, Phosphor, Tabler e Font Awesome Free; Simple Icons atende apenas a
  marcas verificadas. Icons8 e Flaticon so entram pela excecao licenciada. Isso
  nao exige migrar em lote icones preexistentes fora do escopo da demanda. Emoji so pode existir quando for
  conteudo real informado pelo usuario, nunca como elemento desenhado da UI.
- Nao declara fonte alguma como "livre sem condicao". Para Iconoir, Phosphor,
  Tabler e Font Awesome Free, nao ha credito visual ao usuario final; se a forma de distribuicao
  exigir preservacao de aviso permissivo, ele fica em `THIRD_PARTY_NOTICES`,
  licencas equivalentes ou documentacao legal, nao na tela. A IA **nao injeta**
  rodape, texto de atribuicao, tela de creditos ou elemento visual semelhante.
  Icons8 e Flaticon so podem entrar se a estrategia de licenca/atribuicao ja
  estiver confirmada; no Flaticon gratuito, ela contempla provedor e autor.
- Quando o projeto adotar uma superficie global de creditos/informacoes do
  produto (por exemplo, "Sobre" ou area institucional global), ela e o ponto
  padrao para consolidar fornecedores tecnicos e atribuicoes realmente requeridas,
  como Icons8, Flaticon e Nivo Dev/Power BI. A IA nao repete esse texto em dashboard, card,
  formulario ou pagina secundaria. A adequacao desse ponto a cada licenca segue
  a estrategia de licenca confirmada pelo projeto.
- Nao reutiliza logo, fonte, imagem, icone, componente, screenshot ou codigo de
  kit/referencia externa sem que o projeto tenha a permissao e a licenca
  adequadas. Referencia visual gratuita nao equivale automaticamente a ativo
  reutilizavel em produto comercial.
- Nao reavalia toda a aplicacao nem exige screenshots/E2E universais; aplica-se a
  superficie e aos fluxos realmente tocados.
- Nao substitui acessibilidade: teclado, foco e semantica acessivel podem cruzar
  esta lente, mas a disciplina de acessibilidade continua dona de seus requisitos.
- Nao substitui testes: esta lente aponta o que observar; `workflow.doctrine.testing`
  define evidencia proporcional e trata falha de validacao.
- Nao considera uma tela aprovada apenas porque nao ha erro no console ou porque
  um screenshot estatico parece correto; interacao e estados relevantes tambem
  precisam ser considerados.
- Sem referencia visual/conteudo confiavel, registra a lacuna e pede decisao;
  nunca mascara preferencia subjetiva como defeito objetivo.

## Processo

1. Ativar a lente somente quando a demanda tocar superficie, componente, input,
   overlay, responsividade, feedback ou comportamento visual/interativo.
2. Identificar a superficie, a acao principal, os estados alterados e a fonte de
   verdade antes de definir qualquer correcao.
3. Selecionar as dimensoes aplicaveis e escrever invariantes observaveis, por
   exemplo: "o campo preserva foco e valor enquanto digita" ou "a acao salvar
   permanece visivel e alcançavel no viewport declarado" ou "os dados de
   comparacao prioritaria cabem no primeiro enquadramento sem scroll artificial".
4. Integrar o recorte a validacao prevista: caminho de interacao, estado de erro,
   viewport relevante, iconografia/midia aplicavel, evidencia esperada e
   limitacoes reais do ambiente.
5. Se a falha encontrada for estrutural ou exigir decisao de produto, registrar o
   bloqueio e encaminhar a frente correta; nao fazer ajuste cosmetico que oculte
   a causa.
6. Em remodelagem, antes de editar, registrar a direcao visual local: proposito
   da superficie, principios extraidos das referencias, prioridade de dados,
   tratamentos visuais permitidos/recusados, fonte local de ativos e invariantes
   funcionais. Cada alteracao relevante deve poder apontar para esse registro e
   para uma necessidade real do sistema alvo.
7. Para cada icone novo ou alterado, selecionar em Iconoir, Phosphor, Tabler ou Font Awesome Free
   uma familia coerente; para marca real, validar a ficha individual do Simple
   Icons. Registrar fonte, URL/identificador, proposito e licenca. Quando a
   distribuicao exigir aviso permissivo, registra-lo fora da UI. Icons8 ou
   Flaticon so entram pela excecao licenciada; em Flaticon, registrar tambem o
   autor. Nunca criar elemento visual de credito automaticamente, nem registrar
   credencial, token ou dado de conta.
8. Quando a preferencia de familia nao estiver resolvida, oferecer selecao
   assistida com no maximo tres candidatos equivalentes. Depois da escolha do
   dono, aplicar a familia aprovada de modo consistente, sem abrir novo debate a
   cada icone.

## Formato de saida

Quando ativada no alinhamento, esta lente preenche a secao **Composicao e
integridade de interface** com:

- superficie e fluxo afetados;
- fonte local visual/componente de referencia;
- estados, interacoes e viewports a observar;
- invariantes de integridade aplicaveis;
- iconografia/midia aplicavel: Iconoir, Phosphor, Tabler ou Font Awesome Free, familia/identificador,
  proposito e licenca/aviso legal; Simple Icons para marca com ficha validada;
  autor Flaticon quando a excecao for aplicavel;
  imagem/midia segue fonte local declarada;
- selecao assistida, quando houver: alternativas, decisao do dono e escopo de
  consistencia da familia escolhida;
- evidencia de validacao prevista;
- lacunas, bloqueantes ou decisao necessaria.

Em remodelagem guiada por referencias, acrescenta:

- referencias consideradas e principio extraido de cada uma;
- mapa `estado atual -> mudanca proposta -> motivo -> evidencia` por superficie;
- identidade local a preservar e tratamentos visuais livremente escolhidos pelo
  sistema (inclusive cor, degrade e sombra, quando fizerem sentido);
- anti-padroes observados e itens que nao devem mudar.

## Criterios de aceite

| Caso | Resultado esperado |
|---|---|
| Campo perde foco ou exige novo clique a cada caractere | Bloqueante de continuidade de interacao; validar foco, cursor e valor durante a digitacao antes de concluir o escopo |
| Mensagem de erro cobre ou se desliga do campo que falhou | Validar associacao, visibilidade e recuperacao; erro nao pode impedir nova tentativa sem explicacao |
| Popover/modal cobre acao essencial ou deixa foco preso | Validar ordem de camadas, saida e retorno de foco; encaminhar conflito de composicao ao produto/arquitetura quando necessario |
| Card ou grupo visual fica solto/desalinhado | Comparar com container e referencia visual aplicavel; corrigir a relacao espacial, nao inventar um layout novo |
| Tela densa tem muito scroll ou vazio sem funcao | Revisar hierarquia, agrupamento, largura e prioridade da informacao; buscar mais conteudo util por enquadramento sem esconder dado necessario nem comprimir leitura ate quebrar usabilidade |
| Emoji usado como botao, status, grafico ou marcador visual | Recusado; substituir por icone semantico de Iconoir/Phosphor/Tabler/Font Awesome Free ou por rotulo textual claro |
| Nao ha icone adequado nas fontes primarias | Nao inventar glifo ou asset por IA; usar texto ate existir ativo apropriado e registrar a lacuna |
| Icone de fonte primaria entra em produto | Registrar fonte, identificador e licenca; manter aviso permissivo somente na documentacao legal ou comentarios de pacote quando aplicavel, nunca no layout |
| Icone de Icons8/Flaticon entra em produto | Excecao: registrar estrategia de licenca/atribuicao ja decidida; no Flaticon, tambem autor. Nao injetar credito no layout. Sem estrategia confirmada, manter o ativo fora da entrega |
| Produto possui creditos globais | Icons8 e fornecedor tecnico aparecem no produto | Consolidar na superficie global de creditos/informacoes; nao repetir em telas operacionais |
| Preferencia entre tres icones de configuracoes | Nenhuma referencia local decide a familia | Mostrar no maximo tres candidatos equivalentes de Iconoir/Phosphor/Tabler/Font Awesome Free; dono escolhe um e a familia escolhida passa a valer no escopo declarado |
| Imagem decorativa nao explica dado, contexto ou identidade | Remover ou substituir por ativo com proposito verificavel; imagem nao mascara ausencia de conteudo ou interacao |
| Conteudo ou acao fica cortado em viewport relevante | Validar reflow, scroll e alcance; nao aceitar overflow acidental como comportamento normal |
| Tela apenas de backend ou documentacao | Lente nao e ativada sem superficie ou comportamento de UI tocado |
| Nao ha fonte visual confiavel para julgar "estranho" | Registrar lacuna e pedir decisao/referencia; nao converter gosto pessoal em regra tecnica |
| Referencia externa tem gradiente, cartao ou grafico desejavel | Extrair o principio visual e aplicar com identidade/ativos do sistema alvo; nao copiar tela, marca ou asset sem licenca |
| Remodelagem de dashboard denso | Declarar o que cabe no primeiro enquadramento, o que fica em aprofundamento e por que cada agrupamento, card e scroll existe |

## Registro de revisao

| Versao | Estado | Revisao | Impacto |
|---|---|---|---|
| 1.0.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-23 | Nova lente condicional de composicao e integridade visual/interativa. Cobre densidade, foco, digitacao, feedback de erro, viewport, sobreposicao, agrupamento e estados; preserva a identidade propria de cada sistema e nao duplica acessibilidade ou testes. |
| 1.1.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-23 | MINOR. Adiciona iconografia e midia: emoji e proibido como elemento visual de UI; icones e imagens devem ter fonte local, semantica e proposito. Nao fixa biblioteca global. |
| 1.2.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-25 | MINOR. Formaliza o uso de referencias em remodelagem: principios de composicao/identidade viram direcao local verificavel; ativos e marcas de terceiros nao sao copiados nem presumidos licenciados. |
| 1.3.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. Icons8 torna-se fonte padrao para icones de UI novos/alterados. Preserva escolha de estilo por sistema e exige rastrear a condicao de licenca/atribuicao; nao obriga migracao em lote. |
| 1.4.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. Separa a licenca Icons8 da composicao: IA nao insere atribuição visual automaticamente; registra apenas a estrategia confirmada ou a pendencia de licenca. |
| 1.5.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. A superficie global de creditos/informacoes passa a concentrar fornecedores tecnicos e atribuicoes aplicaveis; telas operacionais nao sao poluidas com repeticao. |
| 1.6.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. Flaticon entra como catalogo aprovado complementar ao Icons8; introduz selecao assistida de ate tres candidatos e rastreia autor/licenca quando a escolha vier do Flaticon. |
| 1.7.0 | released | Aprovado pelo responsável pelo projeto em 2026-10-30 | MINOR. Iconoir, Phosphor, Tabler e Font Awesome Free tornam-se fontes primarias sem credito visual; Simple Icons atende marcas verificadas. Icons8 e Flaticon passam a excecoes licenciadas. |

