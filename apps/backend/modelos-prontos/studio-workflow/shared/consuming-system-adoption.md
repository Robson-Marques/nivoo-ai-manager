---
schema: prompt-framework/v1
id: workflow.consuming-system-adoption
kind: capability
version: 1.0.0
status: released
title: Governar a adoção controlada de um artefato externo (DS, framework, biblioteca) por um sistema consumidor
extends: workflow.system-change-base@2.0.0
policy_refs:
  - project.rules
  - project.source-of-truth
  - external-artifact.rules
inputs:
  - approved_alignment_report
  - user_request
  - external_artifact_identity
  - consumer_project_state
outputs:
  - adoption_plan
  - callsite_map
  - phased_rollout
  - rollback_strategy
owners:
  - project-owner
reviewers:
  - project-owner
reviewed_at: "2026-07-23"
released_at: "2026-07-23"
change_reason: Nova capability agnóstica; extraída de padrão recorrente (Meta API no Studio UX; STUDIO-WORKFLOW nos 5 projetos; Studio UX no AquaPark). Adoção não é implementação em lote; é decisão + mapeamento + rollout faseado com coexistência.
---

# Adoção de artefato externo por sistema consumidor

## Missão

Governar a decisão, o mapeamento e o rollout faseado da adoção de um artefato externo (design system, framework, biblioteca, plataforma) por um sistema consumidor — respeitando as regras do próprio artefato e as regras do projeto que adota, com coexistência controlada entre o padrão antigo e o novo durante toda a transição.

## Contexto aceito

- `external_artifact_identity`: qual artefato, qual versão, onde vive (path/URL), qual contrato/API oficial.
- `consumer_project_state`: repositório consumidor, `CLAUDE.md`/`AGENTS.md`, catálogo local, dependências atuais que serão substituídas.
- `approved_alignment_report`: relatório de alinhamento usado como texto do plano do Nivoo; este ativo **não é** o alinhador e só edita depois do clique em **Fazer**.

## Conhecimento e referências

- **Regras do repositório consumidor** (`project.rules`): `CLAUDE.md`/`AGENTS.md` do repo que adota — inclui regras de governança de mudança, uma frente por vez, checkpoint entre frentes, sweeps mecânicos 1 arquivo por vez.
- **Regras do artefato externo** (`external-artifact.rules`): documentação e regras que o próprio artefato publica (ex.: um DS que proíbe modal-sobre-modal; um framework que exige tal padrão de importação). **Ler antes** de decidir o mapeamento.
- **`workflow.system-change-base@2.0.0`**: capability base que este ativo estende — gate **Fazer**, fontes antes de editar, documentação viva e menor mudança coesa permanecem em vigor.
- **`contexto/base/COMO-INTERAGIR-COM-O-RESPONSAVEL.md`**: regras universais de interação.

## Responsabilidades

- Reconhecer que **adoção não é implementação em lote**. É decisão arquitetural + mapa de callsites + rollout faseado com coexistência.
- **Auditar regras do artefato externo antes** de propor mapeamento — regra do artefato prevalece sobre conveniência do consumidor (ex.: se o DS proíbe padrão X e o consumidor faz padrão X, o consumidor refatora, não o DS relaxa).
- **Escolher uma tela/módulo piloto** representativo (a família mais comum) e portar completa antes de propagar. Sem piloto validado, propagação é retrabalho garantido.
- **Definir coexistência explícita**: o padrão antigo continua funcional em todo callsite não migrado. Não é "trocar tudo atomicamente".
- **Mapear cada callsite** do padrão antigo antes de tocar — sem mapa, migração vaza e quebra silenciosamente.
- **Definir rollback**: reverter um callsite migrado volta ao padrão antigo sem dor. Não é migração de mão única.
- **Deep-links, integrações e contratos externos** que dependem do padrão antigo continuam funcionando durante toda a transição (via redirect, adapter, bridge).
- **Cada família de callsites migrada é sub-frente própria**, com plano e clique em **Fazer**, não continuação automática.

## Limites e restrições

