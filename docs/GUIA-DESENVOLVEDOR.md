# Guia do desenvolvedor

Para quem vai manter ou estender o Nivoo. Pressupõe que você leu o [`README`](../README.md) e o
[`ESTADO`](ESTADO.md).

## 1. Princípios que não podem ser quebrados

1. **O banco é a fonte da verdade.** Estado de jobs, fila, memória, regras e evidências ficam no
   PostgreSQL. Nada de estado só em memória de processo (exceção consciente: login em andamento pela tela).
2. **A IA nunca conclui nada sozinha.** Etapa: só termina com `verifyCommand` passando. Job: só o
   `CompletionService` marca `CONCLUIDO`, com evidência por critério — inclusive a conferência das regras.
3. **A trava não se desliga pelo chat.** Planos aprovados na conversa sempre ganham `conferencia-regras`.
4. **Texto do usuário vale como está.** Regras de modelo e de projeto não são reescritas pelo sistema.
5. **Isolamento por projeto.** Toda consulta filtra por `projectId`; arquivos passam por `resolveInside`.
6. **O agente roda confinado.** Ambiente mínimo, sem shell, sem permissões genéricas, sem arquivos de
   harness ativos. Qualquer mudança num adaptador de IA exige rodar `real-01`, `real-05` e `real-06`.
7. **Nada simulado se passa por real.** Stubs só em `test/support/stubs` (TEST-ONLY).
8. **Remoção é completa.** Ao tirar algo, saem código, rotas, telas, testes, configuração e documentação.
9. **Horário é sempre UTC.** Em SQL bruto, nunca `now()` contra colunas `DateTime` do Prisma (são
   `timestamp without time zone` em UTC): use `CURRENT_TIMESTAMP AT TIME ZONE 'UTC'` (veja `AGORA_UTC`
   em `queue/queue.service.ts`). No código TypeScript, `new Date()` / `Date.now()` já são corretos.

## 2. Mapa do código

```
apps/backend/
  prisma/schema.prisma            modelo de dados (ler primeiro)
  prisma/migrations/              migrações versionadas (nunca editar as já aplicadas);
                                  20261114180000_bases_sem_mercado remove o Mercado
  src/main.ts                     API (HTTP + SSE) e serve a interface compilada
  src/worker.ts                   processo worker (consome a fila)
  src/seed.ts                     garante o modelo padrão "Geral"
  src/config.ts                   variáveis de ambiente básicas
  src/app-setup.ts                prefixo /api e limite de corpo (NIVOO_BODY_LIMIT), usado pela API e testes
  src/app.module.ts | worker.module.ts | core.module.ts   módulos Nest (API, worker, compartilhado)

  src/accounts/
    accounts.controller.ts        rotas /accounts (Contas de IA)
    accounts.service.ts           lista as 3 IAs, chave de API, desconectar
    login-sessions.service.ts     login oficial pela tela (ponte Python com pty): Claude, Codex, Gemini
    secrets.ts                    segredos.json (600); variáveis de ambiente prevalecem

  src/areas/                      modelos: area-templates.ts (prontos), texto versionado, materiais em git
  src/projects/
    projects.service.ts           criar/editar/excluir projeto, regras do projeto, conhecimento, pasta principal
    project-profile.service.ts    "fine-tune do projeto": perfil que vai em toda sessão de IA
  src/conversations/              conversa (chat): mensagens, aprovação do plano ("Fazer") → job
  src/memory/                     memória categorizada (5 categorias); "esquecer"

  src/jobs/
    jobs.service.ts               criar job (acrescenta a trava), validar etapas/critérios/plano,
                                  iniciar, interromper, retomar, versões de objetivo
    rule-review.ts                a trava: etapa e critério conferencia-regras
    orchestrator.service.ts       agenda etapas prontas e a avaliação final (lock por job)
    completion.service.ts         ÚNICO lugar que conclui um job; integra com a pasta principal
    approvals.service.ts          aprovações (ação destrutiva, critério subjetivo)
    log.service.ts                logs sequenciais (base do tempo real)
    jobs.controller.ts            rotas de jobs, artefatos, SSE, aprovações

  src/worker/
    worker-runner.service.ts      loop: heartbeat, reivindica tarefa, renova lease, aborta se perder
    step-executor.service.ts      executa UMA sessão/tentativa: limites, política, conector,
                                  verificação, classificação, checkpoint, notas, lições
    context-builder.ts            orçamento de contexto do prompt
    planner.service.ts            responde no chat (PLAN_MESSAGE) com a IA do projeto; recusa fora do escopo

  src/queue/queue.service.ts      fila em PostgreSQL (SKIP LOCKED + lease)
  src/providers/                  interface comum + claude-code-cli, codex-cli, gemini-cli
                                  (gemini-cli.provider.ts), local-shell; registry com status
  src/storage/
    workspace.service.ts          git por projeto, worktree por job, pastas de conhecimento,
                                  cópias em contexto/, diffAgainstMain, limpeza de harness
    artifact-store.service.ts     artefatos por sha256, separados por projeto
  src/security/policy.ts          ações destrutivas (exigem aprovação)
  src/common/                     exec, hash, path-guard, validate, status,
                                  text-extract.ts (PDF/DOCX → texto), knowledge-upload.ts (envio de arquivos)
  src/system/system.controller.ts saúde, workers, conectores, /extract-text

  test/unit/                      cli-adapters (stubs), context-builder, seguranca
  test/acceptance/                02–09, 11, 12, 13-modelos-projetos-conversa (PostgreSQL real, sem IA)
  test/integration/               real-01, real-02, real-04 (Codex), real-05, real-06 — IA REAL, opt-in
  test/support/                   harness de teste, stubs TEST-ONLY

apps/web/src/
  main.tsx                        rotas: /, /p/:pid, /modelos, /contas
  Layout.tsx                      lateral: projetos por modelo, "+ Novo projeto", Modelos, Contas de IA
  Pecas.tsx                       peças comuns: editor de regras (importar PDF/Word/texto) e materiais
  api.ts | styles.css
  pages/Inicio.tsx                boas-vindas
  pages/Projeto.tsx               chat, "Posso fazer isto" + Fazer, andamento, painel (lembra/Arquivos/Ajustes)
  pages/Ajustes.tsx               regras do projeto, conhecimento, IA, limite de gasto, excluir projeto
  pages/Modelos.tsx               lista, novo modelo a partir de um pronto, texto e materiais
  pages/Contas.tsx                conectar Claude, ChatGPT e Gemini
  pages/NovoProjeto.tsx           nome, sobre, modelo, IA
apps/web/e2e/chat-smoke.cjs       fumaça da interface pelo navegador (Playwright + stub)

deploy/install-debian.sh          instalador de produção (root, idempotente, umask 022)
deploy/nivoo                      comando de administração do servidor
deploy/verificar-instalacao.sh    job de teste de ponta a ponta (nivoo verificar)
docs/                             documentação (índice em docs/README.md)
```

