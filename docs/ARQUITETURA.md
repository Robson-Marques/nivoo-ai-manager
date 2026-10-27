# Nivoo AI Manager — Arquitetura (Mercado V1)

## 1. Inspeção inicial do repositório

Na data de início (2026-10-27) o repositório continha apenas `README.md` e um commit inicial.
Não havia código, motores de trading ou estratégias existentes — portanto nada foi alterado
além da criação da aplicação. A `main` é preservada; todo o desenvolvimento ocorre na branch
de desenvolvimento `claude/lucid-lamport-z7zup1`.

## 2. Visão geral

```
┌──────────────┐  HTTP/SSE   ┌──────────────────────┐         ┌──────────────────────┐
│  apps/web    │ ──────────▶ │  apps/backend (API)  │         │ apps/backend (WORKER)│
│ React + TS   │             │  NestJS + Prisma     │         │  processo separado   │
│ (Vite)       │ ◀────────── │  REST + SSE (/api)   │         │  NestJS app context  │
└──────────────┘             └──────────┬───────────┘         └──────────┬───────────┘
                                        │      PostgreSQL (fonte da verdade)  │
                                        └──────────────┬──────────────────────┘
                                                       │
                       ┌───────────────────────────────┼─────────────────────────────┐
                       │ queue_tasks (fila persistente, lease + SKIP LOCKED)         │
                       │ jobs / steps / attempts / checkpoints / logs / artifacts     │
                       │ memória do projeto / hipóteses / experimentos / aprovações   │
                       └─────────────────────────────────────────────────────────────┘
                                                       │
                     Worker ─ executa conectores ─▶ workspaces isolados (git por projeto)
                                                    + armazenamento de artefatos (sha256)
```

* **API** (`apps/backend/src/main.ts`): CRUD, máquina de estados, verificação de conclusão,
  aprovações, SSE para acompanhamento em tempo real. Não executa agentes.
* **Worker** (`apps/backend/src/worker.ts`): processo independente que consome a fila
  persistente. Continua executando com o navegador fechado e com a API parada.
* **Web** (`apps/web`): quatro telas — Painel Mercado, Projetos e Pesquisas,
  Execução (tempo real) e Conectores/Configurações.

Instância única, sem multi-tenant. Isolamento é por **projeto** (workspace, artefatos e consultas
filtradas por `projectId`).

## 3. Fila persistente

Tabela `queue_tasks` em PostgreSQL (sem Redis), consumida com
`SELECT ... FOR UPDATE SKIP LOCKED`. Cada tarefa reivindicada recebe um *lease*
(`lockedBy`, `lockedUntil`) renovado por *heartbeat*. Se o worker morrer (kill -9, reinício da
máquina), o lease expira e outra instância (ou a mesma, reiniciada) reivindica a tarefa;
a tentativa órfã é marcada como `INTERROMPIDA` e o passo é retomado do último checkpoint.

Tipos de tarefa: `RUN_STEP` (executa um passo) e `EVALUATE_JOB` (verifica critérios de conclusão).

Justificativa (ADR-002): fila transacional no mesmo banco que o estado elimina inconsistência
entre "fila" e "estado do job" e reduz dependências operacionais.

## 4. Execução durável

Entidades (ver `apps/backend/prisma/schema.prisma`):

| Entidade | Papel |
|---|---|
| `Job` | trabalho; estado; orçamento (tentativas, tempo, custo); vínculo com projeto/pesquisa |
| `JobObjectiveVersion` | objetivo **imutável e versionado** (append-only, hash sha256) |
| `AcceptanceCriterion` | critérios verificáveis: `COMMAND`, `FILE_EXISTS`, `ARTIFACT_PRESENT`, `METRIC_THRESHOLD`, `MANUAL_APPROVAL` |
| `Step` | etapas com dependências (`dependsOn`) |
| `Attempt` | histórico de tentativas por etapa (provedor, saída, hash, custo, erro) |
| `Checkpoint` | estado serializado + commit git do workspace |
| `Artifact` | arquivos/evidências com sha256, armazenados fora do workspace |
| `LogEntry` | logs sequenciais (base do tempo real) |
| `Approval` | aprovações explícitas (conclusão subjetiva, ações destrutivas) |