- **Não** adotar em uma única frente que reescreve tudo, mesmo com autorização explícita para "aceitar quebra visual". A quebra visual é um risco aceitável; a quebra arquitetural e o retrabalho garantido são custos, não risco.
- **Não** ignorar regra explícita do artefato externo para "acelerar" adoção. Se o artefato proíbe padrão X e o consumidor usa X, o mapa aponta a dívida e propõe refactor — não força integração antipadrão.
- **Não** migrar callsites em lote ("substituir todos `Modal` por `DSModal` no repo") sem tela piloto validada. Sweep cego é o antipadrão que este ativo existe para bloquear.
- **Não** eliminar o padrão antigo antes de todos os callsites migrarem. Coexistência é regra, não exceção.
- A IA não executa comandos, testes, commit, tag, push, deploy ou publicação.
  Declara no plano os comandos de verificação e critérios de pronto; o sistema
  executa. O piloto exige validação humana antes da propagação.

## Processo

1. **Ler as regras do artefato externo** primeiro. Anotar restrições, anti-padrões e o que o artefato explicitamente **não faz**.
2. **Mapear callsites do padrão antigo** no repositório consumidor. Declarar no plano o comando de busca exaustiva que o sistema executará; sem mapa, não avança.
3. **Escolher tela/módulo piloto** — a família mais comum ou a que valida mais padrões de uma vez (ex.: uma tela CRUD cobre listagem+detalhe+formulário+confirmação).
4. **Identificar conflitos** entre regras do artefato e padrões do consumidor. Cada conflito precisa de decisão: (a) refactor no consumidor, (b) exceção documentada, (c) frente arquitetural separada primeiro.
5. **Escrever ADR curto** no doc afetado (contexto → decisão → consequência → estratégia de coexistência → rollback).
6. **Portar o piloto** com o padrão novo, mantendo o antigo funcional em outros callsites.
7. **Validação humana** do piloto antes de propagar. Sem confirmação do responsável pelo projeto, a etapa para e pede confirmação.
8. **Propagação por família**, uma sub-frente por família de tela/módulo, cada uma com plano próprio, clique em **Fazer** e checkpoint.
9. **Remoção do padrão antigo** só quando o último callsite migrar.

## Formato de saída

- **Mapa de callsites**: lista completa dos lugares que usam o padrão antigo, com prioridade e complexidade estimada.
- **Estratégia de coexistência**: como novo e antigo convivem durante a transição (adapter, bridge, redirect).
- **Ordem de migração**: piloto primeiro; famílias em seguida; remoção do antigo por último.
- **Rollback**: como reverter um callsite migrado.
- **Conflitos identificados** e decisão para cada um (refactor / exceção / frente separada).
- **Checkpoint**: o que ficou pronto, o que quebrou intencionalmente, o que ficou pendente.

## Critérios de aceite

| Caso | Resultado esperado |
|---|---|
| Pedido "adote tudo numa frente só, aceito quebrar" | Recusado; retorna com plano de tela piloto + propagação por família |
| Regra do artefato conflita com padrão do consumidor | Identificado no ADR; decisão explícita (refactor / exceção / frente separada) antes de portar |
| Padrão antigo ainda em uso em algum callsite | Coexistência preservada; padrão antigo continua funcional |
| Sweep mecânico ("substituir todos X por Y") | Recusado; sweep é 1 arquivo por vez com validação |
| Deep-link legado depende de padrão antigo | Redirect/adapter/bridge implementado antes de portar |
| Callsite migrado | Rollback documentado e testável |
| Piloto ainda não validado por humano | A etapa para e pede confirmação; propagação bloqueada |

## Como um projeto instancia esta capability

Uma frente concreta de adoção em um projeto vira uma **task** local com namespace do projeto. Exemplo: `aquapark.studio-ux-adoption@1.0.0` (`kind: task`), com `extends: workflow.consuming-system-adoption@1.0.0`. A task local instancia o `external_artifact_identity` concreto (qual DS, qual versão) e aponta `policy_refs` para os arquivos reais do repo (o `CLAUDE.md` do consumidor e o `CLAUDE.md`/regras do artefato externo).

## Registro de revisão

| Versão | Estado | Revisão | Impacto |
|---|---|---|---|
| 1.0.0 | released | Aprovado pelo responsável pelo projeto em 2026-07-23 | Nova capability agnóstica; extraída de padrão recorrente detectado durante a adoção do STUDIO-WORKFLOW e do Studio UX pelos projetos. Substitui o fluxo ad-hoc de "reescrever tudo em uma leva". |