## 3. Ciclo de vida de um trabalho

```
chat: mensagem ─► PLAN_MESSAGE ─► planner (IA do projeto, perfil, cópia descartável da main)
      ─► resposta | plano ─► "Fazer" ─► validatePlan ─► JobsService.create
POST /jobs ──► Job PENDENTE (objetivo v1 + etapas + critérios + conferencia-regras se houver IA)
start ─► EXECUTANDO ─► orchestrator agenda etapas prontas (RUN_STEP)
worker reivindica tarefa (lease) ─► step-executor:
   limites (tempo, custo do job, custo do projeto, tentativas) ─► política ─► aprovação (hash)
   ─► conector disponível? ─► limpeza de harness ─► cópias em contexto/
   ─► prompt (perfil + contexto com orçamento; guardado como artefato) [+ diff, na conferência]
   ─► SESSÃO do agente ─► verificação da etapa ─► artefatos de out/ ─► notas → memória
   ─► SUCESSO | SESSAO_ENCERRADA | FALHA | RECURSO_INDISPONIVEL | INTERROMPIDA
todas as etapas concluídas ─► EVALUATE_JOB ─► completion.service:
   sincroniza com a main ─► critérios ─► avanço rápido da main ─► CONCLUIDO
   (ou BLOQUEADO com pendências / AGUARDANDO_APROVACAO / CONFLITO_INCORPORACAO)
```

## 4. Glossário

| Termo | Significado |
|---|---|
| Modelo (`Area`) | Jeito de trabalhar de um tipo de projeto: texto "Como a IA deve funcionar" + materiais. |
| Projeto | Unidade de isolamento: pasta git, conhecimento, artefatos, memória, regras, IA e orçamento próprios. |
| Fine-tune do projeto | Perfil persistente (regras do modelo e do projeto, conhecimento, memória, IA). Não é treino. |
| A trava | Etapa final `conferencia-regras`, feita por outra sessão de IA, cobrada por critério do backend. |
| Pasta principal | Branch `main` do projeto; acumula o trabalho concluído. |
| Job / trabalho | Trabalho durável com objetivo versionado, etapas, critérios e limites. |
| Etapa (Step) | Parte de um job, executada por um conector; pode depender de outras. |
| Tentativa / sessão (Attempt) | Uma execução de uma etapa; para IA, uma sessão real do provedor. |
| Critério de aceitação | `COMMAND`, `FILE_EXISTS`, `ARTIFACT_PRESENT`, `METRIC_THRESHOLD`, `MANUAL_APPROVAL`. |
| Checkpoint | Estado salvo + commit git na branch `job/<id>`. |
| Artefato | Arquivo produzido (ou evidência), guardado por sha256. |
| Memória | ESPECIFICACAO, ARQUITETURA_RESTRICOES, DECISAO_APROVADA, EVIDENCIA, PENDENCIA; inclui memória da conversa, notas do agente e lições. |

