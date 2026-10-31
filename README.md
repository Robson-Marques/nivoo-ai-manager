# Nivoo AI Manager — Mercado V1

Gerenciador de projetos de pesquisa quantitativa e desenvolvimento de algoritmos de trading
(ambiente **Mercado**: WIN e WDO), usando Claude Code e OpenAI Codex como executores.

Não é um chatbot: é um gerenciador de **projetos, conhecimento, evidências e execuções duráveis**.
Resolve perda de continuidade, fragmentação de trabalhos longos, saturação de contexto,
encerramento prematuro de pesquisas e ausência de validação integral.

## Comece aqui

**[`docs/README.md`](docs/README.md)** é o índice da documentação, com a ordem de leitura para cada
papel (conhecer o projeto, operar o servidor, desenvolver). Atalhos:

| Preciso de… | Leia |
|---|---|
| saber o que está pronto e o que falta | [`docs/ESTADO.md`](docs/ESTADO.md) |
| instalar no servidor Debian | [`docs/INSTALACAO-DEBIAN.md`](docs/INSTALACAO-DEBIAN.md) |
| usar e configurar no dia a dia | [`docs/OPERACAO.md`](docs/OPERACAO.md) |
| entender como funciona por dentro | [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) |
| mexer no código | [`docs/GUIA-DESENVOLVEDOR.md`](docs/GUIA-DESENVOLVEDOR.md) e [`docs/API.md`](docs/API.md) |
| saber por que algo foi feito assim | [`docs/DECISOES.md`](docs/DECISOES.md) |

> O desenvolvimento está na branch `claude/lucid-lamport-z7zup1`; a `main` ainda não recebeu o código.

> **Nenhuma operação financeira real é permitida nesta versão.** Não há estratégias de trading
> implementadas nem conexão com corretoras.

## Componentes

| Componente | Caminho | Função |
|---|---|---|
| API | `apps/backend/src/main.ts` | NestJS + Prisma; REST + SSE em `/api`; serve a interface compilada |
| Worker | `apps/backend/src/worker.ts` | Processo independente que consome a fila persistente e executa os conectores |
| Interface | `apps/web` | React + TypeScript (Vite): Painel Mercado, Projetos e pesquisas, Execução, Conectores |
| Banco | PostgreSQL 16 | Fonte da verdade, inclusive da fila |

## Instalação

**Servidor Debian (produção, como root): siga [`docs/INSTALACAO-DEBIAN.md`](docs/INSTALACAO-DEBIAN.md)** —
um comando (`deploy/install-debian.sh`) instala tudo e cria os serviços; depois use o comando `nivoo`.

Instalação manual (desenvolvimento):

Pré-requisitos: Node.js 22+, PostgreSQL 14+ (testado em 16), git e bash no host do worker.

```bash
git clone <repo> nivoo-ai-manager && cd nivoo-ai-manager
npm ci

# Banco
createdb nivoo                     # ou: psql -c 'CREATE DATABASE nivoo'
cp .env.example apps/backend/.env  # ajuste DATABASE_URL e diretórios
npm run db:migrate                 # prisma migrate deploy

# Build (backend + interface)
npm run build
npm run db:seed                    # cadastra WIN e WDO (também ocorre ao subir a API)
```

## Operação

Em três terminais (ou como serviços systemd/pm2):

```bash
npm run dev:api      # API + interface em http://localhost:3000
npm run dev:worker   # worker (pode haver vários, em hosts diferentes que compartilhem o banco e os diretórios)
npm run dev:web      # opcional: interface em modo desenvolvimento (http://localhost:5173, proxy para a API)
```

* **A execução não depende do navegador nem da API**: o worker lê a fila no PostgreSQL. Feche o
  navegador ou pare a API; o job continua. Ao reabrir, o estado completo está no banco.
* **Reinício do worker**: tarefas em andamento têm *lease* (padrão 30 s, `NIVOO_LEASE_MS`). Se o
  worker morrer, outro (ou o mesmo reiniciado) reivindica a tarefa após o lease expirar, encerra
  o processo órfão do agente (mesmo host), marca a tentativa como `INTERROMPIDA` e reexecuta a
  etapa a partir do último checkpoint.
* **Interromper/retomar**: botões na tela de Execução ou `POST /api/projects/:pid/jobs/:jid/interrupt|resume`.

### Conectores