Estados (job e etapa): `PENDENTE`, `EXECUTANDO`, `AGUARDANDO_RECURSO`, `AGUARDANDO_APROVACAO`,
`BLOQUEADO`, `FALHOU`, `CONCLUIDO`.

Transições principais do job:

```
PENDENTE ─start─▶ EXECUTANDO ─todas etapas ok─▶ (EVALUATE_JOB)
   critérios automáticos ok + manuais aprovados ─▶ CONCLUIDO
   critérios automáticos ok + manuais pendentes ─▶ AGUARDANDO_APROVACAO
   critério automático falhou                   ─▶ BLOQUEADO (com pendências listadas)
EXECUTANDO ─interromper─▶ BLOQUEADO(reason=INTERROMPIDO) ─retomar─▶ EXECUTANDO
EXECUTANDO ─provedor indisponível─▶ AGUARDANDO_RECURSO ─(reagendado)─▶ EXECUTANDO
EXECUTANDO ─limite de tentativas/tempo/orçamento/repetição─▶ FALHOU | BLOQUEADO
```

**A IA nunca conclui um job.** Uma tentativa bem-sucedida apenas conclui a *etapa* (código de
saída 0 + verificação opcional da etapa). O job só vira `CONCLUIDO` pelo `CompletionService`
do backend, que avalia os critérios com evidências gravadas em `CriterionCheck`.

### Detecção de repetição improdutiva e limites
* `maxAttemptsPerStep`, `maxDurationSec` (por job), `maxCostUsd` (orçamento),
  `stepTimeoutSec` (por tentativa).
* Cada tentativa grava `outputHash` (saída normalizada). Se as últimas *N* tentativas da etapa
  produzem o mesmo hash/erro, a etapa é `BLOQUEADO` com motivo `REPETICAO_IMPRODUTIVA`.

### Retomada
Nova tentativa recebe no prompt o objetivo vigente, critérios, o checkpoint mais recente,
decisões aprovadas e o histórico resumido de tentativas (contexto reconstruído do banco —
não de resumos de conversa).

## 5. Conectores de IA

Interface comum `AiProvider` (`apps/backend/src/providers/provider.interface.ts`):

```ts
checkAvailability(): Promise<ProviderStatus>   // disponível? autenticado? versão, limites, erros
execute(req: ExecutionRequest): Promise<ExecutionResult>
```

| Conector | Tipo | Autenticação | Observação |
|---|---|---|---|
| `claude-code-cli` | CLI | login oficial existente (`claude auth status`) | `claude -p --output-format json` no workspace |
| `codex-cli` | CLI | login oficial existente (`codex login status`) | `codex exec --json --sandbox workspace-write` |
| `anthropic-api` | API (opcional) | `ANTHROPIC_API_KEY` via env | Messages API |
| `openai-api` | API (opcional) | `OPENAI_API_KEY` via env | Responses API |
| `local-shell` | executor determinístico | — | roda scripts/experimentos; **não é IA** |

Nunca são capturados cookies, extraídas credenciais de sessões ou contornados limites. Os
CLIs só são usados se estiverem instalados e logados **no host do worker**; caso contrário o
conector reporta indisponível e as etapas ficam em `AGUARDANDO_RECURSO`.

Não há provedor simulado no código da aplicação. Os únicos mocks são binários
`apps/backend/test/support/stubs/*.sh` (marcados `TEST-ONLY`) usados para testar o *parsing*
dos adaptadores CLI. A integração real dos CLIs tem teste opt-in em `test/integration`.

Processos dos agentes rodam em grupo próprio; a tentativa registra `pid` e `hostname`. Um worker
que recupera uma tarefa com lease expirado encerra o grupo órfão (mesmo host) antes de reexecutar.

## 6. Memória do projeto

`MemoryEntry` com categorias separadas: `ESPECIFICACAO`, `ARQUITETURA_RESTRICOES`,
`DECISAO_APROVADA`, `HIPOTESE_INVESTIGACAO`, `EVIDENCIA`, `HIPOTESE_REJEITADA`,
`RESULTADO_VALIDADO`, `PENDENCIA`. Entradas são versionadas (nova versão substitui, a antiga
fica com `supersededById`). Regra de backend: `EVIDENCIA` e `RESULTADO_VALIDADO` exigem
referências reproduzíveis (artefato com sha256 **e** experimento/dataset/parâmetros/commit).

