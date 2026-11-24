# Nivoo AI Manager — Arquitetura

Recuperação estrutural atual: [Architecture Baseline](architecture-baseline.md) e [Blueprint Motion](architecture/modules/motion.md). Consulte o módulo dono da responsabilidade e seus consumidores antes de editar.

## 1. Visão geral

```
┌──────────────┐  HTTP/SSE   ┌──────────────────────┐         ┌──────────────────────┐
│  apps/web    │ ──────────▶ │  apps/backend (API)  │         │ apps/backend (WORKER)│
│ React + TS   │             │  NestJS + Prisma     │         │  processo separado   │
│ (Vite)       │ ◀────────── │  REST + SSE (/api)   │         │  NestJS app context  │
└──────────────┘             └──────────┬───────────┘         └──────────┬───────────┘
                                        │      PostgreSQL (fonte da verdade)  │
                                        └──────────────┬──────────────────────┘
                       ┌───────────────────────────────┼─────────────────────────────┐
                       │ queue_tasks (fila persistente, lease + SKIP LOCKED)         │
                       │ modelos / projetos / regras / conversas / memória           │
                       │ jobs / steps / attempts / checkpoints / logs / artifacts     │
                       └─────────────────────────────────────────────────────────────┘
                                                       │
   Worker ─ executa as IAs (Claude / Codex / Gemini CLI) e o executor local ─▶ pastas git por projeto
                                                         + artefatos (sha256) fora das pastas
```

* **API** (`apps/backend/src/main.ts`): CRUD, máquina de estados, verificação de conclusão, aprovações,
  SSE, contas de IA (login pela tela). Não executa trabalho de IA.
* **Worker** (`apps/backend/src/worker.ts`): consome a fila persistente — respostas do chat
  (`PLAN_MESSAGE`), etapas (`RUN_STEP`) e avaliação final (`EVALUATE_JOB`). Continua com o navegador fechado.