| Conector | Como habilitar |
|---|---|
| `local-shell` | sempre disponível (executor de comandos, **não é IA**) |
| `claude-code-cli` | instalar Claude Code no host do worker e fazer login oficial (`claude`), ou `CLAUDE_CODE_OAUTH_TOKEN` gerado por `claude setup-token` |
| `codex-cli` | instalar Codex CLI no host do worker e `codex login` |
| `anthropic-api` | `ANTHROPIC_API_KEY` no `.env` do host (opcional) |
| `openai-api` | `OPENAI_API_KEY` no `.env` do host (opcional) |

O sistema **não** captura cookies, não extrai credenciais de sessões e não contorna limites. Se um
conector estiver indisponível ou atingir limite de uso, a etapa vai para `AGUARDANDO_RECURSO` e é
reagendada com espera crescente. A tela **Conectores e configurações** mostra o status visto
pela API e por cada worker online.

### Segurança

* Workspaces isolados por projeto em `NIVOO_WORKSPACES_ROOT/<projeto>` (repositório git com `main`
  preservada; cada job trabalha em `job/<id>` via *worktree*).
* Artefatos endereçados por sha256 em `NIVOO_ARTIFACTS_ROOT/<projectId>/`.
* Processos dos agentes recebem ambiente mínimo (sem `DATABASE_URL` nem chaves de API).
* Ações destrutivas (`rm -r`, `git push --force`, `reset --hard`, `DROP`…) exigem aprovação explícita;
  termos de operação financeira real são bloqueados.
* `NIVOO_API_TOKEN` (opcional) protege a API com token Bearer.
* Para isolamento em nível de sistema operacional, execute o worker com um usuário dedicado sem
  acesso a outros diretórios (ou em contêiner) — ver `docs/OPERACAO.md`.

## Testes

Testes de aceitação rodam contra PostgreSQL real, com processos reais de API e worker quando
necessário. Banco de testes padrão: `postgresql://postgres:postgres@localhost:5432/nivoo_test`
(altere com `DATABASE_URL_TEST`; as migrações são aplicadas automaticamente).

```bash
createdb nivoo_test
npm test                                   # build + todos os testes (unitários e de aceitação)
node apps/web/e2e/ui-smoke.cjs             # fumaça da interface (requer API+worker rodando e Playwright)
# Provas com executores REAIS (opt-in, no host autorizado do worker) — ver docs/PROCEDIMENTO-CLI.md
cd apps/backend && NIVOO_RUN_CLI_INTEGRATION=1 npx jest test/integration/real-0[1235]  # Claude Code CLI
cd apps/backend && NIVOO_RUN_CODEX_INTEGRATION=1 npx jest test/integration/real-04     # Codex CLI
```

| Critério de aceitação V1 | Teste |
|---|---|
| Criação de projeto e pesquisa | `test/acceptance/01-projeto-pesquisa.spec.ts` |
| Persistência do objetivo e das etapas | `test/acceptance/02-objetivo-etapas.spec.ts` |
| Execução de uma tarefa por conector disponível | `test/acceptance/03-execucao-conector.spec.ts` |
| Registro de logs e artefatos | `test/acceptance/03-execucao-conector.spec.ts` |
| Interrupção e retomada sem perda do estado | `test/acceptance/04-interrupcao-retomada.spec.ts` |
| Recuperação após reinício do worker | `test/acceptance/05-reinicio-worker.spec.ts` |
| Bloqueio de conclusão sem evidências exigidas | `test/acceptance/06-controle-conclusao.spec.ts` |
| Isolamento entre projetos | `test/acceptance/07-isolamento.spec.ts` |
| Funcionamento com navegador fechado | `test/acceptance/08-navegador-fechado.spec.ts` |
| Documentação de instalação e operação | este README + `docs/` (índice em `docs/README.md`) |

Testes adicionais: `09-sessoes-simuladas` (limite do provedor e sessões sem progresso, com stub),
`10-ciclo-cientifico-deterministico` (dados sintéticos, regra pré-registrada, sem IA),
`11-ideias-ecc` (limpeza de harness, orçamento de contexto, lições, critérios permanentes, orçamento do
projeto, aprovação por hash), `unit/context-builder`.

Provas com executores reais (Claude Code CLI): `test/integration/real-01` (classificação de término
e isolamento), `real-02` (continuidade entre sessões e queda de worker), `real-03` (ciclo científico com
dados sintéticos), `real-05` (hooks e `CLAUDE.md` plantados não têm efeito). Evidências em `docs/evidencias/`. Estado e bloqueios: `docs/ESTADO.md`.

Mocks: somente os binários `test/support/stubs/*.sh`, marcados **TEST-ONLY**, usados em
`test/unit/cli-adapters.spec.ts` e `test/acceptance/09-sessoes-simuladas.spec.ts` (caminhos de limite do provedor e sessões sem progresso). Eles não são
apresentados como integração funcional.
