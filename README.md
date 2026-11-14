# Nivoo AI Manager

Sistema simples, com o **chat** como tela principal, para trabalhar com IA em projetos de qualquer
assunto (software, atendimento, conteúdo, imagem, vídeo...). A IA do projeto (Claude, ChatGPT/Codex ou
Gemini) conversa, propõe um plano, executa só depois do seu "Fazer", é conferida por uma segunda IA
independente e o resultado fica guardado na pasta do projeto.

O que o Nivoo resolve: a IA esquecer o combinado, sair do escopo, inventar, dar trabalho por concluído
sem estar e perder continuidade entre um pedido e outro.

* **Modelos**: o jeito de trabalhar de um tipo de projeto (ex.: "Sistemas ERP / SaaS"). Texto livre
  "Como a IA deve funcionar" (usado exatamente como você escreveu) + materiais de referência.
* **Fine-tune do projeto** (não é fine-tuning do modelo de IA): regras do modelo + regras do projeto +
  conhecimento do projeto + memória automática da conversa + a IA escolhida. Vai em toda sessão de IA.
* **A trava**: todo trabalho feito por IA termina com uma conferência das regras feita por outra sessão
  de IA; o trabalho só fica pronto se ela disser "conforme" e o backend conferir.
* **Contas de IA**: conecte Claude, ChatGPT e Gemini pelo navegador, com o login oficial de cada uma.

> Histórico: até 2026-11-13 o produto era o "Mercado V1" (pesquisa quantitativa para WIN/WDO). Esse
> módulo foi removido por completo em 2026-11-14 (ver `docs/DECISOES.md`, ADR-041).

## Comece aqui

**[`docs/README.md`](docs/README.md)** é o índice da documentação. Atalhos:

| Preciso de… | Leia |
|---|---|
| saber o que está pronto e o que falta | [`docs/ESTADO.md`](docs/ESTADO.md) |
| instalar no servidor Debian | [`docs/INSTALACAO-DEBIAN.md`](docs/INSTALACAO-DEBIAN.md) |
| usar e configurar no dia a dia | [`docs/OPERACAO.md`](docs/OPERACAO.md) |
| entender como funciona por dentro | [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) |
| mexer no código | [`docs/GUIA-DESENVOLVEDOR.md`](docs/GUIA-DESENVOLVEDOR.md) e [`docs/API.md`](docs/API.md) |
| saber por que algo foi feito assim | [`docs/DECISOES.md`](docs/DECISOES.md) |

## Componentes

| Componente | Caminho | Função |
|---|---|---|
| API | `apps/backend/src/main.ts` | NestJS + Prisma; REST + SSE em `/api`; serve a interface compilada |
| Worker | `apps/backend/src/worker.ts` | Processo independente que consome a fila persistente: respostas do chat e trabalhos |
| Interface | `apps/web` | React + TypeScript (Vite): projetos na lateral, chat, Modelos, Contas de IA |
| Banco | PostgreSQL 16 | Fonte da verdade, inclusive da fila |

## Instalação

**Servidor Debian (produção, como root): siga [`docs/INSTALACAO-DEBIAN.md`](docs/INSTALACAO-DEBIAN.md)** —
um comando (`deploy/install-debian.sh`) instala tudo (inclusive Claude Code, Codex, Gemini CLI e
`poppler-utils`) e cria os serviços; depois conecte as IAs na tela **Contas de IA**.

Instalação manual (desenvolvimento). Pré-requisitos: Node.js 22+, PostgreSQL 14+ (testado em 16), git,
python3 e, para ler PDF, `pdftotext` (pacote `poppler-utils`).

```bash
git clone <repo> nivoo-ai-manager && cd nivoo-ai-manager
npm ci
createdb nivoo
cp .env.example apps/backend/.env  # ajuste DATABASE_URL e diretórios
npm run db:migrate                 # prisma migrate deploy
npm run build
npm run db:seed                    # cria o modelo padrão "Geral" (também ocorre ao subir a API)
```

## Operação

```bash
npm run dev:api      # API + interface em http://localhost:3000
npm run dev:worker   # worker (pode haver vários, compartilhando banco e diretórios)
npm run dev:web      # opcional: interface com recarga em http://localhost:5173
```

* **A execução não depende do navegador nem da API**: o worker lê a fila no PostgreSQL.
* **Reinício do worker**: tarefas têm *lease* (30 s, `NIVOO_LEASE_MS`). Se o worker morrer, outro (ou o
  mesmo reiniciado) retoma a etapa do último checkpoint.
