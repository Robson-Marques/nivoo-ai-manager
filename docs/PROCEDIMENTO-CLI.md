# Procedimento — executores reais (Claude Code CLI e Codex CLI)

Somente mecanismos **oficiais** de autenticação. O Nivoo nunca lê, copia ou extrai credenciais:
ele apenas invoca o binário oficial no host do worker, com ambiente mínimo.

## 1. Preparar o host do worker

```bash
# Node 22+, git, python3, PostgreSQL acessível
npm i -g @anthropic-ai/claude-code      # Claude Code CLI
npm i -g @openai/codex                  # Codex CLI (testado: 0.164.0)
```

### Claude Code — login oficial (uma das opções)

```bash
claude                      # login interativo (conta Claude) — uma vez, no usuário do worker
# ou, para servidores sem navegador:
claude setup-token          # gera token oficial; exporte CLAUDE_CODE_OAUTH_TOKEN no serviço do worker
claude auth status          # deve mostrar "loggedIn": true
```

### Codex — login oficial (uma das opções)

```bash
codex login                                  # login com conta ChatGPT (abre navegador)
codex login --device-auth                    # servidores sem navegador: código de dispositivo
printenv OPENAI_API_KEY | codex login --with-api-key   # chave de API OpenAI
codex login status                           # deve terminar com exit 0 ("Logged in")
```

## 2. Verificar no Nivoo

```bash
curl -s -X POST localhost:3000/api/providers/claude-code-cli/check | jq '{available,authenticated,version,errors}'
curl -s -X POST localhost:3000/api/providers/codex-cli/check       | jq '{available,authenticated,version,errors}'
```

## 3. Rodar as provas reais

Banco de testes `nivoo_test` (criado uma vez com `createdb nivoo_test`). Cada suíte sobe processos
worker reais (`dist/worker.js`) que chamam os CLIs.

```bash
cd apps/backend && npm run build
export NIVOO_EVIDENCE_DIR=$PWD/../../docs/evidencias/$(date +%F)   # opcional: exporta evidências JSON

NIVOO_RUN_CLI_INTEGRATION=1   npx jest test/integration/real-01   # término: fim de sessão, falha, alegação falsa + isolamento
NIVOO_RUN_CLI_INTEGRATION=1   npx jest test/integration/real-02   # continuidade: várias sessões + queda de worker
NIVOO_RUN_CLI_INTEGRATION=1   npx jest test/integration/real-03   # ciclo científico com dados sintéticos
NIVOO_RUN_CODEX_INTEGRATION=1 npx jest test/integration/real-04   # Codex (falha com "BLOQUEIO" se não houver login)
```

Custo observado com Claude Code (modelo padrão da conta, 2026-10-27): real-01 ≈ US$ 0,35;
real-02 ≈ US$ 0,35; real-03 ≈ US$ 0,40 (valores informados pelo próprio CLI).

## 4. Interpretação

* Uma suíte real que falha com `BLOQUEIO:` indica conector indisponível no host — não é sucesso.
* As evidências (`docs/evidencias/<data>/*.json`) são extraídas do banco após cada teste: sessões
  (`session_id` do provedor, motivo de término, turnos, custo, worker), prompts recebidos (hash e
  checagem de objetivo íntegro), critérios com evidências, artefatos com sha256, memória.
