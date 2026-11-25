---
schema: prompt-framework/v1
id: workflow.architecture-blueprint
kind: shared
version: 1.1.0
status: draft
title: Contrato agnostico do Architecture Blueprint
policy_refs:
  - workflow.framework-spec
owners:
  - project-owner
reviewers:
  - project-owner
change_reason: Etapa 5.3. MINOR 1.0.0 -> 1.1.0 com refinamentos aditivos e compativeis comprovados pelo primeiro piloto real (Connect Nivoo / modulo Identidade): vocabulario recomendado de estado (N1), separacao Gap x bloqueio (N2), tipagem opcional de Drift (N3), evidencia opcional direcionada (U1) e principio de promocao para arquivo proprio (U3), centralizados numa secao de Convencoes transversais. Nenhum campo novo e obrigatorio; Blueprints conformes a 1.0.0 continuam validos; adocao e deliberada por policy_refs. Permanece draft; nao altera projeto consumidor, disciplina nem alinhador.
---

# Contrato do Architecture Blueprint

## Missao

Definir o contrato agnostico que qualquer **Architecture Blueprint** de projeto
deve obedecer. A doutrina (`workflow.engineering-doctrine` e suas disciplinas)
define **o que precisa ser conhecido** antes de alterar software com seguranca. O
Blueprint de cada projeto define **onde estao as respostas reais daquele sistema**.
Este ativo e o **contrato** dos Blueprints — nao um Blueprint, nao contem fato de
nenhum projeto.

## O que o Blueprint e / nao e

**E:** especifico de um projeto; versionado com esse projeto; legivel por humano e
por IA; estrutural; consultavel; incremental; capaz de **apontar** fontes reais
sem copiar todo o conteudo; a fonte de verdade arquitetural do projeto quando
formalmente adotado.

**Nao e:** dump do codigo; inventario de todos os arquivos; documentacao de API
completa; wiki narrativa gigante; copia do Design System; copia de regra externa;
grafo automatico sem curadoria; substituto da documentacao de negocio; um prompt.

Ele representa a **estrutura intencional e os fatos arquiteturais relevantes** —
nao a descricao linha a linha do codigo.

## Modelo conceitual (entidades)

Hierarquia de referencia (heranca por **referencia**, nunca duplicacao):

```text
SISTEMA
  -> MODULO (-> SUBMODULO)
       -> FLUXO / CONTRATO / INVARIANTE / PONTO COMPARTILHADO
```

Entidades do contrato: **Sistema**, **Modulo**, **Invariante**, **Fluxo**,
**Dependencia/Consumidor** (aresta), **Contrato** (referencia a contrato real),
**Ponto compartilhado**, **Dados**, **Integracao externa**, **Referencia externa**
(Studio DS/API/ADR/doc), **Decisao arquitetural**, **Lacuna/Drift**. Secoes
transversais do Sistema: **Seguranca**, **Observabilidade**, **Infraestrutura**.

Regra geral de campos: poucos **obrigatorios**; a maioria **opcional** com
**ausencia explicita** permitida (ver o vocabulario de estado em *Convencoes
transversais*: `ausente`/`desconhecido`/`nao-se-aplica`) — ausencia de informacao
nunca vira informacao inventada.

## Convencoes transversais

Valem para todas as entidades abaixo; nao sao repetidas em cada secao.

### Vocabulario de estado (recomendado, opcional)

Onde util, uma entidade (ou um item dentro dela) declara `estado`:

| estado | significado |
|---|---|
| `existente` | o fato/comportamento/estrutura esta comprovadamente presente |
| `parcial` | parte existe, mas o comportamento ou a estrutura ainda nao esta completo (ex.: modelo existe, sem escritor/servico) |
| `planejado` | ha intencao/decisao/documentacao de futuro, mas ainda nao implementado |
| `ausente` | verificado e nao existe |
| `desconhecido` | sem evidencia suficiente para afirmar presenca ou ausencia |
| `nao-se-aplica` | a dimensao nao e relevante naquele contexto |