## 5. Rodar em desenvolvimento

```bash
# PostgreSQL local; bancos nivoo e nivoo_test criados; python3 e pdftotext (poppler-utils) instalados
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
npm test                                             # unit + aceitação (sem IA)
cd apps/backend && npx jest test/acceptance/13       # um arquivo
NIVOO_RUN_CLI_INTEGRATION=1 npx jest test/integration/real-0[1256]   # Claude Code real (custa dinheiro)
NIVOO_RUN_CODEX_INTEGRATION=1 npx jest test/integration/real-04      # Codex real
node apps/web/e2e/chat-smoke.cjs                     # interface pelo navegador (instruções no arquivo)
```

* Os testes usam o banco `nivoo_test`, aplicam migrações com `migrate deploy` e fazem TRUNCATE.
  Nunca use `prisma migrate reset`.
* Execução serial (`--runInBand`): os testes compartilham o banco.
* Testes reais dependem de modelo não determinístico: asserte propriedades, nunca a transcrição.
* Não há prova real do Gemini ainda.

## 7. Como estender

**Novo modelo pronto.** Acrescente uma entrada em `areas/area-templates.ts` (chave, nome, descrição,
texto, arquivos iniciais) e um teste em `acceptance/13`.

**Nova IA.** Implemente `AiProvider` (`providers/provider.interface.ts`): `checkAvailability()` com a
verdade sobre instalado/conectado/erros, e `execute()` devolvendo `exitCode`, `sessionEnded`,
`resourceUnavailable`, `sessionId`, custo. Use `minimalEnv`/`runProcess` (`common/exec.ts`) e só as
credenciais dela (`secretEnv`). Registre em `providers.module.ts` e `provider-registry.service.ts`, inclua
em `AI_PROVIDERS` (`projects.service.ts`) e em `ACCOUNTS` (`accounts.service.ts`) com o fluxo de login
oficial em `login-sessions.service.ts`; acrescente os arquivos de harness dela em
`WorkspaceService.HARNESS_FILES`. Escreva stub TEST-ONLY para o parsing e uma prova real em `test/integration`.

**Novo tipo de critério.** Enum `CriterionKind` (migração) → `jobs.service.ts#parseCriteria` →
`completion.service.ts#check`, sempre com evidência → teste de aceitação.

**Mudança no modelo de dados.** Edite `schema.prisma`, rode `npx prisma migrate dev --name descricao` em
`apps/backend` e faça commit da migração.

**Nova regra de segurança.** `security/policy.ts` + `test/unit/seguranca.spec.ts`.

**Decisão estrutural.** Registre uma linha em `DECISOES.md` e atualize `ESTADO.md`.

## 8. Onde olhar quando algo dá errado

| Sintoma | Onde olhar |
|---|---|
| Chat não responde | worker online? (`/api/system/workers`); IA do projeto conectada? (`/api/accounts`) |
| Job parado em EXECUTANDO | worker online? (`nivoo check`); tarefa na `QueueTask` — `SELECT status, claims, "runAt", "runAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS elegivel FROM "QueueTask" ORDER BY "createdAt" DESC LIMIT 5`; `claims = 0` com `elegivel = true` e worker online indica SQL comparando com `now()` (fuso) |
| AGUARDANDO_RECURSO | `statusDetail` do job; `/api/providers` |
| BLOQUEADO na conferência | `out/conferencia-regras.json` do worktree (`violacoes`); logs da etapa `conferencia-regras` |
| BLOQUEADO (outro) | `blockedReason` + `GET /jobs/:id/report` (pendências exatas) |
| O agente "fez" mas a etapa não conclui | log da verificação; prompt em `prompts/<etapa>/tentativa-N.md` |
| Login pela tela não termina | `GET /api/accounts/:id/login` (mensagem com o fim da saída do CLI); logs da API |
| "Importar de PDF" falha | `pdftotext` instalado? (`poppler-utils`) |
| Contexto truncado | `Attempt.contextStats`; memória completa em `.nivoo/memoria.md` do worktree |
