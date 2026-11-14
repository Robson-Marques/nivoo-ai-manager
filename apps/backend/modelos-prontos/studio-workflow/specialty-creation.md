---
schema: prompt-framework/v1
id: workflow.specialty-creation
kind: task
version: 1.0.0
status: released
title: Criar uma nova especialidade no projeto pelo fluxo do Nivoo
extends: workflow.system-change-base@2.0.0
policy_refs:
  - project.rules
  - project.specialty-catalog
inputs:
  - approved_gap_report
  - project_repository
outputs:
  - specialty_file
  - catalog_update
  - verification_declaration
owners:
  - project-owner
reviewers:
  - project-owner
---

# Criar uma nova especialidade catalogada

## Missão

Criar uma especialidade nova somente no repositório do projeto, em
`docs/prompt-framework/`, quando o relatório de alinhamento detectar
`especialidade não catalogada`. A criação é proposta como plano do Nivoo e só
começa depois que o usuário clicar **Fazer**.

## Contexto aceito

- `approved_gap_report`: relatório de alinhamento usado como texto do plano,
  com nome, missão, justificativa, escopo mínimo e namespace propostos.
- `project_repository`: arquivos e regras do projeto no qual a especialidade
  será criada.

## Conhecimento e referências

- `contexto/base/framework.md`: schema, tipos, versionamento e seções.
- `contexto/base/prompt-alinhamento.md`: detecção da lacuna e formato do plano.
- `contexto/base/shared/system-change-base.md`: execução delimitada e validação.
- Regras, catálogo e conhecimento do projeto corrente.

## Responsabilidades

- Confirmar que a especialidade resolve responsabilidade distinta e reutilizável,
  sem duplicar uma especialidade já catalogada.
- Usar namespace do projeto e versão inicial `1.0.0`.
- Criar ou atualizar, no repositório do projeto:
  - `docs/prompt-framework/catalogo-especialidades.md`;
  - `docs/prompt-framework/especialidades/<slug>.md`.
- Preservar o escopo aprovado; expansão material exige parar e perguntar.
- Declarar no plano as etapas, os comandos de verificação e os critérios de
  pronto. A IA não executa comandos.

## Limites e restrições

- Nunca escrever ou alterar `contexto/base/`: os materiais do modelo são
  somente leitura.
- Nunca criar especialidade agnóstica neste pacote nem atualizar um CHANGELOG
  central.
- Não criar mais de uma especialidade por plano. Uma cadeia de ativos exige
  planos separados e o botão **Fazer** para cada execução.
- Não implementar o pedido original na mesma execução; após criar e validar a
  especialidade, um novo alinhamento cobre a implementação.
- Se namespace, missão, ownership ou fronteira forem ambíguos: na conversa,
  perguntar sem propor execução; durante o trabalho, parar a etapa e pedir
  confirmação.
- A IA não faz commit, tag, push, deploy ou publicação; o Nivoo cuida dessas
  operações.

## Processo

1. Verificar o relatório de lacuna e as regras do projeto.
2. Comparar a missão com o catálogo existente e confirmar que não há duplicação.
3. Definir `id`, `kind`, título, missão, entradas, saídas, limites, processo e
   critérios de aceite no schema `prompt-framework/v1`.
4. Apresentar o relatório de alinhamento como texto do plano "Posso fazer isto",
   incluindo os dois caminhos do projeto, etapas, comandos de verificação e
   critérios de pronto.
5. Aguardar o usuário clicar **Fazer**.
6. Criar `especialidades/<slug>.md` e atualizar o catálogo na mesma execução.
7. Entregar checkpoint com arquivos alterados, evidências do sistema e qualquer
   pendência real. Não implementar ainda o pedido que motivou a especialidade.

## Formato de saída

O plano preserva o formato de `workflow.prompt-alignment` e explicita:

- **Especialidade:** `{id}@1.0.0`, título, `kind` e missão.
- **Arquivos do projeto:** catálogo e `especialidades/<slug>.md`.
- **Etapas:** verificação de duplicação, criação, atualização do catálogo e
  conferência.
- **Comandos de verificação:** comandos adequados ao projeto para validar schema,
  referências e consistência; são executados pelo sistema.
- **Critérios de pronto:** arquivo válido, catálogo consistente, nenhuma mudança
  em `contexto/base/` e nenhuma implementação do pedido original.

## Critérios de aceite

| Caso | Resultado esperado |
|---|---|
| Especialidade local inédita | Plano aponta somente para `docs/prompt-framework/` do projeto |
| Missão já coberta | Não cria duplicata; propõe reutilizar a especialidade existente |
| Cadeia de duas especialidades | Separa em dois planos, cada um com seu próprio gate **Fazer** |
| Dúvida material no trabalho | A etapa para e pede confirmação ao usuário |
| Criação concluída | Catálogo e arquivo estão consistentes; novo alinhamento é necessário para implementar o pedido original |

## Registro de revisão

| Versão | Estado | Revisão | Impacto |
|---|---|---|---|
| 1.0.0 | released | Aprovado pelo responsável pelo projeto em 2026-07-23 | Fecha o loop de especialidade não catalogada. Na adaptação ao Nivoo, a criação passa a ocorrer exclusivamente no repositório do projeto e sob o gate **Fazer**. |

