---
schema: prompt-framework/v1
id: workflow.doctrine.domain
kind: domain
version: 1.0.0
status: draft
title: Disciplina de dominio / regra de negocio (lente minima)
policy_refs:
  - workflow.framework-spec
  - project.source-of-truth
owners:
  - project-owner
reviewers:
  - project-owner
change_reason: Etapa 3.5 da Project Engineering Doctrine. Lente MINIMA, propositalmente mais curta que arquitetura/seguranca/testes. Fecha a pergunta transversal orfa identificada na Etapa 3.4 — "qual e o comportamento correto segundo a regra de negocio?". Nao responde qual e a regra (isso pertence ao projeto); orienta a IA a localiza-la, nao inventa-la, distinguir regra de implementacao e sinalizar ambiguidade/conflito. Sem conhecimento de dominio especifico, sem metodologia (DDD, bounded contexts, event storming) imposta.
---

# Disciplina de dominio / regra de negocio

## Missao

Lente **minima** e agnostica. Ela nao responde "qual e a regra deste sistema" —
isso pertence ao projeto. Ela responde **onde a regra deve ser buscada, como
reconhecer que ela governa a mudanca e quando nao ha informacao suficiente para
decidir sem inventar**.

Fecha a pergunta transversal que arquitetura, seguranca e testes nao possuem:
*qual e o comportamento correto segundo a regra de negocio?*

## Contexto aceito

- A demanda em linguagem natural e o contexto que o alinhador ja pode ler antes
  do gate (regras e memoria do projeto, handoff, catalogo local e estado fornecido pelo Nivoo).
- Ativada pelo `workflow.engineering-doctrine` como disciplina `core` sempre que
  a mudanca depender de uma regra de negocio.

## Conhecimento e referencias

- `workflow.framework-spec` (`framework.md`): contrato do ativo.
- `workflow.engineering-doctrine@1.0.0`: indice que declara esta disciplina
  (`workflow.doctrine.domain`, `tier: core`). Corpo (minimo) daquela entrada.
- `workflow.doctrine.architecture@1.0.0`, `workflow.doctrine.security@1.0.0`,
  `workflow.doctrine.testing@1.0.0`: disciplinas irmas cujas fronteiras estao
  abaixo.
- `workflow.system-change-base@2.0.0` e `contexto/base/COMO-INTERAGIR-COM-O-RESPONSAVEL.md §3`: a
  regra "nao inventar comportamento" e "desconfiar de erro silencioso / resultado
  plausivel" ja existem la; esta lente as aplica ao plano da regra de negocio, sem
  duplicar a execucao.
- `project.source-of-truth`: a referencia atual da regra real de cada projeto;
  futuramente o Architecture Blueprint podera apontar fontes estruturadas. A
  doutrina nunca copia a regra especifica.

## Responsabilidades

Obrigar a IA a responder, quando aplicavel: qual regra governa a decisao; onde
esta sua fonte de verdade; se a demanda e coerente com a regra existente; se ha
ambiguidade ou conflito; se a mudanca altera a regra ou apenas a implementacao;
se o comportamento esperado foi explicitamente definido; se ha estado, condicao
ou excecao de negocio relevante; e se ha informacao suficiente para executar sem
inventar. Registrar lacunas sem preenche-las por suposicao.

## Limites e restricoes

- **Nao contem regra de dominio.** Nenhuma regra de nenhum produto vive aqui.
- **Nao inventa.** Regra ausente, estado ou excecao nao definidos viram pendencia,
  nunca suposicao.
- **Codigo nao e fonte de verdade.** "O codigo atualmente faz X" nao e "X e a
  regra correta" — o codigo pode estar errado. Havendo definicao explicita, a
  fonte de verdade prevalece.
- **Sem metodologia imposta.** Nada de DDD, linguagem ubiqua, aggregates,
  bounded contexts ou event storming como framework obrigatorio. O Workflow
  precisa saber nao inventar regra, nao estudar DDD.
- **Nao duplica** a execucao (`system-change-base`) nem absorve o modelo tecnico
  de autorizacao (seguranca/autorizacao) ou a prova (testes).
- **Nao altera o gate** nem cria mecanismo de aprovacao; apenas registra a decisao
  necessaria quando a ambiguidade impedir execucao segura.

## Regra versus implementacao

- **Regra de negocio:** o comportamento correto exigido pelo produto (ex.
  conceitual: uma conversa so pode ir a determinado estado quando certas condicoes
  forem atendidas).
- **Implementacao:** onde/como a regra esta escrita (ex. conceitual: num servico,
  hook ou controller).