Regras:
- **`documentado-nao-implementado` nao e um estado proprio** — representa-se como
  `estado: planejado` + `evidencia`/`fonte: documental`.
- **`conflito` nao e estado** — divergencia entre fontes vira **Drift**.
- `estado` e **recomendado, nao obrigatorio**; nenhuma entidade precisa te-lo em
  todo campo.

### Evidencia (opcional, direcionada)

Onde ajuda a responder "como sabemos que isto e verdade?", uma entidade declara
`evidencia`: o artefato concreto que sustenta o `estado`/`fonte`. Exemplos: schema,
constraint, migracao, teste, codigo, documento, configuracao, comportamento
observado. **Referenciar** a fonte/caminho — nao copiar a evidencia inteira.
Aplica-se principalmente a **invariantes, contratos, seguranca, gaps** e a
**fluxos quando necessario**; nao e obrigatoria em nenhuma entidade.

### Promocao para arquivo proprio

Uma entidade (fluxo, invariante, contrato, decisao ou outra) ganha **arquivo
proprio** quando:
1. e **referenciada por mais de um modulo** (criterio principal — reuso); ou
2. seu **volume prejudica a leitura seletiva** do arquivo do modulo (criterio
   secundario).

Julgamento qualitativo; **sem limite fixo de linhas**. Mantem `modules/*.md`
legiveis e a leitura seletiva barata.

## Contrato: SISTEMA (raiz)

Identidade (contexto estrutural, sem duplicar README): `nome`, `proposito`,
`escopo`, `principais superficies`, `limites do sistema`, `fontes de verdade
relevantes`. Mais as secoes transversais abaixo (seguranca, observabilidade,
infraestrutura, pontos compartilhados, decisoes, lacunas), que valem para o
sistema quando nao pertencem a um modulo especifico.

## Contrato: MODULO

| Campo | Obrig. | Nota |
|---|---|---|
| `id` | sim | estavel; ex. `<projeto>.module.<slug>` |
| `nome` | sim | humano |
| `responsabilidade` | sim | o que pertence aqui |
| `nao_pertence` | opc. | o que NAO pertence (evita responsabilidade no lugar errado) |
| `limites` | opc. | fronteiras do modulo |
| `submodulos` | opc. | refs a modulos filhos |
| `owner` | opc. | dono conceitual |
| `pontos_de_entrada` | opc. | onde o modulo e acionado |
| `superficies` | opc. | o que expoe |
| `depende_de` | opc. | refs (ver Dependencia) |
| `consumido_por` | opc. | refs (ver Consumidor) |
| `contratos` | opc. | refs a Contrato |
| `invariantes` | opc. | refs a Invariante |
| `fluxos` | opc. | refs a Fluxo |
| `pontos_compartilhados` | opc. | refs a Ponto compartilhado |
| `seguranca` / `dados` / `dominio` / `testes` / `interface` | opc. | ponteiros de contexto por lente (ver mapeamento) |

Nem todo modulo precisa de todos os campos; declarar so o que e real. Ausencia
relevante e explicita, nao silenciosa.

## Contrato: INVARIANTE

Regra que precisa permanecer verdadeira apos qualquer alteracao. Campos: `id`
(obrig.), `descricao` (obrig.), `escopo` (obrig.), `fonte` (obrig. — de onde a
regra vem), `criticidade` (opc., so se util), `relacionados` (opc. — modulos/
fluxos). Lifecycle: um invariante nasce quando descoberto/decidido, e revisado
quando a area muda, e marcado obsoleto (nao apagado silenciosamente) quando deixa
de valer — com registro. Sem exemplos reais de projeto aqui.

## Contrato: FLUXO

Sequencia arquitetural relevante (nao todo fluxo). Representacao textual/
estruturada basta — sem diagrama grafico. Campos: `id` (obrig.), `origem`
(obrig.), `passos` (obrig.) — cada passo com `responsabilidade`, `entradas`,
`saidas`, `efeitos_colaterais`, `contratos`, `pontos_de_falha`; e `consumidores`
(opc.). Ex. conceitual de forma (nao de projeto): entrada -> validacao -> regra de
negocio -> persistencia -> evento -> consumidor.

