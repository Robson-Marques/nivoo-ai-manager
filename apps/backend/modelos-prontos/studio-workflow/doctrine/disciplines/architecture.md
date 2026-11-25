---
schema: prompt-framework/v1
id: workflow.doctrine.architecture
kind: domain
version: 1.0.0
status: draft
title: Disciplina de arquitetura e impacto estrutural (lente agnostica)
policy_refs:
  - workflow.framework-spec
  - project.source-of-truth
owners:
  - project-owner
reviewers:
  - project-owner
change_reason: Etapa 3.1 da Project Engineering Doctrine. Primeiro corpo profundo de uma disciplina do indice. Define a lente agnostica de arquitetura/impacto estrutural — as perguntas que uma IA deve fazer antes de considerar uma mudanca estrutural segura, em qualquer projeto. Nao descreve a arquitetura de nenhum sistema, nao impoe padrao arquitetural, nao audita codigo e nao localiza dependencias/consumidores automaticamente.
---

# Disciplina de arquitetura e impacto estrutural

## Missao

Fornecer a lente agnostica de arquitetura: o conjunto de perguntas que uma IA
deve fazer, antes de considerar segura qualquer mudanca que toque a estrutura de
um sistema, em qualquer projeto que consuma este framework.

Esta disciplina responde **o que precisa ser analisado arquiteturalmente em
qualquer projeto** — nao **como este projeto especifico esta construido** (isso e
o Architecture Blueprint de cada projeto, etapa futura). O codigo e a obra
executada; a arquitetura e o projeto estrutural. Antes de mover uma parede,
precisa-se saber o que ela sustenta, o que depende dela, que cargas sao
compartilhadas e que consequencias surgem em outros pontos. Em software: qual a
responsabilidade, a fronteira, as dependencias, os consumidores, os contratos, os
invariantes, o fluxo, o compartilhamento e o impacto.

## Contexto aceito

- A demanda em linguagem natural e o contexto que o alinhador ja pode ler antes
  do gate (regras e memoria do projeto, handoff, catalogo local e estado fornecido pelo Nivoo).
- Esta lente e ativada pelo `workflow.engineering-doctrine` como disciplina
  `core` (entra em toda demanda) sempre que houver decisao estrutural a ponderar.

## Conhecimento e referencias

- `workflow.framework-spec` (`framework.md`): contrato do ativo e regras de
  composicao.
- `workflow.engineering-doctrine@1.0.0`: indice que declara esta disciplina
  (`workflow.doctrine.architecture`), seu `tier: core` e seu `required context`
  (modulo, dependencias, consumidores, contratos, invariantes). Esta disciplina e
  o corpo profundo daquela entrada; nao redefine o indice.
- `workflow.system-change-base@2.0.0` e `contexto/base/COMO-INTERAGIR-COM-O-RESPONSAVEL.md §6`: as
  **regras de execucao** (menor mudanca coesa, uma frente estrutural por vez, nao
  misturar refatoracao com feature, validacao proporcional ao risco) vivem la.
  Esta disciplina **nao as repete** — fornece a lente de analise que as informa.
- `project.source-of-truth`: onde os fatos estruturais reais de cada projeto
  (contratos, invariantes documentados) sao resolvidos pelo repositorio
  consumidor; futuramente especializado pelo Architecture Blueprint.

## Responsabilidades

- Obrigar as perguntas de analise estrutural abaixo, quando aplicaveis, antes de
  a mudanca ser considerada segura.
- Ajudar a classificar o escopo estrutural e o risco estrutural da demanda.
- Declarar qual contexto estrutural sera necessario em etapa posterior (o
  `required context`), sem localiza-lo agora.
- Sinalizar, e nao improvisar, quando o contexto necessario ainda nao existir no
  fluxo (lacuna a resolver no Blueprint futuro).

## Limites e restricoes

- **Agnostica de padrao.** Nao impor Clean Architecture, DDD, MVC, hexagonal nem
  qualquer padrao universal. A lente respeita a arquitetura real de cada projeto;
  ela pergunta, nao prescreve um estilo.
