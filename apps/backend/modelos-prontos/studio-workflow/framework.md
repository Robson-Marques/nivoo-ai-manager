# Prompt Engineering Framework

**Versao do framework:** 1.0.0
**Status:** padrao organizacional
**Escopo:** framework portavel para criar, combinar, revisar e evoluir instrucoes usadas no desenvolvimento de software pelos projetos. Padroniza as solicitacoes do dono do sistema para a IA executar alteracoes; **nao** define prompts runtime usados em atendimento ao cliente, IA de produto, agentes SDR ou automacoes internas de nenhum sistema.

As palavras **DEVE**, **NAO DEVE**, **PODE** e **RECOMENDADO** definem requisitos normativos.

---

## 1. Filosofia

Prompt e um ativo de engenharia: possui responsabilidade, contrato, dependencias, versao, revisao e ciclo de vida. Ele nao e um bloco de texto solto nem um deposito de contexto.

O framework separa tres coisas:

| Elemento | Contem | Nao contem |
|---|---|---|
| Ativo de prompt | Instrucoes estaveis e verificaveis | Dados variaveis de uma execucao |
| Contexto de invocacao | Dados, referencias e objetivo pontual | Politicas permanentes duplicadas |
| Politica externa | Regras do repositorio, produto ou plataforma | Copias em cada ativo |

Uma instrucao externa de maior prioridade sempre prevalece. Conflito detectado deve interromper a liberacao do ativo e ser registrado na revisao.

## 2. Tipos e hierarquia

Todo ativo tem um `kind`:

| Tipo | Responsabilidade | Pode estender |
|---|---|---|
| `core` | Principios organizacionais minimos | nenhum |
| `domain` | Regras de uma disciplina | `core` ou `domain` |
| `capability` | Especialidade coesa | `domain` ou `capability` |
| `task` | Resultado executavel e criterios de aceite | `capability` ou `task` |
| `shared` | Bloco transversal sem papel executavel | nenhum |

Hierarquia preferencial:

```text
core -> domain -> capability -> task
```

`extends` DEVE apontar para no maximo um pai. Um ativo DEVE usar `uses` para blocos transversais, em vez de heranca multipla. Um `shared` nao pode declarar `extends`; isso preserva sua independencia e evita ciclo escondido.

## 3. Contrato do ativo

Cada ativo e um arquivo Markdown UTF-8 com front matter YAML. IDs, caminhos, chaves e versoes usam ASCII.

```yaml
---
schema: prompt-framework/v1
id: engineering.backend.api-review
kind: task
version: 1.0.0
status: draft # draft | reviewed | released | deprecated
title: Revisar contrato de API
extends: engineering.backend@2.1.0
uses:
  - output.json-review@1.0.0
policy_refs:
  - repository.engineering-rules
inputs:
  - pull_request
  - affected_contracts
outputs:
  - review_report
owners:
  - engineering
reviewers:
  - backend
change_reason: Definir revisao consistente de contratos HTTP.
---
```

O corpo DEVE usar as secoes abaixo, nesta ordem. Secoes vazias DEVEM ser removidas; nao use texto de preenchimento.

```md
# {titulo}

## Missao
Resultado que este ativo produz.

## Contexto aceito
Entradas dinamicas permitidas e como interpreta-las.

## Conhecimento e referencias
Fatos estaveis e `policy_refs` necessarios. Referencie a fonte, nao copie regras externas.

## Responsabilidades
O que executa e o que deve devolver.

## Limites e restricoes
O que nao pode fazer, criterios de seguranca e quando escalar.

## Processo
Sequencia de trabalho observavel, sem expor raciocinio privado.

## Formato de saida
Estrutura, idioma, campos obrigatorios e limites de tamanho.

## Criterios de aceite
Condicoes verificaveis para considerar a tarefa concluida.
```

`Missao`, `Responsabilidades`, `Limites e restricoes`, `Formato de saida` e `Criterios de aceite` sao obrigatorios em `task`. Nos demais tipos, `Processo` e `Formato de saida` sao opcionais quando nao houver execucao direta.

## 4. Dependencias e resolucao

`extends` e cada item de `uses` DEVEM ser declarados por `id@versao-exata`. Intervalos como `^1.0.0`, `latest` ou referencias por caminho sem versao sao proibidos em ativos `released`.

Para resolver um ativo:

1. Carregue instrucoes externas aplicaveis; elas nao sao copiadas nem sobrescritas.
2. Resolva recursivamente o unico caminho `extends`, do ancestral ao ativo final.
3. Carregue `uses` na ordem declarada, uma unica vez por `id@versao`.
4. Injete o contexto somente nas secoes ou campos declarados em `inputs`.
5. Valide IDs, versoes, ciclo, secoes obrigatorias e conflito de responsabilidade antes da execucao.

O filho pode especializar uma secao herdada, mas NAO DEVE enfraquecer limite, politica ou criterio de aceite do ancestral. Dependencias `shared` acrescentam conhecimento ou formato; nao podem redefinir missao, escopo ou precedencia.

## 5. Convencoes

- `id`: minusculas, numeros, ponto e hifen; exemplo `engineering.qa.regression-test`.
- **Namespace:** ativos agnosticos deste framework usam prefixo `workflow.*` (ex.: `workflow.system-change-base`, `workflow.prompt-alignment`). Cada projeto consumidor usa seu proprio namespace (ex.: `aquapark.*`, `studio-ux.*`, `delivery.*`, `ia-studio.*`, `financas.*`).
- `title`: linguagem humana e independente de tecnologia quando possivel.
- Um arquivo responde uma pergunta sem conectar responsabilidades nao relacionadas.
- `uses` so existe para reuso real por dois ou mais ativos; antes disso, mantenha a instrucao no consumidor.
- O ativo deve indicar fontes externas por `policy_refs`, com um identificador estavel definido pelo repositorio consumidor.
- Informacoes secretas, dados pessoais e tokens nunca pertencem ao ativo nem aos exemplos de avaliacao.