## Contrato: DEPENDENCIA / CONSUMIDOR (aresta)

Distinguir sempre **`depende_de`** de **`consumido_por`** (a mesma relacao vista
dos dois lados). Campos: `de`, `para` (obrig.), `direcao` (obrig.),
`motivo` (opc.), `natureza` (opc. — ex. sincrona/assincrona, dado/comportamento),
`criticidade` (opc.), `interna_ou_externa` (obrig.). Consumidor pode ser modulo
interno, frontend, mobile, job, integracao, servico, outro sistema ou contrato
externo; direto ou compartilhado. Sem inventario completo de callsites nesta fase.

## Contrato: CONTRATO (referencia a contrato real)

Contrato = API, evento, mensagem, DTO, tipo, schema, formato, interface,
comportamento publico ou contrato interno compartilhado. **Principio: referenciar
quando ja existe fonte autoritativa; nao duplicar.** Campos: `id` (obrig.),
`tipo` (obrig.), `resumo_estrutural` (opc.), `fonte` (obrig. quando existe fonte
autoritativa — caminho/URL), `versao` (opc.), `compatibilidade` (opc.),
`consumidores` (opc.). Copiar contrato inteiro so quando nao houver fonte
autoritativa.

## Contrato: PONTO COMPARTILHADO (secao critica)

Responde: **"isto parece local, mas e compartilhado?"**. Campos: `id` (obrig.),
`tipo` (obrig. — componente, hook, servico, biblioteca interna, contrato, modelo,
utilitario critico, middleware, politica comum), `descricao` (obrig.),
`escopo_de_impacto` (obrig.), `consumidores` (opc.). Existe para impedir que uma
alteracao "local" mude comportamento global.

## Contrato: DADOS

Apontar (nao documentar o banco inteiro, nao copiar schema): `modelos_relevantes`,
`ownership_do_dado`, `fonte_de_verdade`, `persistencia`, `relacoes`,
`migracoes_relevantes`, `consumidores_do_dado`, `invariantes_de_dados`. Schema
completo fica na sua fonte; o Blueprint referencia.

## Contrato: SEGURANCA (contexto para a lente)

Fornece o que `workflow.doctrine.security` espera: `superficies_expostas`,
`fronteiras_de_confianca`, `identidade`, `autenticacao`, `autorizacao`,
`permissoes`, `dados_sensiveis` (quando classificados pelo projeto),
`segredos_configuracao` (**apenas por referencia, nunca valor**), `auditoria`,
`integracoes_externas`. **Nunca armazenar segredo real.**

## Contrato: DOMINIO / REGRA DE NEGOCIO

O Blueprint nao vira manual de regras. Aponta: `fonte_que_governa_a_regra`,
`fluxo_de_negocio`, `estados`, `transicoes`, `pre_condicoes`, `pos_condicoes`,
`excecoes`, `decisoes_relevantes`, `divergencias_conhecidas`. Regra ja documentada
em outro lugar: referenciar, nao copiar.

## Contrato: TESTES / VALIDACAO

Informa a lente de Testes o que ja existe e onde procurar evidencia: `testes_
existentes`, `tipo_de_cobertura`, `fluxos_protegidos`, `contratos_testados`,
`areas_sem_cobertura_conhecida`, `ambiente_necessario`, `criterios_estruturais_de_
aceite` (quando existirem). Nao armazenar resultado de toda execucao.

## Contrato: INTEGRACAO EXTERNA

Por integracao relevante: `finalidade`, `direcao`, `sistema_externo`,
`contrato_fonte`, `autenticacao` (por referencia), `entrada`, `saida`,
`webhook_callback` (quando houver), `modo_de_falha`, `dependencia`,
`consumidores_internos`, `observabilidade_relevante`. Nao copiar documentacao
externa inteira.

