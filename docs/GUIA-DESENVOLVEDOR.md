# Guia do desenvolvedor

Para quem vai manter ou estender o Nivoo. Pressupõe que você leu o [`README`](../README.md) e o
[`ESTADO`](ESTADO.md).

## 1. Princípios que não podem ser quebrados

1. **O banco é a fonte da verdade.** Estado de jobs, fila, memória e evidências ficam no PostgreSQL.
   Nada de estado só em memória de processo, nem de "resumo de conversa" como única fonte.
2. **A IA nunca conclui nada sozinha.** Etapa: só termina com `verifyCommand` passando.
   Job: só o `CompletionService` marca `CONCLUIDO`, com evidência por critério.
3. **Isolamento por projeto.** Toda consulta de recurso de projeto filtra por `projectId`; arquivos
   passam pelo `resolveInside` (PathGuard).
4. **O agente roda confinado.** Ambiente mínimo, sem Bash, sem permissões genéricas, `--restricted`,
   sem arquivos de harness no workspace. Qualquer mudança no adaptador de IA exige rodar `real-01` e `real-05`.
5. **Nada simulado se passa por real.** Stubs só em `test/support/stubs` (TEST-ONLY).
6. **Operação financeira real é proibida** (política em `security/policy.ts`, não aprovável).

## 2. Mapa do código

```
apps/backend/
  prisma/schema.prisma            modelo de dados (ler primeiro)
  prisma/migrations/              migrações versionadas (nunca editar as já aplicadas)
  src/main.ts                     API (HTTP + SSE) e serve a interface compilada
  src/worker.ts                   processo worker (consome a fila)
  src/seed.ts                     cadastra WIN/WDO
  src/config.ts                   variáveis de ambiente
  src/app.module.ts | worker.module.ts | core.module.ts   módulos Nest (API, worker, compartilhado)

  src/jobs/
    jobs.service.ts               criar job, validar etapas/critérios, iniciar, interromper, retomar,
                                  versões de objetivo, critérios permanentes, orçamento do projeto
    orchestrator.service.ts       agenda etapas prontas e a avaliação final (lock por job)
    completion.service.ts         ÚNICO lugar que conclui um job: avalia critérios e grava evidências
    approvals.service.ts          aprovações (ação destrutiva, critério subjetivo, dados reservados)
    log.service.ts                logs sequenciais (base do tempo real)
    jobs.controller.ts            rotas de jobs, artefatos, SSE, aprovações

  src/worker/
    worker-runner.service.ts      loop: heartbeat, reivindica tarefa, renova lease, aborta se perder
    step-executor.service.ts      executa UMA sessão/tentativa: limites, política, conector,
                                  verificação, classificação, checkpoint, notas, lições
    context-builder.ts            orçamento de contexto do prompt
    planner.service.ts            responde no chat (tarefa PLAN_MESSAGE): cópia descartável, plano, memória automática

  src/queue/queue.service.ts      fila em PostgreSQL (SKIP LOCKED + lease)
  src/providers/                  conectores: interface comum + claude-code-cli, codex-cli,
                                  anthropic-api/openai-api, local-shell; registry com status
  src/storage/
    workspace.service.ts          repositório git por projeto, worktree por job, snapshot, limpeza de harness
    artifact-store.service.ts     artefatos por sha256, separados por projeto
  src/market/                     ativos WIN/WDO, datasets e validação, pesquisas, hipóteses,
                                  regra de decisão pré-registrada, experimentos, encerramento
  src/memory/                     memória categorizada do projeto (8 categorias); "esquecer"
  src/areas/                      áreas/modelos: modelos prontos (area-templates.ts), regras versionadas,
                                  base de conhecimento em git, importação de pasta
  src/conversations/              conversa (chat): mensagens, aprovação do plano → job
  src/app-setup.ts                prefixo /api e limite de corpo (usado pela API e pelos testes)
  src/security/policy.ts          ações destrutivas (exigem aprovação) e financeiras (proibidas)
  src/common/                     exec (processos), hash, path-guard, validação, estados
  src/system/system.controller.ts saúde, workers, conectores, painel

  test/unit/                      unitários (política, PathGuard, contexto, adaptadores com stub)
  test/acceptance/01..11          aceitação contra PostgreSQL real (sem IA)
  test/integration/real-01..05    provas com Claude Code/Codex REAIS (opt-in)
  test/support/                   harness de teste, stubs TEST-ONLY, gerador de dados sintéticos

apps/web/src/
  main.tsx                        rotas e menu
  api.ts | hooks.ts | components.tsx | styles.css
  pages/Painel.tsx                Painel Mercado
  pages/Projetos.tsx, Projeto.tsx, projeto/{Pesquisas,Jobs,Datasets,Memoria}.tsx
  pages/Execucao.tsx, JobDetalhe.tsx   execução e acompanhamento em tempo real (SSE)
  pages/Conectores.tsx            conectores, workers, configuração de WIN/WDO
  e2e/ui-smoke.cjs                teste de fumaça da interface avançada (Playwright)
  e2e/chat-smoke.cjs              teste de fumaça do chat e dos modelos (Playwright + stub)
  src/pages/Chat.tsx              tela inicial (chat, painel de memória e arquivos)
  src/pages/Modelos.tsx           modelos: regras e envio de pasta de padrões

deploy/install-debian.sh          instalador de produção (root, idempotente)
deploy/nivoo                      comando de administração do servidor
docs/                             documentação (índice em docs/README.md)
```