## 6. Especializacoes

As especializacoes abaixo sao capacidades, nao arquivos obrigatorios. Crie uma somente quando houver uso real e responsabilidade distinta.

| Dominio | Exemplos de capacidade |
|---|---|
| Engenharia | frontend, backend, database, devops, arquitetura, performance, integracoes |
| Qualidade | QA, code-review, technical-review, seguranca, acessibilidade |
| Produto | business, product, UX, documentation |
| IA | avaliacao de modelo, seguranca de prompt, recuperacao de contexto |

Uma capacidade pode ser tecnologicamente especializada — por exemplo, `backend.nestjs` ou `database.prisma` — somente se acrescentar regras que nao cabem na especialidade pai. Tecnologia por si so nao justifica duplicacao.

## 7. Versionamento e ciclo de vida

Cada ativo usa SemVer independente do repositorio:

| Mudanca | Versao |
|---|---|
| Correcao editorial sem alterar comportamento esperado | PATCH |
| Nova entrada, formato opcional ou regra compativel | MINOR |
| Mudanca de objetivo, precedencia, entrada obrigatoria, saida ou restricao | MAJOR |

Estados permitidos:

```text
draft -> reviewed -> released -> deprecated
```

Somente `released` pode ser consumido por outro ativo `released`. Ativo `deprecated` DEVE informar substituto e prazo de retirada. Toda liberacao DEVE registrar, no historico do proprio ativo ou em registro associado: versao, data, autor, revisor, motivo e impacto esperado.

## 8. Revisao e avaliacao

Toda revisao responde objetivamente:

1. Qual problema a instrucao resolve?
2. Quais entradas ela aceita e quais recusa?
3. Que regra e dona de cada decisao critica?
4. Existe duplicacao com pai, dependencia ou politica externa?
5. A saida e verificavel sem interpretar intencao subjetiva?
6. Qual regressao a nova versao pode introduzir?

Ativos `task` DEVEM ter casos de avaliacao representativos: caso normal, limite, conflito de contexto e falha esperada. Cada caso registra entrada reduzida, resultado esperado e versao avaliada. A v1 nao impoe ferramenta; o formato pode ser Markdown, YAML ou o mecanismo de teste do repositorio.

## 9. Governanca

| Papel | Responsabilidade |
|---|---|
| Autor | Define o problema, o ativo e os casos de avaliacao |
| Dono do dominio | Aprova semantica, limites e fontes de verdade |
| Revisor tecnico | Verifica composicao, versao, conflito e avaliacao |
| Mantenedor do framework | Evolui `schema` e regras comuns |

Alteracao em `core`, em regra de resolucao ou em `schema` exige revisao do mantenedor do framework e incremento MAJOR quando quebrar ativos existentes. Alteracao em `task` exige autor e revisor tecnico; o dono do dominio aprova quando a tarefa muda regra de negocio ou politica.

## 10. Checklist de liberacao

- [ ] O ativo tem uma responsabilidade clara e um `kind` correto.
- [ ] `id`, versao, dono, motivo e estado estao declarados.
- [ ] `extends` e unico; `uses` usa IDs e versoes exatas.
- [ ] Nao ha ciclo, dependencia duplicada ou regra externa copiada.
- [ ] Entradas, saidas e criterios de aceite sao verificaveis.
- [ ] Nenhuma restricao herdada foi enfraquecida.
- [ ] A classificacao SemVer corresponde ao impacto real.
- [ ] Casos de avaliacao cobrem normal, limite, conflito e falha.
- [ ] Revisor e aprovacao estao registrados antes de `released`.

## 11. Estrutura recomendada em qualquer repositorio consumidor

```text
docs/prompt-framework/
  README.md                 # explica o catalogo e as regras locais do projeto
  catalogo-especialidades.md  # kind: shared, autoritativo pra classificacao
  especialidades/
    <slug>.md               # kind: task, um por especialidade
```

O diretorio e uma convencao recomendada, nao uma dependencia do framework. Cada projeto pode armazenar os ativos onde sua governanca exigir, desde que preserve IDs, versoes, o contrato definido aqui e o namespace do projeto.

## 12. Exemplo reduzido

```md
---
schema: prompt-framework/v1
id: documentation.api-reference
kind: task
version: 1.0.0
status: draft
extends: engineering.documentation@1.0.0
uses:
  - output.markdown-reference@1.0.0
policy_refs:
  - repository.documentation-rules
inputs: [source_files, public_contracts]
outputs: [reference_document]
owners: [documentation]
reviewers: [engineering]
change_reason: Criar referencia tecnica verificavel a partir de contratos publicos.
---

# Documentar referencia de API

## Missao
Produzir referencia atual de uma API publica a partir de contratos fornecidos.

## Responsabilidades
Cobrir apenas rotas confirmadas pelas entradas e indicar lacunas encontradas.

## Limites e restricoes
Nao inventar rota, campo, permissao ou exemplo. Escalar quando os contratos divergirem.

## Formato de saida
Markdown com metodo, caminho, autenticacao, entrada, resposta e erros por rota.

## Criterios de aceite
Cada afirmacao tecnica aponta para um contrato fornecido; nenhuma rota ausente foi inferida.
```