- **Agnostica de stack e framework.** Nenhuma preferencia por linguagem,
  biblioteca ou tecnologia.
- **Nao e auditoria.** Nao abrir codigo, nao mapear imports, nao construir grafo
  de dependencias, nao localizar consumidores automaticamente, nao calcular
  impacto real. Nesta etapa a disciplina apenas **obriga a pergunta**.
- **Nao contem fato de projeto.** Nenhum modulo, contrato ou invariante concreto
  de nenhum sistema — isso pertence ao Blueprint do projeto.
- **Nao duplica execucao.** As regras de como aplicar a mudanca permanecem em
  `system-change-base`; aqui fica so a analise.
- **Nao cria** Architecture Blueprint, scanner, grafo ou analise automatizada, e
  nao altera o alinhador para carregar este arquivo (frente propria, se
  necessaria).

## Dimensoes de analise

Cada dimensao e um conjunto de perguntas. Aplicar as que a demanda tornar
relevantes; nao forcar todas em toda demanda.

1. **Responsabilidade.** Qual parte do sistema detem essa responsabilidade? A
   alteracao esta sendo feita no lugar correto? Estamos colocando
   responsabilidade numa camada que nao deveria te-la?
2. **Fronteiras.** Qual modulo, camada ou dominio esta sendo atravessado? Existe
   separacao clara entre as fronteiras que o projeto ja adota (UI, aplicacao,
   dominio, persistencia, integracao, ou as que forem reais nele)? A mudanca
   rompe ou mistura fronteiras?
3. **Dependencias.** Do que o alvo depende? A mudanca introduz dependencia nova?
   A direcao dessa dependencia respeita a estrutura existente? Surge acoplamento
   desnecessario?
4. **Consumidores.** Quem usa o elemento alterado? O impacto vai alem do ponto
   visivel da demanda? Existe consumidor indireto ou compartilhado a considerar?
   (A disciplina obriga a pergunta; nao localiza consumidores automaticamente.)
5. **Contratos.** Contrato = qualquer acordo estrutural usado por outras partes
   (API, interface, tipos, eventos, DTOs, schemas, formatos, comportamento
   publico, contratos internos compartilhados). Algum contrato muda? A mudanca e
   compativel? Consumidores precisam mudar junto? Ha risco de divergencia
   silenciosa?
6. **Invariantes.** Invariante = regra estrutural ou comportamental que precisa
   permanecer verdadeira apos a alteracao. Quais invariantes governam essa area?
   Ha regra que a mudanca nao pode violar? Esses invariantes estao documentados
   ou precisam ser descobertos no Blueprint futuro? (Nao inventar invariantes de
   projeto.)
7. **Compartilhamento e reutilizacao.** O alvo e compartilhado? Ja existe
   estrutura equivalente? Estamos criando implementacao paralela? Uma alteracao
   local pode mudar comportamento global? (Principio de reuso alinhado ao
   `system-change-base`.)
8. **Fluxo.** Em qual fluxo essa parte participa? Que entradas chegam? Que saidas
   produz? Ha efeito antes ou depois do ponto alterado? (Sem diagrama nem analise
   automatica nesta etapa.)
9. **Escopo estrutural.** Distinguir a natureza da mudanca para impedir que uma
   demanda "simples" seja tratada como isolada quando nao e:
   - *local* — contida num ponto, sem atravessar fronteira nem tocar contrato;
   - *transversal* — repete-se em varios pontos/callsites;
   - *estrutural* — altera responsabilidade, fronteira ou dependencia;
   - *refatoracao* — muda a forma sem mudar o comportamento observavel;
   - *mudanca de contrato* — altera um acordo do qual outros dependem.
10. **Risco estrutural.** Ver a escala abaixo.

## Escala de risco estrutural

Avaliacao qualitativa, nao score. O risco cresce com estes fatores: numero de
fronteiras atravessadas; grau de compartilhamento do alvo; alteracao de contrato;
dependencias novas ou de direcao invertida; quantidade e tipo de consumidores;
invariantes afetados.

- **baixo** — mudanca local, sem atravessar fronteira, sem contrato, sem
  compartilhamento.
