---
schema: prompt-framework/v1
id: workflow.capability-contract
kind: shared
version: 1.0.0
status: reviewed
title: Contrato agnostico de Capability (mapa, contrato, slices, estados, aceitacao)
policy_refs:
  - workflow.framework-spec
owners:
  - project-owner
reviewers:
  - project-owner
reviewed_at: "2026-09-13"
change_reason: "Nova frente (completude estrutural). Introduz a capacidade de produto (Capability) como unidade de completude: Capability Map, Capability Contract (o que precisa existir para a capacidade ser funcionalmente completa), cobertura implicita da capacidade, implementacao em slices ligados ao mesmo contrato, estados da capacidade, Capability Acceptance (prova de que a capacidade integrada esta pronta, so quando o contrato esta estruturalmente completo), Definition of Done e rastreabilidade. Codifica a regra de ouro: implementacao pode ser incremental, aceitacao nao deve ser fragmentada enquanto houver dependencias estruturais abertas. E contrato agnostico: nao implementa capacidade real, nao contem fato de projeto. Nasce draft."
---

# Contrato de Capability

## Missao

Definir a **capacidade de produto** (Capability) como a unidade de completude do
Workflow, e o contrato que declara o que precisa existir para uma capacidade ser
considerada **funcionalmente completa**. O objetivo e preservar a implementacao
incremental e, ao mesmo tempo, impedir **conclusao fragmentada sem visao
estrutural do todo**.

**Regra de ouro:** implementacao pode ser incremental; **aceitacao nao deve ser
fragmentada** quando a capacidade ainda possui dependencias estruturais abertas.
Corolario: nao validar como produto pronto aquilo que ainda esta sendo construido
como parte de uma capacidade maior.

Este ativo e o **contrato** das capacidades — o modelo agnostico. Ele nao
implementa nenhuma capacidade e nao contem fato de nenhum projeto.

## O que e uma Capability

Uma Capability representa uma **capacidade completa percebida pelo usuario ou pelo
sistema**. Exemplos conceituais (nao exaustivos): atendimento WhatsApp; cadastro
de associado; recuperacao de conta; cobranca; gestao de equipes; mapa financeiro;
amortizacao de divida.

Uma Capability **nao e**:

- um arquivo;
- um endpoint;
- um componente;
- uma tabela;
- uma task isolada.

Ela pode **atravessar varias camadas e modulos** (dados, backend, permissoes, UI,
integracoes, eventos). E justamente por atravessar o sistema que ela e a unidade
certa para julgar completude — nenhuma parte isolada prova que a capacidade esta
pronta.

## Capability Map

O **mapa de capacidades** e a lista das capacidades relevantes do produto,
mantida no nivel do Baseline (ver `workflow.architecture-baseline`, dimensao "mapa
de capacidades do produto"). Cada capacidade tem `id`, `nome`, e um `estado` (ver
*Estados da Capability*). O mapa nao detalha a capacidade; aponta o Capability
Contract de cada uma. Serve para responder, a qualquer momento: quais capacidades
o produto tem, quais estao completas, quais estao em construcao, quais estao
bloqueadas.

## Capability Contract

Antes de implementar uma capacidade relevante, o Workflow deve **criar ou
identificar** um Capability Contract.

**Missao do contrato:** declarar o que precisa existir para que essa capacidade
seja considerada **funcionalmente completa** — a fronteira entre "em construcao" e
"pronta". O contrato e **agnostico e extensivel**; nem todo campo se aplica a toda
capacidade.

Campos conceituais sugeridos (declarar so os reais; ausencia relevante e
explicita, nunca inventada):

| Campo | Nota |
|---|---|
| `id` | estavel; namespace do projeto (ex.: `<projeto>.capability.<slug>`) |
| `nome` | humano |
| `objetivo` | o que a capacidade entrega ao usuario/sistema |
| `atores` | quem usa / dispara |
| `entradas` | o que entra |
| `saidas` | o que sai |
| `estados` | estados da propria capacidade no dominio |
| `fluxos principais` | caminhos esperados |
| `fluxos alternativos` | variacoes previstas |
| `erros` | falhas tratadas |
| `permissoes` | quem pode o que |
| `dados` | modelos/persistencia envolvidos (referencia o Baseline/Blueprint) |
| `integracoes` | terceiros/servicos envolvidos |
| `eventos` | eventos/assincrono, quando aplicavel |
| `ui / superficies` | telas e superficies |
| `responsividade` | quando ha UI |
| `acessibilidade` | quando ha UI |
| `seguranca` | riscos e controles relevantes |
| `auditoria` | o que precisa ser rastreavel |
| `observabilidade` | logs/metricas/alertas relevantes |
| `dependencias` | outras capacidades/modulos de que depende |
| `criterios de aceitacao` | condicoes verificaveis de completude |
| `fora de escopo` | itens explicitamente **nao** incluidos |