## 7. Ambiente Mercado

* `MarketAsset`: WIN e WDO com configurações independentes (tick, valor do ponto, unidade,
  horário, regras de validação). Nenhuma estratégia de trading é implementada.
* `Dataset`: vinculado a projeto e ativo, com sha256, período e papel
  (`TREINO`, `VALIDACAO`, `RESERVADO`). Conjuntos `RESERVADO` ficam bloqueados para uso em
  experimentos até liberação por aprovação explícita.
* `Research` → `Hypothesis` → `Experiment` (dataset, parâmetros, commit, métricas, job).
  Comparação de experimentos via API/tela.

## 8. Segurança

* Workspaces em `NIVOO_WORKSPACES_ROOT/<projeto>`; `PathGuard` resolve `realpath` e recusa
  qualquer caminho fora do diretório autorizado.
* Processos filhos recebem ambiente mínimo (sem segredos da API) e `cwd` no workspace.
* Segredos somente em `.env` (ignorado pelo git); o banco guarda apenas configuração não secreta.
* `PolicyService`: ações destrutivas (padrões `rm -rf`, `git push --force`, `reset --hard`,
  `DROP`, etc.) exigem `Approval`; termos de operação financeira real são **bloqueados**
  sem possibilidade de aprovação nesta versão.
* Branch de trabalho por job no git do workspace (`job/<id>`), preservando `main`.

## 9. Decisões (ADR resumido)

Ver `docs/DECISOES.md`.

## 10. Sessões de IA e continuidade (etapa 2)

Cada tentativa de uma etapa de IA é **uma sessão real** do provedor (`Attempt.sessionId`,
`stopReason`, `numTurns`, `promptArtifactId`). Classificação ao fim de cada sessão:

| Sinal | Classificação | Efeito |
|---|---|---|
| processo abortado (interrupção/perda de lease) | `INTERROMPIDA` | etapa volta a PENDENTE; nova sessão na retomada/recuperação |
| erro de limite/autenticação/rede do provedor | `RECURSO_INDISPONIVEL` | job `AGUARDANDO_RECURSO`, reagendado com espera crescente |
| sessão terminou (normal ou `max_turns`) **e** verificação da etapa passou | `SUCESSO` | etapa CONCLUIDO; agenda as próximas |
| sessão terminou (normal ou `max_turns`) **e** verificação falhou | `SESSAO_ENCERRADA` | **continuação automática** em nova sessão; limites: `maxSessionsPerStep`, sem progresso em `repetitionWindow` sessões → `REPETICAO_IMPRODUTIVA` |
| erro do provedor (ex.: `api_error`) | `FALHA` | nova tentativa até `maxAttemptsPerStep`; depois `FALHOU` |

A conclusão do **job** continua exclusiva do `CompletionService`.

Contexto de cada nova sessão (prompt guardado como artefato `prompts/<etapa>/tentativa-N.md`):
objetivo vigente com sha256, critérios, etapas, verificação da etapa, experimento (hipótese, regra
pré-registrada, dataset com sha256), último checkpoint, **toda a memória vigente do projeto/pesquisa**
(inclusive notas de sessões anteriores), artefatos já produzidos e o histórico das sessões da etapa.

Canal estruturado do agente: `.nivoo/notas.jsonl` (versionado no git do job). O worker importa
cada nota nova (deduplicada por hash) para a memória: `HIPOTESE` → `HIPOTESE_INVESTIGACAO`;
`EVIDENCIA` → `EVIDENCIA` somente se apontar artefatos registrados (senão `PENDENCIA`);
`DECISAO_PROPOSTA`, `PENDENCIA`, `PROGRESSO` → `PENDENCIA`. Decisões só são aprovadas por humanos.

Dados de experimento: o dataset é copiado para `dados/` do worktree após conferir o sha256
registrado (alteração → job bloqueado). `dados/` fica fora do git.