## 3. Ciclo de vida de um job

```
POST /jobs ──► Job PENDENTE (objetivo v1 + etapas + critérios [+ critérios permanentes do projeto])
POST /start ─► EXECUTANDO ─► orchestrator agenda etapas sem dependência pendente (QueueTask RUN_STEP)
worker reivindica tarefa (lease) ─► step-executor:
   limites (tempo, custo do job, custo do projeto, tentativas) ─► política ─► aprovação (hash)
   ─► conector disponível? ─► dados do experimento (sha256) ─► limpeza de harness
   ─► prompt (contexto com orçamento; guardado como artefato) ─► SESSÃO do agente
   ─► verificação da etapa ─► artefatos de out/ ─► notas .nivoo/notas.jsonl → memória
   ─► classificação:
        SUCESSO              etapa CONCLUIDO, checkpoint, agenda as próximas
        SESSAO_ENCERRADA     nova sessão automática (limites: sessões, falta de progresso)
        FALHA                nova tentativa até o limite → FALHOU (+ lição)
        RECURSO_INDISPONIVEL AGUARDANDO_RECURSO, reagenda com espera crescente
        INTERROMPIDA         checkpoint, etapa volta a PENDENTE
todas as etapas concluídas ─► EVALUATE_JOB ─► completion.service:
   critérios automáticos ok + manuais aprovados ─► CONCLUIDO (experimento + evidência na mesma transação)
   critério automático falhou                   ─► BLOQUEADO (pendências listadas)
   critério manual pendente                     ─► AGUARDANDO_APROVACAO
```

Se o worker morrer, o lease expira e outro worker reivindica a tarefa, encerra o processo órfão e
retoma do último checkpoint.

## 4. Glossário

| Termo | Significado |
|---|---|
| Projeto | Unidade de isolamento: workspace git, dados, artefatos, memória e orçamento próprios. |
| Pesquisa | Pergunta de pesquisa ligada a ativos (WIN/WDO), com hipóteses e experimentos. |
| Job | Trabalho durável com objetivo versionado, etapas, critérios e limites. |
| Etapa (Step) | Parte de um job, executada por um conector; pode depender de outras. |
| Tentativa / sessão (Attempt) | Uma execução de uma etapa; para IA, uma sessão real do provedor. |
| Critério de aceitação | Condição verificável pelo backend: `COMMAND`, `FILE_EXISTS`, `ARTIFACT_PRESENT`, `METRIC_THRESHOLD`, `MANUAL_APPROVAL`. |
| Critério permanente | Critério do projeto copiado para todo job novo (regressão). |
| Checkpoint | Estado salvo + commit git na branch `job/<id>`. |
| Artefato | Arquivo produzido (ou evidência), guardado por sha256. |
| Memória | Entradas categorizadas do projeto: especificação, restrições, decisões, hipóteses, evidências, resultados, pendências; inclui notas do agente e lições automáticas. |
| Lição | Memória gerada pelo sistema quando uma abordagem falha; orienta sessões futuras do mesmo projeto. |
| Regra de decisão pré-registrada | Métrica + limite definidos antes do experimento; decide a hipótese automaticamente. |
| Conjunto RESERVADO | Dados de validação final, bloqueados até aprovação de liberação. |