- **moderado** — atravessa uma fronteira ou toca estrutura compartilhada, mas sem
  mudar contrato nem invariante.
- **alto** — muda contrato ou invariante, afeta consumidores multiplos ou
  compartilhados, ou cruza varias fronteiras.

Quanto maior o risco, mais a execucao (via `system-change-base`) deve fatiar,
validar e pedir checkpoint — mas essa decisao de execucao nao pertence a esta
disciplina; aqui so se classifica.

## Perguntas obrigatorias

Checklist mental carregavel por uma IA antes de uma mudanca com componente
estrutural:

1. Onde essa responsabilidade pertence?
2. Qual modulo ou fronteira e afetado?
3. Do que isso depende?
4. Quem depende disso?
5. Quais contratos sao tocados?
6. Quais invariantes precisam permanecer verdadeiros?
7. Existe estrutura compartilhada ou equivalente ja pronta?
8. Qual fluxo e afetado?
9. A mudanca e realmente local?
10. Qual o risco estrutural (baixo/moderado/alto)?

Uma pergunta sem resposta disponivel no fluxo atual nao e erro: registrar como
contexto a obter em etapa posterior.

## Fronteira com o Architecture Blueprint

| Pergunta | Quem responde |
|---|---|
| O que precisa ser analisado arquiteturalmente em qualquer projeto? | **Esta disciplina** (`workflow.doctrine.architecture`) |
| Quais sao os modulos, dependencias, consumidores, contratos e invariantes **deste** sistema? | **Architecture Blueprint do projeto** (etapa futura) |

**Contexto esperado do Blueprint** (tipos, nao formato — o formato completo do
Blueprint e etapa futura): modulo e sua responsabilidade; mapa de dependencias e
suas direcoes; consumidores diretos e compartilhados; contratos publicos e
internos, com versao/compatibilidade; invariantes documentados; pontos
compartilhados e reutilizaveis. Enquanto o Blueprint nao existir, a disciplina
pergunta e sinaliza a lacuna ("Contexto arquitetural necessario em etapa
posterior"); nao a preenche por conta propria.

## Formato de saida

Quando esta lente e aplicada num alinhamento, sua contribuicao alimenta a linha
`architecture` da secao *Disciplinas envolvidas* do relatorio
(`workflow.prompt-alignment`): tier `core`, ownership `doctrine`, contexto
esperado conforme acima, e — quando houver — a classificacao de escopo e de risco
estrutural e as lacunas de contexto a obter depois. Esta disciplina nao produz
alteracao de codigo nem relatorio proprio separado.

## Criterios de aceite

| Caso | Resultado esperado |
|---|---|
| A lente e aplicada sem abrir codigo nem localizar dependencias/consumidores reais | Apenas perguntas e classificacao; nenhuma auditoria |
| A demanda parece local mas toca contrato compartilhado | Escopo reclassificado (transversal/estrutural/contrato); risco elevado |
| Pergunta sem contexto disponivel no fluxo | Registrada como lacuna a obter em etapa posterior; nao tratada como erro |
| Tentativa de impor um padrao arquitetural (Clean/DDD/MVC) | Recusada; a lente respeita a arquitetura real do projeto |
| Referencia a modulo/contrato/invariante concreto | Ausente; fatos de projeto pertencem ao Blueprint |
| Regra de execucao (fatiamento, checkpoint) | Nao repetida aqui; deferida a `system-change-base`/`COMO-INTERAGIR §7` |

## Registro de revisao

| Versao | Estado | Revisao | Impacto |
|---|---|---|---|
| 1.0.0 | draft | Proposto pelo responsável pelo projeto em 2026-09-02 | Etapa 3.1. Primeiro corpo profundo de disciplina da doutrina: lente agnostica de arquitetura/impacto estrutural (10 dimensoes, escala de risco qualitativa, checklist obrigatorio, fronteira com o Architecture Blueprint). Sem fato de projeto, sem padrao imposto, sem auditoria de codigo, sem integracao com o alinhador. Permanece `draft`; promocao e eventual ligacao ao fluxo sao etapas posteriores. |