## Contrato: OBSERVABILIDADE

Apontar (nao exigir para toda linha): `logs_relevantes`, `metricas`, `tracing`,
`auditoria`, `alertas`, `correlacao`, `fonte_de_observabilidade`.

## Contrato: INFRAESTRUTURA E AMBIENTE

Apontar: `ambientes`, `servicos`, `runtime`, `persistencia`, `filas`, `caches`,
`storage`, `dependencias_externas`, `restricoes_relevantes`. Deploy/ambiente ja
normatizados pelas regras do projeto sao **referenciados**, nao reduplicados. A
IA descreve contratos, riscos, comandos de verificacao e criterios; operacoes de
entrega sao executadas pelo Nivoo.

## Contrato: DECISAO ARQUITETURAL

Referencia > duplicacao. Campos: `decisao_resumida` OU `aponta_adr` (documento
existente), `status`, `impacto`. Nao reinventar ADR se ja houver mecanismo
equivalente no projeto.

## Contrato: REFERENCIA EXTERNA (Studio DS, API, ADR, doc)

Como apontar uma fonte sem copiar. Campos: `nome`, `tipo` (design-system, api,
adr, doc-negocio, biblioteca, ...), `localizacao` (path/URL), `versao_ou_politica_
adotada`, `o_que_governa`. Quando uma superficie for governada pelo Studio DS, o
Blueprint registra apenas: "esta superficie e governada pelo Studio DS / politica
X" — nunca o conteudo do DS.

## Contrato: LACUNA / DRIFT

**Gap** e **Drift** sao formas relacionadas, mas **nao equivalentes**: um *Gap* e
falta de informacao, estrutura, decisao ou implementacao; um *Drift* e divergencia
entre fontes/estados que existem. Ausencia de informacao e sempre registrada,
nunca preenchida por suposicao.

### Gap (lacuna)

**Uma lacuna nao e, por definicao, um bloqueio global.** A condicao de bloqueio
depende da demanda/contexto. Campos:

| campo | obrig. | nota |
|---|---|---|
| `id` | sim | estavel quando referenciado |
| `descricao` | sim | o que falta |
| `status` | opc. | `aberto` \| `em-decisao` \| `resolvido` |
| `impact` | opc. | qualitativo curto (sem score) |
| `relevant_to` | opc. | disciplina/modulo/fluxo afetado |
| `blocks_when` | opc. | a **condicao** sob a qual a lacuna realmente bloqueia uma acao |
| `source` | opc. | fonte |

`blocks_when` evita a regra simplista "lacuna = bloqueio". Ex.: "estrategia de
cifragem indefinida" nao bloqueia toda mudanca do modulo, mas bloqueia
"persistencia real de contato privado".

### Drift

Divergencia entre fontes/estados que existem. Registra: `descricao`,
`fontes_em_conflito`, `tipo` (opcional), `impacto`, `estado`, `decisao_necessaria`
(quando aplicavel). `tipo` e uma **lista exemplificativa e extensivel**, nao um
enum rigido: `documentation`, `domain-rule`, `implementation`, `model`,
`contract`, `security`, `unknown`. A IA nunca resolve um drift silenciosamente
escolhendo uma versao (ver Regras de autoridade e conflito).

## Identificadores

IDs estaveis **obrigatorios** para as entidades referenciadas por outras partes e
pela futura analise de impacto: **modulo, invariante, fluxo, contrato, ponto
compartilhado**. Opcionais para detalhes-folha sem referencia. Namespace do
projeto (ex.: `<projeto>.module.<slug>`, `<projeto>.invariant.<slug>`). Beneficio:
referencia por agentes, rastreabilidade, atualizacao pontual, analise de impacto
futura.

## Estrutura e granularidade no projeto

Recomendacao: **combinacao** — um indice humano em Markdown + secoes estruturadas
(tabelas/front matter) + arquivos por modulo quando o projeto crescer. Escolha por
escalabilidade e custo de contexto, nao por estetica.