**Nao criar estrutura burocratica excessiva.** O contrato e uma declaracao de
completude, nao um formulario obrigatorio de N campos. Uma capacidade pequena tem
um contrato curto.

## Cobertura implicita da capacidade

O usuario **nao precisa listar manualmente** todos os comportamentos obvios de uma
capacidade conhecida. Exemplo: se a capacidade e **atendimento WhatsApp**, a
especialidade e o Workflow devem considerar o **espaco funcional esperado**, como
aplicavel: envio; recebimento; texto; midia; audio; video; documento; imagem;
templates; status; erros; janela de atendimento; persistencia; conversa;
mensagens; permissoes; auditoria; observabilidade; reconexao; fallback.

Isso **nao significa implementar tudo sempre**. Significa que o Workflow deve:

1. **considerar** o conjunto esperado da capacidade;
2. **declarar o que entra** (escopo do contrato);
3. **declarar o que nao entra** (`fora de escopo`);
4. **evitar marcar a capacidade como concluida** quando partes esperadas
   continuam ausentes sem estarem declaradas fora de escopo.

**Nao inventar funcionalidades arbitrarias.** O espaco esperado vem de fontes
reais, nunca de suposicao: a **especialidade**; o **dominio**; os **contratos
oficiais**; a **documentacao do projeto**; o **Blueprint**; o **contexto real**.
O que nao for coberto por essas fontes nao e "espaco esperado" — e ideia nova, que
precisa de decisao.

## Implementacao em slices

A implementacao incremental e preservada. Uma Capability pode ser construida em
varios **slices**. Exemplo (capability WhatsApp): slice 1 texto; slice 2 imagem;
slice 3 audio; slice 4 video; slice 5 status.

Regras:

- Todos os slices permanecem **ligados ao mesmo Capability Contract**.
- Cada slice **atualiza o estado** da capacidade (ver abaixo).
- **Nao declarar a Capability pronta** enquanto o contrato nao estiver satisfeito,
  por mais slices que ja tenham sido entregues.
- Um slice e uma sub-frente com checkpoint (`COMO-INTERAGIR §7`); nao e a
  capacidade.

## Estados da Capability

Conjunto **enxuto** (evitar excesso de estados). Distinguir sempre `slice
implementado` de `capability concluida`.

| Estado | Significado |
|---|---|
| `planned` | capacidade mapeada, com ou sem contrato; ainda nao iniciada |
| `in-progress` | ha slices em construcao; o contrato ainda nao esta estruturalmente completo |
| `structurally-complete` | o Capability Contract esta estruturalmente satisfeito (todas as partes declaradas existem e as dependencias obrigatorias estao implementadas); **pronta para Capability Acceptance** e ainda nao aceita |
| `accepted` | Capability Acceptance concluida com evidencia suficiente; a capacidade esta pronta para uso |
| `blocked` | uma dependencia estrutural aberta, conflito de regra ou decisao pendente impede avancar |

`structurally-complete` **e** o estado de "aceitacao pendente": a aceitacao roda a
partir dele. `blocked` e ortogonal — uma capacidade pode ficar `blocked` vinda de
`in-progress` (dependencia ausente) ou de `structurally-complete` (evidencia de
aceitacao expoe um problema integrado). Nao criar estados intermediarios alem
destes sem necessidade real.

## Politica de validacao (mecanica da aceitacao)

