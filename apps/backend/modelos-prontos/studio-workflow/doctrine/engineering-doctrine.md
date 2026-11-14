---
schema: prompt-framework/v1
id: workflow.engineering-doctrine
kind: shared
version: 1.6.0
status: draft
title: Indice agnostico de disciplinas de engenharia (Project Engineering Doctrine)
policy_refs:
  - workflow.framework-spec
owners:
  - project-owner
reviewers:
  - project-owner
change_reason: "MINOR 1.5.0 -> 1.6.0. Atualiza o contexto de `visual-interface-quality`: Iconoir, Phosphor, Tabler e Font Awesome Free tornam-se fontes primarias sem credito visual; Simple Icons cobre marcas verificadas; Icons8/Flaticon viram excecoes licenciadas."
---

# Indice agnostico de disciplinas de engenharia

## Missao

Representar, de forma agnostica e versionada, o conjunto de disciplinas de
engenharia que um software profissional envolve — para que futuras etapas do
Studio Workflow possam identificar quais lentes uma demanda ativa, sem que o dono
do sistema precise enumera-las manualmente.

Este ativo e a **semente evolutiva** da Project Engineering Doctrine: um indice,
nao um corpo de conhecimento. Cada disciplina aqui e uma entrada leve; o
conhecimento profundo de cada uma vive fora deste arquivo (na doutrina geral, no
Architecture Blueprint do projeto ou em um especialista externo), conforme o
campo `ownership`.

## Responsabilidades

- Listar as disciplinas de engenharia reconheciveis, cada uma com identidade,
  tier, ownership, gatilhos e os tipos de contexto que futuramente deverao ser
  buscados quando a disciplina for ativada.
- Distinguir disciplinas de tier `core` (consideradas em toda demanda) de tier
  `conditional` (ativadas por gatilho).
- Distinguir onde o conhecimento profundo de cada disciplina se resolve:
  `doctrine`, `blueprint` ou `external`.
- Permitir que novas disciplinas sejam acrescentadas apenas adicionando uma
  entrada, sem reestruturar o nucleo.
- Referenciar conhecimento externo por nome conceitual quando aplicavel; nunca
  copia-lo.

## Limites e restricoes

- **Nao** conter o conhecimento profundo de nenhuma disciplina — apenas a entrada
  de indice. Os arquivos profundos por disciplina sao etapas futuras.
- **Nao** classificar demandas nem analisar codigo. Este ativo e dados; o passo
  que le este indice e cruza com uma demanda pertence a uma etapa futura
  (evolucao do `workflow.prompt-alignment`), nao aqui.
- **Nao** conter regra especifica de nenhum projeto — isso e dominio, e dominio
  vive no repositorio do projeto (catalogo local / Architecture Blueprint).
- **Nao** duplicar conhecimento de um especialista externo — apenas referencia-lo
  como ownership `external`.
- **Nao** integrar, ainda, nenhum especialista externo (inclusive o Studio DS): a
  coluna `ref. externa` representa o especialista apenas como exemplo conceitual
  de ownership futuro, sem path, contrato ou `policy_ref` real.
- **Nao** definir mecanismo de busca de contexto, analise de impacto ou leitura
  de Blueprint. `required context` aqui declara apenas *tipos* de contexto
  esperados.

## Contrato de uma entrada de disciplina

Cada disciplina do indice e descrita pelos campos abaixo. Adicionar uma
disciplina = adicionar uma linha nas tabelas de taxonomia (e uma linha em
*Required context*); nada no restante do arquivo muda.

| Campo | Significado |
|---|---|
| `id` | Identificador estavel da disciplina, namespace `workflow.doctrine.*` (ASCII, minusculas, ponto/hifen). E o `id` que o arquivo profundo futuro daquela disciplina usara. |
| `nome` | Nome humano curto da disciplina. |
| `descricao` | Uma frase: o que a disciplina cobre. |
| `gatilhos` | Sinais na demanda que sugerem que a disciplina e relevante. Usados por uma etapa futura para ativacao; aqui sao apenas declarados. |
| `tier` | `core` (considerada em toda demanda profissional) ou `conditional` (ativada quando ha gatilho). |
| `ownership` | Onde o conhecimento **profundo** da disciplina se resolve: `doctrine` (doutrina geral agnostica), `blueprint` (especifico do sistema, futuro Architecture Blueprint do projeto) ou `external` (especialista externo reutilizavel entre projetos). A entrada de indice mora sempre aqui, independente do ownership. |
| `required context` | Tipos de contexto que futuramente deverao ser buscados quando a disciplina for ativada. Sao *tipos esperados*, nao um mecanismo de busca. |
| `ref. externa` | Quando `ownership: external`, o nome conceitual do especialista. Nesta etapa e sempre exemplo futuro, nao integrado. |