* **Web** (`apps/web`): lateral com projetos agrupados por modelo, chat do projeto (com painel "O que o
  projeto lembra", "Arquivos" e "Ajustes"), **Modelos** e **Conexões**. Sem JSON nem configuração
  técnica na tela.

Instância única, sem multi-tenant. Isolamento é por **projeto** (pastas, artefatos e consultas filtradas
por `projectId`).

> Histórico: até 2026-11-13 havia o módulo Mercado (ativos WIN/WDO, datasets, pesquisas, hipóteses,
> experimentos) e o "Modo avançado". Foi removido por completo (ADR-041).

## 2. Pastas no disco

```
<NIVOO_WORKSPACES_ROOT>/areas/<modelo>/base/                      materiais do modelo (git próprio)
<NIVOO_WORKSPACES_ROOT>/areas/<modelo>/projetos/<projeto>/repo/   repositório do projeto; branch main = pasta principal
                                                 .../conhecimento/ conhecimento do projeto (git próprio)
                                                 .../worktrees/<jobId>   worktree de cada trabalho (branch job/<id>)
<NIVOO_ARTIFACTS_ROOT>/<projectId>/                               artefatos por sha256
<pasta acima de NIVOO_WORKSPACES_ROOT>/segredos.json              credenciais conectadas pela tela (600)
<pasta acima de NIVOO_WORKSPACES_ROOT>/conexoes.json              conexões de IA: nome, tipo, padrão (600)
~/.nivoo-ia/<id>                                                 pasta própria de cada conexão adicional
<pasta acima de NIVOO_WORKSPACES_ROOT>/git-contas.json            contas Git (GitHub/GitLab) e tokens (600)
```

O caminho do projeto fica em `Project.dirKey` (projetos migrados do antigo modelo Mercado mantêm o
caminho original).

## 3. Fila persistente

Tabela `queue_tasks` em PostgreSQL (sem Redis), consumida com `SELECT ... FOR UPDATE SKIP LOCKED`.
Cada tarefa reivindicada recebe um *lease* renovado por *heartbeat*. Se o worker morrer, o lease expira e
outra instância reivindica a tarefa; a tentativa órfã vira `INTERROMPIDA` e a etapa é retomada do último
checkpoint (ADR-002). O worker consome em duas faixas: trabalhos (`RUN_STEP`, `EVALUATE_JOB`) e chat
(`PLAN_MESSAGE`).

**Horário (UTC):** as colunas `DateTime` do Prisma são `timestamp without time zone` e o Prisma grava
**UTC**. Todo SQL bruto que compara ou escreve essas colunas usa `CURRENT_TIMESTAMP AT TIME ZONE 'UTC'`
(constante `AGORA_UTC` em `queue.service.ts`), **nunca `now()`**: `now()` devolve a hora local da sessão do
PostgreSQL. Com o servidor em `America/Sao_Paulo` (-3 h), `"runAt" <= now()` deixava toda tarefa nova
parada por 3 horas (worker online, nenhuma tarefa reivindicada, `nivoo verificar` em `EXECUTANDO` com
0 tentativas). Corrigido em 2026-11-14 (ADR-047); regressão em `test/acceptance/14-fila-fuso-horario`,
que roda a fila com o banco em `America/Sao_Paulo` e em UTC. Os `DEFAULT CURRENT_TIMESTAMP` das colunas
não são usados na prática (o Prisma preenche esses campos em UTC; não há `INSERT` em SQL bruto).

## 4. Execução durável

| Entidade | Papel |
|---|---|
| `Job` | trabalho; estado; limites (tentativas, tempo, custo, sessões) |
| `JobObjectiveVersion` | objetivo **imutável e versionado** (append-only, sha256) |
| `AcceptanceCriterion` | `COMMAND`, `FILE_EXISTS`, `ARTIFACT_PRESENT`, `METRIC_THRESHOLD`, `MANUAL_APPROVAL` |
| `Step` | etapas com dependências (`dependsOn`) |
| `Attempt` | tentativas/sessões por etapa (provedor, sessão, término, turnos, custo, prompt) |
| `Checkpoint` | estado serializado + commit git do worktree |
| `Artifact` | arquivos/evidências com sha256, fora do workspace |
| `LogEntry` | logs sequenciais (base do tempo real) |
| `Approval` | aprovações explícitas (critério subjetivo, ação destrutiva), presas ao hash do conteúdo |

Estados (job e etapa): `PENDENTE`, `EXECUTANDO`, `AGUARDANDO_RECURSO`, `AGUARDANDO_APROVACAO`,
`BLOQUEADO`, `FALHOU`, `CONCLUIDO`.

```
PENDENTE ─start─▶ EXECUTANDO ─todas etapas ok (inclusive conferencia-regras)─▶ EVALUATE_JOB
   sincroniza com a main ─ critérios automáticos ok + manuais aprovados ─▶ squash na main (1 commit legível) ─▶ CONCLUIDO
   critérios automáticos ok + manuais pendentes ─▶ AGUARDANDO_APROVACAO
   critério automático falhou                   ─▶ BLOQUEADO (pendências listadas)
   conflito ao integrar com a main              ─▶ BLOQUEADO / CONFLITO_INCORPORACAO
EXECUTANDO ─interromper─▶ BLOQUEADO(INTERROMPIDO) ─retomar─▶ EXECUTANDO
EXECUTANDO ─IA indisponível/limite─▶ AGUARDANDO_RECURSO ─(reagendado)─▶ EXECUTANDO
EXECUTANDO ─limite de tentativas/tempo/orçamento/repetição─▶ FALHOU | BLOQUEADO
```

**A IA nunca conclui um job.** Uma sessão só conclui a *etapa* (verificação da etapa passando). O job só
vira `CONCLUIDO` pelo `CompletionService`, com evidência por critério em `CriterionCheck`.

Limites: `maxAttemptsPerStep`, `maxSessionsPerStep`, `maxDurationSec`, `maxCostUsd` (job),
`Project.maxCostUsd` (projeto, somando trabalhos e conversa), `stepTimeoutSec`. Sessões seguidas sem
mudança no trabalho → `REPETICAO_IMPRODUTIVA`.

## 5. Sessões de IA

Cada tentativa de uma etapa de IA é uma sessão real do provedor. Classificação ao fim:

| Sinal | Classificação | Efeito |
|---|---|---|
| processo abortado (interrupção/perda de lease) | `INTERROMPIDA` | etapa volta a PENDENTE; nova sessão na retomada |
| limite/autenticação/rede do provedor | `RECURSO_INDISPONIVEL` | `AGUARDANDO_RECURSO`, reagendado com espera crescente |
| sessão terminou **e** verificação passou | `SUCESSO` | etapa CONCLUIDO |
| sessão terminou **e** verificação falhou | `SESSAO_ENCERRADA` | continuação automática em nova sessão (limites de sessões e de falta de progresso) |
| erro do provedor | `FALHA` | nova tentativa até `maxAttemptsPerStep`; depois `FALHOU` |

Contexto de cada sessão (guardado como artefato `prompts/<etapa>/tentativa-N.md`), com orçamento por
prioridade (`worker/context-builder.ts`, `NIVOO_CONTEXT_MAX_CHARS`): **perfil do projeto** (seção 7),
objetivo com sha256, critérios, etapas, verificação, último checkpoint, memória vigente do projeto (a
completa em `.nivoo/memoria.md`), artefatos e histórico das sessões. Canal do agente: `.nivoo/notas.jsonl`
(DECISAO_PROPOSTA, EVIDENCIA, PENDENCIA, PROGRESSO), importado para a memória; decisões só são aprovadas
por humanos.

## 6. Conectores

Interface comum `AiProvider` (`providers/provider.interface.ts`): `checkAvailability()` e `execute()`.

| Conector | Comando | Isolamento |
|---|---|---|
| `claude-code-cli` | `claude -p --output-format stream-json --verbose --restricted --strict-mcp-config --permission-mode acceptEdits` + `--append-system-prompt <perfil>` | sem Bash/WebFetch/WebSearch, sem regras genéricas, sem configurações de usuário/projeto |
| `codex-cli` | `codex exec --json --sandbox workspace-write --skip-git-repo-check -c project_doc_max_bytes=0` | sandbox do Codex (bubblewrap: precisa de namespaces; por isso o serviço `nivoo-worker` tem `RestrictNamespaces=false`); ignora `AGENTS.md`; sandbox bloqueado = IA indisponível com o motivo |
| `gemini-api` | `gemini -p --output-format stream-json --approval-mode auto_edit` com `GEMINI_API_KEY` | só por chave de API (o Google encerrou o Gemini CLI com conta pessoal; removido); HOME próprio com `~/.gemini/settings.json`: sem shell, sem web; `.gemini/` e `GEMINI.md` do workspace removidos antes de cada sessão |
| `gemini-video` | API do Gemini (Veo) | etapa do sistema, não é IA de texto |
| `juntar-videos` | ffmpeg local | etapa do sistema: junta as cenas no vídeo completo |
| `arquivos-projeto` | apagar/mover arquivos | etapa do sistema |
| `local-shell` | executor determinístico | **não é IA**; usado em verificações e etapas de comando |

Projetos só aceitam as três IAs que editam arquivos. Os conectores por API HTTP foram removidos
(ADR-046). Nenhum provedor simulado no código da aplicação; stubs só em `test/support/stubs` (TEST-ONLY).
Processos das IAs rodam em grupo próprio com ambiente mínimo; um worker que recupera tarefa com lease
expirado encerra o grupo órfão (mesmo host).

## 7. Modelos e fine-tune do projeto

* **Modelo** (`Area`): texto "Como a IA deve funcionar" versionado (`AreaInstruction`, usado exatamente
  como escrito) + materiais em `areas/<slug>/base`. Prontos em `areas/area-templates.ts`: geral (padrão,
  criado pelo seed e ao subir a API), software, atendimento, imagem, video.
* **Projeto**: regras próprias versionadas (`ProjectRule`), conhecimento em `<projeto>/conhecimento`,
  memória e IA escolhida (`Project.provider`).
* **Perfil do projeto** (`projects/project-profile.service.ts`): junta regras do modelo, regras do
  projeto, descrição e a lista dos materiais e do conhecimento. Vai no topo de todo prompt (conversa,
  trabalho e conferência) e, no Claude, também como `--append-system-prompt`. Registra as versões e
  sha256 em vigor.
* **Cópias de leitura**: antes de cada sessão, `contexto/base` e `contexto/conhecimento` são copiados
  para o diretório de trabalho da IA, excluídos do git (`.git/info/exclude`); links simbólicos não são
  seguidos. Arquivos de agente (`.claude/`, `CLAUDE.md`, `AGENTS.md`, `.gemini/`, `GEMINI.md`...)
  aparecem com `_` no início: legíveis como padrões, inertes como configuração.
* **PDF/Word**: `common/text-extract.ts` (`pdftotext` e python3 para `.docx`); `common/knowledge-upload.ts`
  acrescenta a cópia `.txt` ao enviar materiais ou conhecimento.

## 8. A trava (conferência das regras)

`jobs/rule-review.ts`. Ao criar um job com etapa de IA, `JobsService.create` acrescenta a etapa
`conferencia-regras` (depende de todas as outras; IA do projeto quando ela está no job) e o critério
COMMAND de mesmo nome. A etapa roda em **outra sessão**, sem a memória da sessão que fez o trabalho, e
recebe no contexto o diff do worktree contra o ponto de saída da `main` (`WorkspaceService.diffAgainstMain`).
Ela pode corrigir violações e grava `out/conferencia-regras.json`; o verificador da etapa e o critério
exigem `"conforme": true` e `violacoes` vazio. Etapas adicionadas depois fazem a conferência rodar de
novo. Só a API dispensa (`conferencia: false`); planos aprovados no chat nunca dispensam.

## 9. Conversa (chat)

A mensagem do usuário vira a tarefa `PLAN_MESSAGE`. O worker (`worker/planner.service.ts`) monta uma
cópia descartável (`git archive main` + `contexto/`), chama a **IA do projeto** com o perfil, arquivos,
memória e últimas mensagens, e recebe `{"tipo":"resposta"|"plano", "texto", "job", "memoria"}`. Pedidos
fora do escopo viram resposta com explicação, não plano. Plano só vira job com o "Fazer" (aprovação
humana → `validatePlan` → job com a trava → início). `memoria` (DECISAO/PREFERENCIA/FATO/PENDENCIA) vira
memória do projeto, sem duplicar (hash). IA desconectada → resposta com orientação, sem travar.

## 10. Conexões de IA

`accounts/`: `connections.ts` (lista de conexões em `conexoes.json`), `AccountsService` (criar, renomear,
padrão, excluir, chave de API, desconectar), `LoginSessionsService` (login pela tela) e `secrets.ts`
(arquivo de segredos). Várias conexões do mesmo tipo: a primeira usa o id do tipo e a configuração padrão
do serviço; as adicionais (`<tipo>--<hex>`) são instâncias do mesmo provedor (`paraConexao`) criadas pelo
`ProviderRegistry`, com credencial `<id>/<CHAVE>` em `segredos.json` e pasta própria `~/.nivoo-ia/<id>`
(`CLAUDE_CONFIG_DIR`, `CODEX_HOME` ou `HOME` do Gemini) — inclusive durante o login. O login roda o comando oficial de cada CLI dentro de uma ponte
Python com pseudo-terminal e lê da saída o link e o código:

* Claude: `claude setup-token` → o usuário cola o código → token `sk-ant-oat…` gravado como
  `CLAUDE_CODE_OAUTH_TOKEN` em `segredos.json`.
* ChatGPT: `codex login --device-auth` → link + código do usuário; o Codex grava o próprio login.
* Gemini: só por chave de API (sem login pela tela).

`segredos.json` fica em `NIVOO_SECRETS_FILE` ou ao lado da pasta de workspaces, permissão 600, gravado de
forma atômica; variáveis de ambiente de mesmo nome prevalecem. A API e o worker leem o arquivo a cada
uso, então a conexão vale sem reiniciar. Sessões de login ficam na memória da API (expiram em 15 min).

## 11. Segurança

* `PathGuard` (`resolveInside`) resolve `realpath` e recusa caminhos fora do diretório autorizado.
* Processos filhos recebem ambiente mínimo (sem `DATABASE_URL`) e só as credenciais da própria IA.
* Segredos fora do git e do banco (`.env`/`nivoo.env` e `segredos.json`); `PATCH /providers/:id` recusa
  chaves com nome de segredo.
* Política (`security/policy.ts`): ações destrutivas (`rm -r`, `git push --force`, `reset --hard`,
  `DROP`...) exigem `Approval`. (A antiga proibição de operações financeiras era específica do Mercado e
  saiu com ele.)
* Arquivos servidos ao navegador (materiais, conhecimento, artefatos) vão com `Content-Security-Policy: sandbox`.
* Cada job trabalha na branch `job/<id>`; a `main` só recebe o trabalho (um commit por squash) depois do verificador; tokens Git nunca chegam à IA (`GIT_ASKPASS`).

## 12. Decisões

Ver `docs/DECISOES.md`.
