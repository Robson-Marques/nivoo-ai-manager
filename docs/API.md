# Referência da API

Base: `http://<host>:<porta>/api` (no servidor instalado: `http://127.0.0.1:3000/api`, via túnel SSH).
Corpo e respostas em JSON. Se `NIVOO_API_TOKEN` estiver definido, envie `Authorization: Bearer <token>`
(para SSE e download de artefatos, use `?token=<token>`). Rotas com `:pid` só enxergam recursos daquele
projeto: um id de outro projeto responde 404.

## Sistema e conectores

| Método | Rota | Função |
|---|---|---|
| GET | `/health` | Saúde da API e do banco (não exige token). |
| GET | `/dashboard` | Dados do Painel Mercado. |
| GET | `/system/workers` | Workers e último sinal (`online`). |
| GET | `/system/config` | Diretórios e configuração não secreta. |
| GET | `/providers` | Conectores: status visto pela API e por cada worker. |
| POST | `/providers/:id/check` | Verifica um conector agora. |
| PATCH | `/providers/:id` | `{ "enabled": false }` desabilita; segredos são recusados (só no `.env`). |

## Projetos, orçamento e critérios permanentes

| Método | Rota | Função |
|---|---|---|
| GET | `/projects` | Lista projetos. |
| POST | `/projects` | `{ "name", "description" }` — cria projeto e workspace git; a descrição vira memória ESPECIFICACAO. |
| GET | `/projects/:pid` | Projeto com pesquisas e datasets. |
| PATCH | `/projects/:pid/budget` | `{ "maxCostUsd": 20 }` ou `null` — orçamento total do projeto. |
| GET | `/projects/:pid/invariants` | Critérios permanentes. |
| POST | `/projects/:pid/invariants` | `{ "key", "description", "kind", "config" }` — entra em todo job novo (não aceita MANUAL_APPROVAL). |
| PATCH | `/projects/:pid/invariants/:iid` | `{ "active": false }` — vale para os próximos jobs. |

## Mercado: ativos, dados, pesquisas, hipóteses

| Método | Rota | Função |
|---|---|---|
| GET | `/market/assets` | WIN e WDO. |
| GET / PATCH | `/market/assets/:code` | Lê / altera a configuração de UM ativo (tick, valor do ponto, pregão, `validation`, `rules`). |
| GET | `/projects/:pid/datasets` | Datasets do projeto. |
| POST | `/projects/:pid/datasets` | `{ "name", "assetCode", "uri" (relativo a data/), "role": "TREINO"\|"VALIDACAO"\|"RESERVADO", "timeframe", "notes" }` |
| POST | `/projects/:pid/datasets/:did/validate` | Valida o CSV pelas regras do ativo; atualiza o sha256. |
| POST | `/projects/:pid/datasets/:did/request-release` | `{ "reason" }` — pede liberação de conjunto RESERVADO. |
| GET / POST | `/projects/:pid/researches` | Lista / cria `{ "title", "question", "assetCodes": ["WIN"] }`. |
| GET | `/projects/:pid/researches/:rid` | Pesquisa com hipóteses, experimentos, jobs e memória. |
| POST | `/projects/:pid/researches/:rid/hypotheses` | `{ "statement", "rationale", "decisionRule": { "metric", "op", "value", "datasetRole" } }` |
| PUT | `/projects/:pid/hypotheses/:hid/decision-rule` | Define a regra (recusado depois que um experimento começou). |
| POST | `/projects/:pid/hypotheses/:hid/decide` | `{ "experimentId" }` — aplica a regra pré-registrada → VALIDADA ou REJEITADA. |
| PATCH | `/projects/:pid/hypotheses/:hid` | Decisão manual (só para hipóteses sem regra; VALIDADA exige experimento verificado). |
| GET | `/projects/:pid/researches/:rid/experiments/compare` | Tabela comparativa (parâmetros × métricas). `?ids=a,b` filtra. |
| POST | `/projects/:pid/researches/:rid/close` | Encerra a pesquisa; recusado (400, com `pendencias`) se algo estiver aberto. |

## Memória do projeto

| Método | Rota | Função |
|---|---|---|
| GET | `/projects/:pid/memory` | `?category=DECISAO_APROVADA` filtra; `?all=1` inclui versões substituídas. |
| POST | `/projects/:pid/memory` | `{ "category", "title", "content", "references" }` — EVIDENCIA e RESULTADO_VALIDADO exigem referências reproduzíveis. |
| POST | `/projects/:pid/memory/:mid/supersede` | Nova versão de uma entrada (a anterior fica no histórico). |
| DELETE | `/projects/:pid/memory/:mid?by=nome` | "Esquecer": a entrada deixa de valer (fica no histórico como substituída). |

## Áreas (modelos) e base de conhecimento

| Método | Rota | Função |
|---|---|---|
| GET | `/areas` | Lista as áreas. |
| GET | `/areas/templates` | Modelos prontos: `mercado`, `generica`, `web`, `imagem`, `video`. |
| POST | `/areas` | `{ "name", "template", "instructions"?, "description"?, "slug"? }` — cria a área e a base (git). |
| GET | `/areas/:area` | Detalhe: instruções (versões), projetos, arquivos e histórico da base. |
| POST | `/areas/:area/instructions` | `{ "text", "reason" }` — nova versão das regras. |
| GET / PUT / DELETE | `/areas/:area/base/file` | `?path=` lê; `{ "path", "content" | "contentBase64" }` grava; `?path=` remove. |
| POST | `/areas/:area/base/import` | `{ "files": [{ "path", "contentBase64" }], "prefix"?, "message"? }` — importa uma pasta inteira num commit. Ignora `node_modules`, `.git`, arquivos de sistema e arquivos > 10 MB (listados em `ignorados`). |
| POST | `/areas/:area/base/from-artifact` | `{ "artifactId", "path"? }` — promove um artefato de um projeto da área para a base. |