## 5. Rodar em desenvolvimento

```bash
# PostgreSQL local rodando; bancos nivoo e nivoo_test criados
npm ci
cp .env.example apps/backend/.env          # ajuste DATABASE_URL
npm run db:migrate && npm run build && npm run db:seed
npm run dev:api        # http://localhost:3000 (API + interface compilada)
npm run dev:worker     # em outro terminal
npm run dev:web        # opcional: interface com recarga em http://localhost:5173
```

O backend roda a partir de `dist/`: depois de mudar o código, `npm run build -w apps/backend` e
reinicie API/worker.

## 6. Testes

```bash
npm test                                             # tudo o que não usa IA (unit + aceitação), ~2 min
cd apps/backend && npx jest test/acceptance/04       # um arquivo
NIVOO_RUN_CLI_INTEGRATION=1 npx jest test/integration/real-0[1235]   # Claude Code real (custa ~US$ 1,50)
```

* Os testes usam o banco `nivoo_test`, aplicam migrações com `migrate deploy` e fazem TRUNCATE.
  Nunca use `prisma migrate reset`.
* Execução sempre serial (`maxWorkers: 1`): os testes compartilham o banco.
* Testes reais dependem de modelo não determinístico: asserte propriedades (classificação,
  integridade, conclusão pelo verificador), nunca a transcrição.

## 7. Como estender

**Novo conector de IA.** Implemente `AiProvider` (`providers/provider.interface.ts`): `checkAvailability()`
informando instalado/autenticado/limites/erros com verdade, e `execute()` devolvendo `exitCode`,
`sessionEnded`, `resourceUnavailable`, `sessionId`, custo. Use `minimalEnv` e `runProcess` (`common/exec.ts`).
Registre em `providers.module.ts` e `provider-registry.service.ts`. Escreva stub TEST-ONLY para o
parsing e uma prova real em `test/integration`.

**Novo tipo de critério.** Enum `CriterionKind` no schema (migração) → validação em
`jobs.service.ts#parseCriteria` → verificação em `completion.service.ts#check`, sempre devolvendo
evidência → teste de aceitação.

**Mudança no modelo de dados.** Edite `schema.prisma`, rode
`npx prisma migrate dev --name descricao` em `apps/backend` e faça commit da migração.

**Nova regra de segurança.** `security/policy.ts` + `test/unit/seguranca.spec.ts`.

**Decisão estrutural.** Registre uma linha em `DECISOES.md` e atualize `ESTADO.md`.

## 8. Onde olhar quando algo dá errado

| Sintoma | Onde olhar |
|---|---|
| Job parado em EXECUTANDO sem progresso | worker online? (`/api/system/workers`, `nivoo check`); tarefa na `QueueTask` |
| AGUARDANDO_RECURSO | `statusDetail` do job; status do conector (`/api/providers`) |
| BLOQUEADO | `blockedReason` + `GET /jobs/:id/report` (pendências exatas) |
| O agente "fez" mas a etapa não conclui | log da verificação da etapa; prompt da sessão em `prompts/<etapa>/tentativa-N.md` |
| O que o agente fez em cada turno | logs `[ferramenta]` e `[ferramenta negada/erro]` do job |
| Contexto truncado | `Attempt.contextStats`; memória completa em `.nivoo/memoria.md` do worktree |
