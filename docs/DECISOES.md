# Registro de decisões (ADR)

| # | Data | Decisão | Motivo |
|---|---|---|---|
| 001 | 2026-10-27 | Monorepo npm workspaces: `apps/backend` (NestJS, API + worker) e `apps/web` (React/Vite) | Compartilhar Prisma/serviços entre API e worker sem duplicar código |
| 002 | 2026-10-27 | Fila persistente em PostgreSQL (`FOR UPDATE SKIP LOCKED` + lease/heartbeat) | Estado e fila na mesma transação; sem dependência extra (Redis); recuperação após queda por expiração de lease |
| 003 | 2026-10-27 | Prisma 6 (`prisma-client-js`) | Versão estável conhecida; migrações versionadas |
| 004 | 2026-10-27 | Tempo real via SSE com polling incremental de `LogEntry.seq` | Funciona entre processos (worker grava, API lê) sem broker |
| 005 | 2026-10-27 | Interrupção pelo usuário = `BLOQUEADO` com `blockedReason=INTERROMPIDO` | Usa somente os estados exigidos; motivo explícito |
| 006 | 2026-10-27 | Conector `local-shell` (executor determinístico, não IA) | Permite executar experimentos/scripts e testar o pipeline com conector real sem simulação |
| 007 | 2026-10-27 | Nenhum provedor simulado no código da aplicação; stubs de CLI só em `test/support/stubs` (TEST-ONLY) | Não apresentar mocks como integrações funcionais |
| 008 | 2026-10-27 | Conclusão do job só pelo `CompletionService`; saída da IA nunca altera status do job | Requisito 6 |
| 009 | 2026-10-27 | Operações financeiras reais bloqueadas por política (não aprováveis) | Requisito 7 |
| 010 | 2026-10-27 | Testes aplicam migrações com `prisma migrate deploy` e fazem TRUNCATE no banco de teste | `migrate reset` é destrutivo; evitar qualquer risco ao banco de desenvolvimento |
| 011 | 2026-10-27 | Tentativas registram pid/host; recuperação encerra grupo de processos órfão | Evitar execução duplicada após SIGKILL do worker |
| 012 | 2026-10-27 | Claude Code CLI roda com `--permission-mode acceptEdits` e sem Bash por padrão | Restringir acesso a diretórios autorizados sem bypass de permissões |
| 013 | 2026-10-27 | Não executar o Claude Code CLI real no contêiner de desenvolvimento em nuvem | O login visível ali é do próprio ambiente de desenvolvimento, não de um worker autorizado; integração real fica em teste opt-in |