- **Projeto pequeno:** um unico `blueprint.md` basta.
- **Projeto medio/grande:** dividir por modulo (leitura seletiva).

Arvore **recomendada, nao obrigatoria**:

```text
architecture/
  blueprint.md        # indice + identidade do sistema + secoes transversais
  modules/<modulo>.md # um por modulo (id, responsabilidade, refs)
  flows/<fluxo>.md    # fluxos relevantes (opcional)
  decisions/<adr>.md  # decisoes ou ponteiros a ADRs (opcional)
```

Cada projeto pode armazenar onde sua governanca exigir, desde que preserve o
contrato, os IDs e o namespace — mesma liberdade que o `framework.md §11` da ao
catalogo de especialidades. A decisao de dividir uma entidade em arquivo proprio
segue o **principio de promocao** (Convencoes transversais).

## Estrategia de leitura seletiva (custo de contexto)

Espelha o modelo da propria doutrina (indice fino + carga sob demanda): uma IA le
o **indice do Sistema** + o(s) **modulo(s) tocado(s)** + as entidades
**referenciadas por ID** (invariantes, contratos, pontos compartilhados
relacionados) — **nunca o Blueprint inteiro nem o projeto inteiro**. Os IDs
estaveis e a divisao por arquivo tornam a leitura direcionada. Um Blueprint bem
formado permite responder as perguntas de impacto abrindo poucas secoes.

## Regras de autoridade e conflito

- O Blueprint **nao inventa**; quando nao sabe, registra lacuna.
- Se existe contrato/regra autoritativa em outra fonte, o Blueprint **aponta**, nao
  substitui.
- O **codigo nao e automaticamente a fonte maxima de verdade** — a disciplina de
  Dominio ja estabeleceu que a implementacao pode estar errada.
- Diante de divergencia entre Blueprint, codigo, documentacao e pedido, **registrar
  a divergencia**; nunca reconciliar silenciosamente escolhendo uma das versoes.

## Regras de atualizacao

Atualizar na mesma leva (principio de doc viva, `COMO-INTERAGIR §4`) quando houver:
criacao/remocao de modulo; alteracao de responsabilidade; mudanca de contrato; nova
dependencia; novo consumidor; alteracao de fluxo; novo invariante; mudanca de
integracao; mudanca de permissao; mudanca estrutural compartilhada. Sem mecanismo
automatico nesta etapa.

## Architecture Drift

**Drift** = divergencia entre Blueprint, codigo, documentacao e comportamento real.
Tratamento (conceitual, sem detector automatico): **registrar** como entrada de
Lacuna/Drift (o que diverge, entre quais fontes, desde quando se souber);
**sinalizar** no ponto afetado; e **impedir** que a IA resolva silenciosamente
escolhendo uma versao — o drift vira decisao a apresentar, alinhado a regra de
conflito da disciplina de Dominio.

## Mapeamento Doctrine -> Blueprint

| Disciplina (required context) | Secao do Blueprint que resolve |
|---|---|
| architecture (modulo, dependencias, consumidores, contratos, invariantes) | Modulo, Dependencia/Consumidor, Contrato, Invariante, Ponto compartilhado |
| security (superficie, dado sensivel, credencial, permissao) | Secao Seguranca, Integracao externa, Referencia externa (segredos por ref.) |
| testing (risco, cobertura, criterio, evidencia) | Secao Testes/validacao, Invariante, Contrato |
| domain (regra, fonte, fluxo, estados) | Secao Dominio, Fluxo, Referencia externa (doc de negocio) |
| conditionals: frontend/ux-ds/responsive/accessibility | Modulo (interface) + Referencia externa (Studio DS) |
| conditionals: backend/data/authz | Modulo, Secao Dados, Secao Seguranca |
| conditionals: integrations/async-events | Integracao externa, Fluxo, Contrato |
| conditionals: observability/infrastructure/deploy | Secoes Observabilidade e Infraestrutura (deploy por referencia) |