* **A IA nunca conclui nada sozinha**: etapa só termina com a verificação passando; trabalho só fica
  pronto pelo verificador do backend, com evidência de cada critério (inclusive a conferência das regras).

### IAs que trabalham nos projetos

| Conector | Como conectar |
|---|---|
| `claude-code-cli` (Claude) | tela **Contas de IA** (login oficial `claude setup-token`) ou chave `ANTHROPIC_API_KEY` |
| `codex-cli` (ChatGPT) | tela **Contas de IA** (login oficial `codex login --device-auth`) ou chave de API OpenAI |
| `gemini-cli` (Gemini) | tela **Contas de IA** (login oficial com conta Google) ou chave `GEMINI_API_KEY` |
| `local-shell` | sempre disponível (executor de comandos, **não é IA**) |

O sistema **não** captura cookies, não extrai credenciais de navegador e não contorna limites. Se uma
IA estiver indisponível ou no limite de uso, o trabalho fica "aguardando recurso" e é reagendado.

### Segurança

* Cada projeto tem pasta própria (`NIVOO_WORKSPACES_ROOT/areas/<modelo>/projetos/<projeto>`): repositório
  git com a pasta principal (`main`), conhecimento do projeto e um *worktree* por trabalho.
* Processos das IAs recebem ambiente mínimo (sem `DATABASE_URL`); arquivos de configuração de agentes
  (`.claude/`, `CLAUDE.md`, `AGENTS.md`, `.gemini/`...) nunca são carregados como configuração.
* Credenciais conectadas pela tela ficam num arquivo com permissão 600 no servidor, nunca no git nem no banco.
* Ações destrutivas (`rm -r`, `git push --force`, `reset --hard`, `DROP`…) exigem aprovação explícita.
* `NIVOO_API_TOKEN` (opcional) protege a API com token Bearer.

## Testes

Banco de testes padrão: `postgresql://postgres:postgres@localhost:5432/nivoo_test` (altere com
`DATABASE_URL_TEST`; as migrações são aplicadas automaticamente).

```bash
createdb nivoo_test
npm test                                   # build + unitários e aceitação (sem IA)
node apps/web/e2e/chat-smoke.cjs           # fumaça da interface pelo navegador (IA simulada; instruções no arquivo)
# Provas com IA REAL (opt-in) — ver docs/PROCEDIMENTO-CLI.md
cd apps/backend && NIVOO_RUN_CLI_INTEGRATION=1 npx jest test/integration/real-0[1256]  # Claude Code
cd apps/backend && NIVOO_RUN_CODEX_INTEGRATION=1 npx jest test/integration/real-04     # Codex
```

| Assunto | Teste |
|---|---|
| Objetivo e etapas persistidos | `test/acceptance/02-objetivo-etapas.spec.ts` |
| Execução por conector, logs e artefatos | `test/acceptance/03-execucao-conector.spec.ts` |
| Interrupção e retomada | `test/acceptance/04-interrupcao-retomada.spec.ts` |
| Recuperação após reinício do worker | `test/acceptance/05-reinicio-worker.spec.ts` |
| Bloqueio de conclusão sem evidências | `test/acceptance/06-controle-conclusao.spec.ts` |
| Isolamento entre projetos | `test/acceptance/07-isolamento.spec.ts` |
| Funcionamento com navegador fechado | `test/acceptance/08-navegador-fechado.spec.ts` |
| Limite do provedor e sessões sem progresso (stub) | `test/acceptance/09-sessoes-simuladas.spec.ts` |
| Harness, orçamento de contexto, lições, orçamento, aprovação por hash | `test/acceptance/11-ideias-ecc.spec.ts` |
| Regressões da revisão independente | `test/acceptance/12-revisao-independente.spec.ts` |
| Modelos, fine-tune do projeto, trava, conversa, contas | `test/acceptance/13-modelos-projetos-conversa.spec.ts` |

Provas com IA real: `real-01` (classificação de término e isolamento), `real-02` (continuidade entre
sessões e queda de worker), `real-04` (Codex), `real-05` (hooks e `CLAUDE.md` plantados não têm efeito),
`real-06` (modelo com materiais + conversa + trabalho + trava com Claude). Evidências em `docs/evidencias/`.

Mocks: somente os binários `test/support/stubs/*.sh`, marcados **TEST-ONLY**. Eles não são apresentados
como integração funcional.