A capacidade separa **dois momentos** de validacao. A *lente* de cada um — que
evidencia buscar, proporcional ao risco, e por que nao confundir validacao
intermediaria com aceitacao integrada (incluindo o antipadrao de aceitacao
prematura repetitiva e a regra de que testes uteis persistem como regressao) — e'
propriedade da disciplina `workflow.doctrine.testing` (secao "Validacao durante
construcao x aceitacao integrada"); este contrato **nao a reescreve**, apenas fixa
a **mecanica** de completude:

- **Validation During Construction** (por slice): validacao tecnica **minima e
  proporcional** que prova que o slice nao esta estruturalmente quebrado. Ela
  **nao** conclui a capacidade e **nao** dispara aceitacao. Detalhe da lente em
  `workflow.doctrine.testing`.
- **Capability Acceptance** (por capacidade): prova de que a **capacidade
  integrada** esta pronta para uso. E um **evento por capacidade**, nao por slice,
  e **so ocorre quando a capacidade esta `structurally-complete`** — o gate e o
  Capability Contract satisfeito + a Definition of Done abaixo. A lista de evidencia
  que a aceitacao pode exigir (integracao, E2E, contratos, permissoes, erros,
  fallbacks, cenarios alternativos, UX/responsividade/acessibilidade, seguranca,
  observabilidade, dados, regressao) e dimensionada pela disciplina de testes.

**Regra de ouro (a razao de ser deste contrato):** implementacao pode ser
incremental; **aceitacao nao deve ser fragmentada** enquanto a capacidade tiver
dependencias estruturais abertas. Enquanto A depende de B e C ainda inexistentes,
A permanece `in-progress` (validacao tecnica minima), e a aceitacao roda **uma
vez**, integrada, quando A+B+C formam a capacidade — nunca homologando A isolado,
depois A+B, depois A+B+C.

## Definition of Done da Capability

Uma capacidade so pode ser marcada como **`accepted`** quando:

- o **Capability Contract** estiver satisfeito;
- as **dependencias obrigatorias** estiverem implementadas;
- os **gaps bloqueantes** estiverem resolvidos;
- os **drifts relevantes** estiverem tratados;
- os **contratos** estiverem fechados;
- os **dados** estiverem coerentes;
- as **permissoes** estiverem validadas;
- as **interfaces necessarias** existirem;
- os **testes de Capability Acceptance** tiverem evidencia suficiente;
- a **documentacao / Blueprint** estiverem atualizados (`COMO-INTERAGIR §4`).

Enquanto qualquer item obrigatorio (conforme o contrato) permanecer aberto, a
capacidade nao e `accepted` — no maximo `structurally-complete` ou `blocked`.

## Rastreabilidade

Matriz conceitual, para impedir que uma regra exista sem implementacao/interface/
teste, ou que uma tela exista sem comportamento de backend/dados associado:

```text
Capability -> Rule -> Entity/Data -> Contract/API/Event -> UI -> Test
```

- **Nao** exigir um unico arquivo gigante. A matriz pode ser **distribuida e
  referenciada** (o contrato aponta; o Blueprint detalha; a suite prova).
- **Objetivo:** cada linha de negocio tem implementacao, interface e teste
  correspondentes; cada tela tem comportamento de backend/dados por tras. Buracos
  na matriz sao Gap explicito, nunca silencio.

## Granularidade

Evitar que **toda task vire Capability**. Uma Capability representa comportamento
**relevante e integrado** percebido por usuario/sistema. Uma pequena correcao
local **dentro** de uma capacidade existente **referencia** essa capacidade; nao
cria uma nova. Sinais de que algo e Capability (nao task): atravessa camadas/
modulos; tem espaco funcional esperado proprio; o usuario a percebe como uma
funcao inteira. Sinais de task local: contida, sem espaco funcional proprio,
dentro de uma capacidade ja existente.

## Fluxo (posicao no Workflow)

```text
BASELINE OK (workflow.architecture-baseline)
  -> CAPABILITY MAP
  -> CAPABILITY CONTRACT
  -> IMPLEMENTACAO EM SLICES
  -> VALIDACAO TECNICA MINIMA POR SLICE      (Validation During Construction)
  -> STRUCTURALLY COMPLETE                   (contrato satisfeito)
  -> CAPABILITY ACCEPTANCE                    (prova integrada)
  -> ACCEPTED
```

O reconhecimento de uma Capability e a decisao de abrir/identificar um contrato
sao pre-gate no alinhador (`workflow.prompt-alignment`); a construcao dos slices e
  a aceitacao ocorrem somente depois do clique em **Fazer**, na especialidade executora.

## Gates

Preferir gate humano em: decisao de produto; **inclusao/exclusao importante de
Capability** (o que entra/nao entra no contrato); conflito de regra; risco alto;
bloqueio real; e na **transicao para `accepted`** (a aceitacao e uma decisao, nao
um automatismo). Evitar checkpoint vazio: depois do clique em **Fazer**, se nao
houver decisao humana nova, seguir dentro do escopo aprovado
(`COMO-INTERAGIR §5/§6`).

## Relacao com Blueprint, especialidades e especialistas externos

- **Blueprint** registra **onde** cada parte da capacidade existe no sistema
  (modulos, contratos, dados, fluxos). O Capability Contract registra **o que o
  projeto decidiu suportar** naquela capacidade. Nao misturar: um e localizacao
  estrutural, o outro e escopo de completude.
- **Especialidade** ajuda a saber **o que uma Capability normalmente precisa
  considerar** (ex.: a especialidade de WhatsApp conhece as categorias relevantes
  da capacidade). O contrato registra a decisao daquele projeto; o Blueprint
  registra onde isso vive. Tres responsabilidades distintas, nao fundidas.
- **Especialistas externos** (ex.: UX/DS via Studio DS) podem ser donos de
  criterios de aceitacao de parte da capacidade (ex.: criterios de interface). O
  Workflow **referencia** o especialista, nunca copia suas regras; a dependencia
  de especialista externo e ownership externo.

## Lifecycle e adocao

- **SemVer do contrato** (`framework.md §7`); ciclo `draft -> reviewed -> released
  -> deprecated`. Este ativo nasce `draft`.
- As capacidades de um projeto sao artefatos no namespace do projeto (ex.:
  `<projeto>.capability.<slug>`) que **declaram conformidade** a este contrato por
  `policy_refs: [workflow.capability-contract@<versao>]` — conformidade por
  referencia com versao fixada, nao por `extends`. O mapa e os contratos vivem com
  o projeto (referenciados pelo Baseline), nunca aqui.
- MAJOR do contrato exige revisao das capacidades existentes; MINOR acrescenta
  campos/estados opcionais compativeis.

## Criterios de aceite do contrato

| Caso | Resultado esperado |
|---|---|
| Pedido "implementar atendimento WhatsApp" | Nao interpretar como apenas `sendText`; criar Capability Contract; considerar categorias esperadas (cobertura implicita); declarar o que entra e o que fica fora; implementar em slices; so marcar concluido apos Capability Acceptance |
| Slice A depende de B e C ainda inexistentes | Validacao tecnica minima de A; A segue `in-progress`; nao executar homologacao/E2E global prematuramente; aceitacao integrada apos A+B+C |
| Varios slices entregues, contrato ainda aberto | Capability nao vira `accepted`; no maximo `structurally-complete`/`in-progress` |
| Pequena correcao local dentro de capacidade existente | Referencia a Capability existente; nao cria uma nova; nao abre contrato desnecessario |
| Tentativa de marcar `accepted` com item obrigatorio do contrato aberto | Recusada; falta Definition of Done |
| Comportamento esperado ausente e nao declarado fora de escopo | Registrado como Gap; capacidade nao concluida |
| Contrato com dezenas de campos vazios "por formalidade" | Recusado; declarar so o real; ausencia relevante e explicita |
| Testes de slice descartados apos o slice | Recusado; testes uteis persistem como regressao |

## Registro de revisao

| Versao | Estado | Revisao | Impacto |
|---|---|---|---|
| 1.0.0 | reviewed | Revisado pelo responsável pelo projeto em 2026-09-13 (revisao §8/§10; lente de validacao delegada a workflow.doctrine.testing, sem duplicacao) | Nova frente (completude estrutural). Contrato agnostico de Capability (`kind: shared`): definicao de capacidade de produto, Capability Map, Capability Contract (campos conceituais extensiveis), cobertura implicita (considerar o espaco esperado a partir de fontes reais; declarar o que entra/fica fora; nao inventar), implementacao em slices ligados ao mesmo contrato, estados enxutos (`planned`/`in-progress`/`structurally-complete`/`accepted`/`blocked`), politica de validacao (Validation During Construction x Capability Acceptance + evitar validacao prematura repetitiva + testes como regressao), Definition of Done e rastreabilidade `Capability -> Rule -> Entity/Data -> Contract/API/Event -> UI -> Test`. Codifica a regra de ouro. Nao implementa capacidade, nao contem fato de projeto, nao integra especialista externo, nao altera projetos consumidores. Permanece `draft`; promocao e ligacao ao fluxo sao etapas com plano proprio e gate **Fazer**. |