Valores de `tier`: `core`, `conditional`. Valores de `ownership`: `doctrine`,
`blueprint`, `external`.

## Taxonomia — tier `core`

Disciplinas consideradas em toda demanda profissional. O ownership `doctrine`
indica que a lente/perguntas sao agnosticas; o *contexto* que ela pede pode,
quando aplicavel, ser resolvido no Blueprint do projeto em etapa futura.

| id | nome | descricao | gatilhos | ownership | ref. externa |
|---|---|---|---|---|---|
| `workflow.doctrine.architecture` | Arquitetura / impacto estrutural | Fronteiras, contratos, dependencias e invariantes que a mudanca toca. | mexe em modulo, contrato, fronteira, dependencia compartilhada | doctrine | — |
| `workflow.doctrine.domain` | Dominio / regra de negocio | A regra do produto que governa a decisao. | altera calculo, fluxo, estado ou regra de negocio | doctrine | — |
| `workflow.doctrine.testing` | Testes / validacao | Como provar que a mudanca esta correta, proporcional ao risco. | qualquer alteracao de comportamento verificavel | doctrine | — |
| `workflow.doctrine.security` | Seguranca | Exposicao de dado, credencial, segredo ou superficie nova. | toca dado sensivel, autenticacao, entrada externa, superficie publica | doctrine | — |
| `workflow.doctrine.documentation` | Documentacao | Documentacao viva que deve acompanhar a mudanca. | qualquer mudanca relevante em comportamento ou contrato | doctrine | — |

## Taxonomia — tier `conditional`

Disciplinas ativadas quando um gatilho aparece na demanda. O ownership indica
para onde o conhecimento profundo tende a se resolver em etapas futuras.

| id | nome | descricao | gatilhos | ownership | ref. externa |
|---|---|---|---|---|---|
| `workflow.doctrine.frontend` | Frontend | Comportamento e estado de interface no cliente. | mexe em tela, estado de UI, componente, navegacao | blueprint | — |
| `workflow.doctrine.ux-design-system` | Adocao de Design System externo | Uso deliberado de artefato visual compartilhado por um sistema consumidor. | adotar, migrar ou consultar Design System/biblioteca visual externa; substituir componente local por artefato externo | external | especialista/artefato externo declarado pelo projeto (nao integrado por padrao) |
| `workflow.doctrine.visual-interface-quality` | Composicao e integridade de interface | Coerencia renderizada e interativa: densidade, foco, entrada, feedback, camadas, viewport, agrupamento, estados e remodelagem guiada por referencias. | tela, input, overlay, erro visual, foco, clipping, sobreposicao, scroll, densidade, responsividade, componente visual, remodelar, redesign, referencia visual | doctrine | — |
| `workflow.doctrine.backend` | Backend | Rota, servico e regra do lado servidor. | rota, servico, regra server-side, contrato de API | blueprint | — |
| `workflow.doctrine.data` | Dados / persistencia | Modelo de dados, persistencia, contratos e migracoes. | schema, migracao, contrato de dados, query | blueprint | — |
| `workflow.doctrine.authentication` | Autenticacao | Identidade, sessao e fluxo de login. | login, sessao, token, provedor de identidade | doctrine | — |
| `workflow.doctrine.authorization` | Autorizacao / permissoes | Papel, escopo, ACL e visibilidade. | ACL, papel, permissao, visibilidade | blueprint | — |
| `workflow.doctrine.integrations` | Integracoes | Contrato com terceiro, webhook, API externa. | API externa, webhook, contrato de terceiro | blueprint | — |
| `workflow.doctrine.async-events` | Eventos / processamento assincrono | Fila, job, evento e processamento em background. | fila, job, evento, processamento assincrono | blueprint | — |
| `workflow.doctrine.observability` | Observabilidade | Log, metrica, rastreamento e alerta. | log, metrica, tracing, alerta | doctrine | — |
| `workflow.doctrine.infrastructure` | Infraestrutura | Ambiente, recurso e configuracao de servidor. | ambiente, recurso, configuracao de servidor | blueprint | — |
| `workflow.doctrine.deploy` | Entrega | Criterios e riscos de release/publicacao executada pelo Nivoo. | release, publicacao, atualizacao de producao | doctrine | — |
| `workflow.doctrine.performance` | Performance | Custo, latencia e volume. | latencia, custo, volume, ponto quente | doctrine | — |
| `workflow.doctrine.accessibility` | Acessibilidade | Contraste, navegacao por teclado e semantica. | contraste, teclado, semantica, tecnologia assistiva | doctrine | — |
| `workflow.doctrine.responsive-mobile` | Responsividade / mobile | Comportamento por viewport e toque. | viewport, breakpoint, comportamento touch, mobile | external | studio-ds (exemplo conceitual; nao integrado nesta etapa) |

