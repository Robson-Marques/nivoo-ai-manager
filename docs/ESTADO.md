# Estado do desenvolvimento (checkpoint para retomada)

> Ponto de retomada para a próxima sessão/orquestrador. Atualizado em 2026-10-27.
> Branch de desenvolvimento: `claude/lucid-lamport-z7zup1` (a `main` não foi alterada).

## Plano e situação

| Fase | Item | Estado |
|---|---|---|
| 0 | Inspeção do repositório (vazio), arquitetura, plano | FEITO |
| 1 | Monorepo, Prisma schema, migrações (`init`, `attempt_pid`) | FEITO |
| 2 | Fila persistente + worker (lease/heartbeat/recuperação, órfãos) | FEITO |
| 3 | Jobs: objetivo versionado, etapas/dependências, tentativas, checkpoints git, logs, artefatos sha256 | FEITO |
| 4 | Conectores: claude-code-cli, codex-cli, anthropic-api, openai-api, local-shell | FEITO (ver pendências) |
| 5 | Controle de conclusão: critérios, evidências, aprovações, repetição, limites de tentativas/tempo/orçamento | FEITO |
| 6 | Memória categorizada + Mercado (WIN/WDO independentes, datasets com validação, reservado, pesquisas, hipóteses, experimentos, comparação) | FEITO |
| 7 | Segurança: PathGuard, workspaces isolados, env mínimo, política destrutiva/financeira, token opcional | FEITO |
| 8 | Frontend: 4 telas (Painel, Projetos/pesquisas, Execução em tempo real, Conectores) | FEITO |
| 9 | Testes de aceitação V1 | FEITO — 46 passando, 2 opt-in pulados |
| 10 | Documentação de instalação e operação (README, docs/OPERACAO.md) | FEITO |

## Critérios de aceitação V1

| Critério | Teste | Estado |
|---|---|---|
| Criação de projeto e pesquisa | `apps/backend/test/acceptance/01-projeto-pesquisa.spec.ts` | PASSA |
| Persistência do objetivo e das etapas | `02-objetivo-etapas.spec.ts` | PASSA |
| Execução de uma tarefa por conector disponível | `03-execucao-conector.spec.ts` (local-shell, real) | PASSA |
| Registro de logs e artefatos | `03-execucao-conector.spec.ts` | PASSA |
| Interrupção e retomada sem perda do estado | `04-interrupcao-retomada.spec.ts` | PASSA |
| Recuperação após reinício do worker | `05-reinicio-worker.spec.ts` (processos reais, SIGKILL) | PASSA |
| Bloqueio de conclusão sem evidências exigidas | `06-controle-conclusao.spec.ts` | PASSA |
| Isolamento entre projetos | `07-isolamento.spec.ts` | PASSA |
| Funcionamento com navegador fechado | `08-navegador-fechado.spec.ts` (API e worker reais; API derrubada) | PASSA |
| Documentação de instalação e operação | `README.md`, `docs/OPERACAO.md` | FEITO |
| Interface (4 telas) | `apps/web/e2e/ui-smoke.cjs` (Playwright, instância real) | PASSA |

## Pendências e impedimentos (precisos)

1. **Integração real do Claude Code CLI e do Codex CLI não foi executada nesta sessão.**
   * Codex CLI não está instalado no contêiner de desenvolvimento → o conector reporta corretamente
     "CLI não encontrado".
   * Claude Code CLI está instalado e aparece autenticado no contêiner, mas esse login pertence ao
     próprio ambiente de desenvolvimento em nuvem, não a um worker autorizado do projeto. Por
     decisão (ADR-013) não foi usado.
   * O adaptador está implementado e testado com stub TEST-ONLY (argumentos, status, parsing, limite).
   * **Para concluir:** no host autorizado do worker, com `claude` e `codex` logados oficialmente,
     rodar `NIVOO_RUN_CLI_INTEGRATION=1 npx -w apps/backend jest test/integration`.
2. Conectores de API (Anthropic/OpenAI) não foram exercitados contra os serviços (sem chaves).
   Exigem `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` no `.env` do host.
3. Isolamento em nível de SO do `local-shell` depende da implantação (usuário dedicado/systemd/
   contêiner) — documentado em `docs/OPERACAO.md §6`.

## Próximos passos sugeridos

* Executar a integração real dos CLIs no host do worker (item 1) e registrar o resultado aqui.
* Adicionar autenticação de usuários com papéis caso a instância seja compartilhada.
* Tela de edição de etapas/critérios de jobs existentes (hoje via API).

## Como retomar

```bash
git checkout claude/lucid-lamport-z7zup1
npm ci && cp .env.example apps/backend/.env   # ajustar DATABASE_URL
npm run db:migrate && npm test
```