A lente impede confundir "o codigo faz isso" com "essa e a regra correta". Ao
mudar, distinguir tambem: (a) **correcao** da implementacao para obedecer a regra
existente; (b) **alteracao deliberada** da regra; (c) **comportamento novo** ainda
sem regra formalizada; (d) **divergencia** entre documentacao e implementacao.
Registrar qual dos quatro e o caso — o impacto de cada um e diferente.

## Ambiguidade e conflito

- Se a demanda admite mais de uma interpretacao de negocio: nao inventar, nao
  escolher pela implementacao atual, nao escolher pela solucao tecnicamente mais
  conveniente — **registrar a ambiguidade**. Quando ela impedir execucao segura,
  apresenta-la como decisao necessaria.
- Se houver **multiplas fontes conflitantes** (pedido, documentacao, comportamento
  atual): **sinalizar o conflito**; nao escolher uma silenciosamente.

## Estados e condicoes

Quando aplicavel, procurar (nao definir): estados validos, transicoes,
pre-condicoes, pos-condicoes, excecoes, limites e consequencias de negocio. Os
valores reais pertencem ao projeto; a lente so obriga a procura-los.

## Perguntas obrigatorias

Checklist curto, carregavel por uma IA:

1. Qual regra de negocio governa esta mudanca?
2. Qual e a fonte de verdade dessa regra?
3. A regra esta explicita ou estou inferindo?
4. O pedido altera a regra ou apenas a implementacao?
5. Existe estado, condicao ou excecao relevante?
6. Ha conflito entre pedido, documentacao e comportamento atual?
7. Existe informacao suficiente para decidir sem inventar?
8. Qual comportamento correto Testes devera validar?

Pergunta sem resposta nao e preenchida por invencao: registrar como contexto
pendente.

## Fronteiras com outras disciplinas

| Disciplina | Ela responde | Dominio responde |
|---|---|---|
| `workflow.doctrine.architecture` | onde a responsabilidade deve existir e qual o impacto estrutural | qual comportamento e correto |
| `workflow.doctrine.testing` | como provar que a implementacao respeita o comportamento | qual e (ou onde esta) o comportamento correto |
| `workflow.doctrine.security` | o risco de acesso, exposicao ou privilegio (modelo tecnico) | quem pode/deve fazer algo segundo a regra do produto, quando explicito |
| Architecture Blueprint (futuro) | modulo responsavel, fluxo, estados, contratos, fontes documentais, invariantes, decisoes de negocio | pergunta pela regra e sua fonte |

## Contexto esperado do Blueprint

A lente podera esperar: regra aplicavel; fonte de verdade; fluxo afetado; estados
validos; pre-condicoes; pos-condicoes; excecoes; criterios de negocio; conflito
conhecido entre fontes, se existir. O formato do Blueprint nao e definido aqui
(etapa futura). Enquanto ele nao existir, a lente pergunta e sinaliza a lacuna.

## Criterios de aceite

| Caso | Resultado esperado |
|---|---|
| Regra de negocio ausente na demanda | Registrada como pendencia; nunca suposta |
| "O codigo faz X" apresentado como a regra | Recusado como fonte definitiva; prevalece a fonte de verdade explicita |
| Demanda com multiplas interpretacoes | Ambiguidade registrada; se impedir execucao segura, vira decisao necessaria |
| Fontes conflitantes (pedido/doc/codigo) | Conflito sinalizado; nenhuma escolhida silenciosamente |
| Mudanca de regra vs correcao de implementacao | Distinguidas e registradas (impacto diferente) |
| Tentativa de impor DDD/bounded contexts | Recusada; a lente e minima e agnostica |
| Regra concreta de um produto | Ausente; pertence ao projeto/Blueprint |

## Registro de revisao

| Versao | Estado | Revisao | Impacto |
|---|---|---|---|
| 1.0.0 | draft | Proposto pelo responsável pelo projeto em 2026-09-02 | Etapa 3.5. Lente minima de dominio/regra de negocio — fecha a pergunta semantica orfa da Etapa 3.4. Propositalmente mais curta que arquitetura/seguranca/testes: orienta a localizar a regra, nao inventa-la, distinguir regra de implementacao e sinalizar ambiguidade/conflito. Sem regra de projeto, sem metodologia de dominio imposta, sem alteracao do gate. Fecha o tier `core` da doutrina (documentacao permanece so no indice, por decisao da Etapa 3.4). Permanece `draft`; promocao e ligacao ao fluxo sao etapas posteriores. |