## Required context por disciplina

Tipos de contexto que futuramente deverao ser buscados quando a disciplina for
ativada. Nesta etapa sao apenas *tipos esperados* — nao ha mecanismo de busca,
leitura de Blueprint ou analise de impacto associado.

| id | required context (tipos esperados) |
|---|---|
| `workflow.doctrine.architecture` | modulo; dependencias; consumidores; contratos; invariantes |
| `workflow.doctrine.domain` | regra aplicavel; fonte de verdade do dominio; fluxo afetado; estados validos |
| `workflow.doctrine.testing` | risco da mudanca; cobertura existente; criterio de aceite; evidencia esperada |
| `workflow.doctrine.security` | superficie exposta; dado sensivel; credencial/segredo; permissao tocada |
| `workflow.doctrine.documentation` | doc viva afetada; contrato publico alterado; registro de mudanca exigido pelo projeto |
| `workflow.doctrine.frontend` | superficie/tela; estado de UI; componente; rota de navegacao |
| `workflow.doctrine.ux-design-system` | artefato externo escolhido; componentes/callsites candidatos; regras de adocao; referencia ao especialista externo |
| `workflow.doctrine.visual-interface-quality` | superficie/fluxo afetado; densidade e hierarquia de informacao; estados visiveis; Iconoir/Phosphor/Tabler/Font Awesome Free (fonte, familia, identificador e licenca) para icones novos/alterados; Simple Icons para marca com ficha validada; Icons8/Flaticon so como excecao licenciada, com autor Flaticon quando aplicavel; decisao de familia/selecao assistida quando aberta; imagem/midia local; referencias de preferencia quando houver; input/foco/overlay aplicavel; viewport; evidencia prevista |
| `workflow.doctrine.backend` | rota/servico; regra server-side; contrato de entrada/saida; efeitos colaterais |
| `workflow.doctrine.data` | modelo de dados; persistencia; contratos; consumidores; migracoes |
| `workflow.doctrine.authentication` | identidade; sessao/token; fluxo de login; provedor |
| `workflow.doctrine.authorization` | papel; escopo; ACL; visibilidade |
| `workflow.doctrine.integrations` | contrato de terceiro; autenticacao externa; limites/quotas; modo de falha |
| `workflow.doctrine.async-events` | evento/mensagem; produtor; consumidor; idempotencia/reentrega |
| `workflow.doctrine.observability` | log; metrica; rastreamento; alerta |
| `workflow.doctrine.infrastructure` | ambiente; recurso; configuracao; fluxo de entrega |
| `workflow.doctrine.deploy` | criterios de release/publicacao; rollback; fail-safe; operacao a cargo do Nivoo |
| `workflow.doctrine.performance` | custo; latencia; volume; ponto quente |
| `workflow.doctrine.accessibility` | contraste; navegacao por teclado; semantica; leitura por assistiva |
| `workflow.doctrine.responsive-mobile` | viewport; breakpoint; comportamento touch; referencia ao especialista externo |

## Notas de evolucao

A taxonomia e semente, nao lista fechada. Trajetorias previstas (nenhuma
implementada nesta etapa):

- **`authentication`, `integrations`:** candidatas a especialista externo se
  acumularem profundidade e reuso comprovado em 2+ projetos — mesmo criterio de
  promocao definido pelo framework. Ate la,
  permanecem disciplina fina.
