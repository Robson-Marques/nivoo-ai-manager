# Registro de decisões (ADR)

| # | Data | Decisão | Motivo |
|---|---|---|---|
| 001 | 2026-10-27 | Monorepo npm workspaces: `apps/backend` (NestJS, API + worker) e `apps/web` (React/Vite) | Compartilhar Prisma/serviços entre API e worker sem duplicar código |
| 002 | 2026-10-27 | Fila persistente em PostgreSQL (`FOR UPDATE SKIP LOCKED` + lease/heartbeat) | Estado e fila na mesma transação; sem dependência extra (Redis); recuperação após queda por expiração de lease |
| 003 | 2026-10-27 | Prisma 6 (`prisma-client-js`) | Versão estável conhecida; migrações versionadas |
| 004 | 2026-10-27 | Tempo real via SSE com polling incremental de `LogEntry.seq` | Funciona entre processos (worker grava, API lê) sem broker |
| 005 | 2026-10-27 | Interrupção pelo usuário = `BLOQUEADO` com `blockedReason=INTERROMPIDO` | Usa somente os estados exigidos; motivo explícito |
| 006 | 2026-10-27 | Conector `local-shell` (executor determinístico, não IA) | Permite executar experimentos/scripts e testar o pipeline com conector real sem simulação |
| 007 | 2026-10-27 | Provedor de teste só existe em `test/support` e exige `NIVOO_ENABLE_TEST_PROVIDER=1` | Não apresentar mocks como integrações funcionais |
| 008 | 2026-10-27 | Conclusão do job só pelo `CompletionService`; saída da IA nunca altera status do job | Requisito 6 |
| 009 | 2026-10-27 | Operações financeiras reais bloqueadas por política (não aprováveis) | Requisito 7 |
