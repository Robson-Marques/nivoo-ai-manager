# Procedimento — IAs reais (Claude Code, Codex e Gemini CLI)

Somente mecanismos **oficiais** de autenticação. O Nivoo nunca lê cookies nem extrai credenciais do
navegador: ele conduz o login oficial de cada CLI e invoca o binário oficial com ambiente mínimo.

## 1. Preparar o host

O instalador Debian já faz isto. Manualmente:

```bash
# Node 22+, git, python3, poppler-utils, PostgreSQL acessível
npm i -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli
```

API e worker devem rodar com o **mesmo usuário e HOME** (os logins do Codex e do Gemini ficam no HOME).

## 2. Conectar pela tela (caminho principal)

Menu **Contas de IA** → "Conectar" na IA desejada:

| IA | Comando oficial conduzido pela tela | Resultado |
|---|---|---|
| Claude | `claude setup-token` — mostra link; você cola o código | token oficial guardado como `CLAUDE_CODE_OAUTH_TOKEN` em `segredos.json` (permissão 600) |
| ChatGPT | `codex login --device-auth` — mostra link e código do usuário | login guardado pelo próprio Codex em `~/.codex` |
| Gemini | sem login pela tela: só chave de API (o Google encerrou o login com conta pessoal) | chave em `segredos.json` |

Os CLIs exigem terminal; uma ponte Python com pseudo-terminal (pty) faz a ponte com a tela
(`apps/backend/src/accounts/login-sessions.service.ts`). O login expira em 15 minutos.

Chave de API (alternativa, cobrança à parte): `ANTHROPIC_API_KEY` (Claude) e `GEMINI_API_KEY` (Gemini)
vão para `segredos.json`; a chave OpenAI é entregue a `codex login --with-api-key`. Variáveis de
ambiente de mesmo nome têm prioridade sobre o arquivo.

> Estado honesto: só o Claude foi executado com conta real. Codex e Gemini foram testados apenas com stub.

## 3. Conectar pelo terminal (alternativa)

No servidor instalado:

```bash
nivoo login-claude       # login interativo do Claude Code (digite /exit ao terminar)
nivoo set-claude-token   # grava um token de 'claude setup-token' em /etc/nivoo/nivoo.env
nivoo login-codex        # codex login --device-auth
```

Os três reiniciam a API e o worker. Em desenvolvimento, os comandos oficiais diretos:

```bash
claude setup-token                                   # depois exporte CLAUDE_CODE_OAUTH_TOKEN
claude auth status                                   # "loggedIn": true
codex login --device-auth                            # ou: printenv OPENAI_API_KEY | codex login --with-api-key
codex login status                                   # exit 0 ("Logged in")
```

## 4. Verificar no Nivoo

```bash
curl -s localhost:3000/api/accounts | jq '.[] | {id, conectado, problema}'
curl -s -X POST localhost:3000/api/providers/gemini-api/check | jq '{available,authenticated,version,errors}'
```

## 5. Rodar as provas reais

Banco de testes `nivoo_test` (criado uma vez com `createdb nivoo_test`). Cada suíte sobe processos
worker reais (`dist/worker.js`) que chamam os CLIs.

```bash
cd apps/backend && npm run build
export NIVOO_EVIDENCE_DIR=$PWD/../../docs/evidencias/$(date +%F)   # opcional: exporta evidências JSON

NIVOO_RUN_CLI_INTEGRATION=1   npx jest test/integration/real-01   # término: fim de sessão, falha, alegação falsa + isolamento
NIVOO_RUN_CLI_INTEGRATION=1   npx jest test/integration/real-02   # continuidade: várias sessões + queda de worker
NIVOO_RUN_CLI_INTEGRATION=1   npx jest test/integration/real-05   # hooks e CLAUDE.md plantados não têm efeito
NIVOO_RUN_CLI_INTEGRATION=1   npx jest test/integration/real-06   # modelo com materiais + conversa + trabalho + trava
NIVOO_RUN_CODEX_INTEGRATION=1 npx jest test/integration/real-04   # Codex (falha com "BLOQUEIO" se não houver login)
```

Ainda não existe prova real para o Gemini.

Custos observados com Claude Code (informados pelo CLI): `real-01` ≈ US$ 0,35; `real-02` ≈ US$ 0,35;
`real-06` ≈ US$ 0,31 (antes da trava; com a conferência das regras há uma sessão a mais).

## 6. Interpretação

* Uma suíte real que falha com `BLOQUEIO:` indica conector indisponível no host — não é sucesso.
* As evidências (`docs/evidencias/<data>/*.json`) são extraídas do banco após cada teste: sessões
  (`session_id`, motivo de término, turnos, custo, worker), prompts recebidos, critérios com evidências,
  artefatos com sha256, memória.