- **`ux-design-system`:** so entra quando houver adocao deliberada de artefato
  externo. Nenhum projeto precisa de um Design System compartilhado para usar a
  doutrina; identidade visual e componentes locais continuam escolhas do projeto.
- **`responsive-mobile`, `accessibility`:** podem resolver conhecimento profundo
  em especialista externo ou nas regras do projeto quando houver tal fonte; o
  indice nao impõe uma biblioteca visual comum.
- **`visual-interface-quality`:** nao concorre com UX/DS. Ela define a lente de
  qualidade observavel da interface; o especialista externo continua dono de
  componentes, tokens e padroes concretos.
- **`deploy`, `infrastructure`:** a IA apenas declara criterios, riscos,
  verificacoes e rollback; o Nivoo executa commit, tag, push, deploy e
  publicacao. Podem nunca exigir arquivo profundo proprio, apenas referencia.
- **Qualquer disciplina `conditional`** cujo "como" seja especifico de um sistema
  resolve-se no Architecture Blueprint daquele projeto (etapa futura), nao aqui.
- Adicionar uma nova disciplina = uma nova linha; o nucleo do indice nao muda.

## Criterios de aceite

| Caso | Resultado esperado |
|---|---|
| Toda entrada tem `id` no namespace `workflow.doctrine.*`, `tier` e `ownership` validos | Verificavel por leitura das tabelas |
| Nenhuma entrada contem conhecimento profundo, regra de projeto ou copia de fonte externa | Cada linha e apenas identidade + gatilho + contexto esperado |
| Especialista externo aparece so como `ref. externa` conceitual, sem path/contrato/`policy_ref` real | `ownership: external` nao dispara integracao |
| Pedido toca input, overlay ou superficie renderizada | `visual-interface-quality` pode ser ativada por evidencia, sem ativar disciplina visual em demanda sem UI |
| Acrescentar uma disciplina exige apenas novas linhas | Nenhuma reestruturacao do arquivo |
| Disciplinas `core` cobrem arquitetura, dominio, testes, seguranca e documentacao | 5 entradas `core` presentes |

## Registro de revisao

| Versao | Estado | Revisao | Impacto |
|---|---|---|---|
| 1.0.0 | draft | Proposto pelo responsável pelo projeto em 2026-09-02 | Etapa 1 da Project Engineering Doctrine. Cria o indice esqueleto de disciplinas (5 `core`, 14 `conditional`). Sem conhecimento profundo, sem classificacao, sem integracao externa, sem leitura de Blueprint. Permanece `draft` ate revisao; sua promocao a `released` e a ligacao com o `workflow.prompt-alignment` sao etapas posteriores, com plano proprio e gate **Fazer**. |
| 1.1.0 | draft | Aprovado pelo responsável pelo projeto em 2026-10-23 | MINOR. Acrescenta `workflow.doctrine.visual-interface-quality` como disciplina `conditional`/`doctrine`, com gatilhos e contexto para integridade visual/interativa. O indice nao passa a analisar codigo, renderizar tela ou integrar biblioteca visual externa. |
| 1.2.0 | draft | Aprovado pelo responsável pelo projeto em 2026-10-23 | MINOR. Acrescenta fonte local de iconografia/midia ao contexto de integridade visual; nao fixa biblioteca ou gerador de assets. |
| 1.3.0 | draft | Aprovado pelo responsável pelo projeto em 2026-10-25 | MINOR. Acrescenta remodelagem/redesign e referencias visuais como gatilhos/contexto de `visual-interface-quality`; nao transforma referencias em Design System ou ativo compartilhado. |
| 1.4.0 | draft | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. Declara Icons8 como fonte padrao de icones de UI novos/alterados no contexto visual; exige condicao de licenca/atribuicao, sem padronizar paleta ou estilo. |
| 1.5.0 | draft | Aprovado pelo responsável pelo projeto em 2026-10-26 | MINOR. Acrescenta Flaticon como catalogo aprovado complementar e o contexto de autor/licenca/selecao assistida de familia. |
| 1.6.0 | draft | Aprovado pelo responsável pelo projeto em 2026-10-30 | MINOR. Iconoir, Phosphor, Tabler e Font Awesome Free tornam-se fontes primarias; Simple Icons cobre marcas verificadas e Icons8/Flaticon passam a excecoes licenciadas. |