## Projetos: pasta principal

| Método | Rota | Função |
|---|---|---|
| POST | `/projects` | Também aceita `"tipo": "web|imagem|video|generica|mercado"` (cria a área do tipo na primeira vez) ou `"area": "<slug>"`. |
| GET | `/projects?area=<slug>` | Filtra por área. |
| GET | `/projects/:pid/files` | Arquivos da pasta principal (`main`). |
| GET | `/projects/:pid/files/content?path=` | Conteúdo de um arquivo da pasta principal. |

## Conversa (chat)

| Método | Rota | Função |
|---|---|---|
| GET / POST | `/projects/:pid/conversations` | Lista / cria conversa `{ "title"? }`. |
| GET | `/projects/:pid/conversations/:cid` | Conversa com as mensagens (`status`: PENDENTE, PRONTA, ERRO; `kind`: resposta, plano, sistema, erro). |
| POST | `/projects/:pid/conversations/:cid/messages` | `{ "content" }` — enfileira a resposta da IA (409 se ainda houver uma pendente). |
| POST | `/projects/:pid/conversations/:cid/messages/:mid/approve` | `{ "decidedBy", "start"? }` — transforma o plano em job e inicia (400 sem `decidedBy`; 409 se já aprovado). |

## Jobs

| Método | Rota | Função |
|---|---|---|
| GET | `/jobs` | Todos os jobs (`?status=BLOQUEADO`). |
| GET / POST | `/projects/:pid/jobs` | Lista / cria (exemplo abaixo). |
| GET | `/projects/:pid/jobs/:jid` | Job completo: objetivos, etapas, tentativas, critérios com evidência, checkpoints, artefatos, aprovações. |
| GET | `/projects/:pid/jobs/:jid/report` | Estado real e pendências (o que falta para concluir). |
| POST | `/projects/:pid/jobs/:jid/start` | PENDENTE → EXECUTANDO. |
| POST | `/projects/:pid/jobs/:jid/interrupt` | Interrompe (BLOQUEADO/INTERROMPIDO), preservando o estado. |
| POST | `/projects/:pid/jobs/:jid/resume` | Retoma do último checkpoint. |
| POST | `/projects/:pid/jobs/:jid/evaluate` | Pede nova verificação dos critérios (nunca conclui diretamente). |
| POST | `/projects/:pid/jobs/:jid/objective` | `{ "text", "reason" }` — nova versão do objetivo (a anterior é preservada). |
| POST | `/projects/:pid/jobs/:jid/steps` | `{ "steps": [...] }` — adiciona etapas. |
| POST | `/projects/:pid/jobs/:jid/criteria` | `{ "criteria": [...] }` — adiciona critérios. |
| PATCH | `/projects/:pid/jobs/:jid/limits` | Altera limites (tentativas, tempo, custo, sessões). |
| GET | `/projects/:pid/jobs/:jid/logs` | Logs (`?after=<id>` para incremental). |
| GET (SSE) | `/projects/:pid/jobs/:jid/events` | Tempo real: eventos `state` e `logs`. |
| GET | `/projects/:pid/artifacts` | Artefatos (`?jobId=`). |
| GET | `/projects/:pid/artifacts/:aid` | Download (cabeçalho `X-Content-SHA256`; servido em sandbox). |

## Aprovações

| Método | Rota | Função |
|---|---|---|
| GET | `/approvals` | `?status=PENDENTE&projectId=` |
| POST | `/approvals/:id/decide` | `{ "decision": "APROVADO"\|"REJEITADO", "decidedBy": "nome", "reason" }` — vale só para o conteúdo aprovado (hash). |

## Exemplo: criar um job com etapa de IA

```json
POST /api/projects/<pid>/jobs
{
  "title": "Experimento reversão pós-gap",
  "objective": "Medir a taxa de reversão no conjunto de validação e produzir relatório reproduzível.",
  "researchId": "<rid>",
  "defaultProvider": "claude-code-cli",
  "limits": { "maxAttemptsPerStep": 3, "maxSessionsPerStep": 6, "maxDurationSec": 3600, "maxCostUsd": 5, "stepTimeoutSec": 600 },
  "experiment": { "name": "gap300", "datasetId": "<did>", "parameters": { "limiar_gap": 300 } },
  "steps": [
    { "key": "codigo", "instructions": "Escreva src/experimento.py ...",
      "verifyCommand": "python3 -m py_compile src/experimento.py",
      "providerOptions": { "maxTurns": 20 } },
    { "key": "executar", "dependsOn": ["codigo"], "provider": "local-shell",
      "instructions": "python3 src/experimento.py dados/validacao.csv out/metrics.json" }
  ],
  "criteria": [
    { "key": "metricas", "description": "métricas geradas", "kind": "METRIC_THRESHOLD",
      "config": { "artifact": "metrics.json", "path": "n_dias_total", "op": ">=", "value": 200 } },
    { "key": "reprodutivel", "description": "reexecução idêntica", "kind": "COMMAND",
      "config": { "command": "t=$(mktemp) && python3 src/experimento.py dados/validacao.csv $t && cmp $t out/metrics.json" } }
  ]
}
```

Regras de validação na criação: etapas de IA exigem `verifyCommand`; dependências precisam existir
e não formar ciclo; instruções com operação financeira real são recusadas; ações destrutivas
passam a exigir aprovação; dataset RESERVADO só com liberação aprovada.