O Blueprint e projetado para **alimentar** essas lentes; ele nao as executa.

## Relacao com execucao e com o Studio DS

O Blueprint **fornece contexto, nao executa alteracao**. Fluxo futuro (nao
implementado aqui): demanda -> indice de disciplinas -> gate -> disciplinas
profundas necessarias -> Blueprint do projeto -> especialista externo quando
necessario -> analise de impacto -> especialidade executora -> validacao.
**Studio DS:** vinculo apenas conceitual — quando uma superficie e governada pelo
DS, o Blueprint aponta o artefato/regra adotada; nao copia, nao integra nesta fase.

## Lifecycle e adocao

- **SemVer do contrato** (`framework.md §7`); ciclo `draft -> reviewed -> released
  -> deprecated`. Este ativo nasce `draft`.
- Um Blueprint de projeto e um ativo `shared` no namespace do projeto (ex.:
  `<projeto>.architecture-blueprint`) que **declara conformidade** a este contrato
  por `policy_refs: [workflow.architecture-blueprint@<versao>]` — **conformidade
  por referencia com versao fixada**, nao por `extends` (shared nao estende). A
  versao fixada da a **adocao deliberada** e a base de **migracao**.
- MAJOR do contrato exige migracao explicita dos Blueprints existentes; MINOR
  acrescenta campos opcionais compativeis.

## Criterios de aceite do contrato

Um Blueprint conforme a este contrato deve permitir que, diante de uma alteracao, a
IA responda **sem abrir o projeto inteiro**: (1) em que modulo mexo; (2) qual a
responsabilidade dele; (3) quais fronteiras existem; (4) do que depende; (5) quem
depende dele; (6) quais contratos sao tocados; (7) quais invariantes governam a
area; (8) quais fluxos passam ali; (9) e compartilhado; (10) quais regras de
negocio governam; (11) quais riscos de seguranca existem; (12) quais testes/
protecoes ja existem; (13) qual especialista externo consultar; (14) que contexto
ainda falta. Alem disso: nenhum fato inventado; toda ausencia e lacuna explicita;
toda fonte autoritativa e referenciada, nao copiada.

## Registro de revisao

| Versao | Estado | Revisao | Impacto |
|---|---|---|---|
| 1.0.0 | draft | Proposto pelo responsável pelo projeto em 2026-09-03 | Etapa 4. Contrato agnostico do Architecture Blueprint (`kind: shared`): modelo de entidades (sistema, modulo, invariante, fluxo, dependencia/consumidor, contrato, ponto compartilhado, dados, seguranca, dominio, testes, integracao, observabilidade, infraestrutura, decisao, referencia externa, lacuna/drift), contratos de campo com obrigatorio/opcional e ausencia explicita, identificadores estaveis, granularidade por porte de projeto, leitura seletiva, autoridade/conflito, atualizacao, Architecture Drift, mapeamento Doctrine->Blueprint, lifecycle e conformidade por referencia versionada. Nao implanta Blueprint, nao cria scanner/grafo, nao integra Studio DS, nao altera o alinhador. Permanece `draft`. |
| 1.1.0 | draft | Proposto pelo responsável pelo projeto em 2026-09-03 | Etapa 5.3. MINOR aditivo derivado do primeiro piloto real (Connect Nivoo / Identidade). Acrescenta a secao *Convencoes transversais* com: vocabulario recomendado de estado (`existente`/`parcial`/`planejado`/`ausente`/`desconhecido`/`nao-se-aplica`; `documentado-nao-implementado` = `planejado`+evidencia; `conflito` e Drift, nao estado), `evidencia` opcional direcionada e principio de promocao para arquivo proprio. Separa **Gap** (com `status`/`impact`/`relevant_to`/`blocks_when`/`source`; lacuna nao e bloqueio global) de **Drift** (com `tipo` opcional extensivel). Todos os campos novos sao opcionais; Blueprints conformes a 1.0.0 permanecem validos. |

