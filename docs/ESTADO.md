# Estado do desenvolvimento (checkpoint para retomada)

> Atualizado em 2026-10-27. Branch: `claude/lucid-lamport-z7zup1` (a `main` não foi alterada).
> Auditoria que motivou esta etapa: `docs/AUDITORIA.md`. Procedimento dos executores reais:
> `docs/PROCEDIMENTO-CLI.md`. Evidências brutas: `docs/evidencias/2026-10-27/`.

## Etapa 3 — instalação em servidor Debian (2026-10-28)

Entregue: `deploy/install-debian.sh` (instalador idempotente, root, sem sudo), comando `deploy/nivoo`
(status, logs, check, login-claude, login-codex, set-claude-token, backup, restore, update, tunnel),
serviços systemd com usuário `nivoo` e isolamento, guia `docs/INSTALACAO-DEBIAN.md`.

| Verificação | Resultado |
|---|---|
| Instalação do zero (contêiner com systemd real, código em `/opt/nivoo/app`) | concluída em 1 min 27 s |
| Serviços rodam como `nivoo` (não root) | sim (`ps`: `nivoo … dist/main.js`, `nivoo … dist/worker.js`) |
| API escuta só em 127.0.0.1 | sim (`/proc/net/tcp`: `0100007F:0BB8`) |
| Interface servida pela API, links profundos | `<title>` ok; `/execucao` → 200 |
| `nivoo check` | serviços ativos, worker online, conectores reportados com verdade (Claude/Codex instalados, sem login) |
| Job de ponta a ponta sob isolamento systemd | CONCLUIDO; arquivos de propriedade de `nivoo`; checkpoint no git |
| Reinstalação por cima | idempotente: configuração e dados preservados |
| Reinício da máquina | api, worker e postgresql voltam sozinhos |
| Backup | banco + dados + configuração; arquivos com permissão 600 (corrigido: antes saíam 666) |
| Endurecimento do systemd (`systemd-analyze security nivoo-worker`) | 8.0 EXPOSED → **3.1 OK** |

Correções encontradas durante esta etapa (bugs reais do produto, não do teste):

* **Corrida na conclusão:** o job virava CONCLUIDO antes de o experimento receber métricas/commit e de
  a evidência entrar na memória; um `decide` nessa janela falhava. Agora tudo é gravado na mesma
  transação da conclusão. Reconfirmado com executor real: `docs/evidencias/2026-10-28/real-03-cientifico.json`
  (CONCLUIDO, H1 VALIDADA, H2 REJEITADA, pesquisa ENCERRADA, US$ 0,37).
* **Ordem na interrupção:** a etapa voltava a PENDENTE antes de o checkpoint ser gravado. Agora o
  checkpoint vem primeiro (teste 04: 10/10 execuções; suíte completa 3× seguidas: 53/53).

**Pendências precisas:**

1. **Não testado em Debian real.** A política de rede desta sessão bloqueia `deb.debian.org` e todos
   os espelhos do Debian (CONNECT 403). O teste foi feito em **Ubuntu 24.04** (derivado do Debian:
   mesmos pacotes, apt, systemd e PostgreSQL). Para testar em Debian 12/13 aqui, libere
   `deb.debian.org` e `security.debian.org` em *Allowed domains* do ambiente.
2. Clone via chave de deploy SSH (passo 1 do guia) não exercitado aqui (sem acesso SSH ao GitHub).
3. Sessão real de IA **dentro do serviço** systemd não testada (depende do seu `nivoo login-claude`);
   os binários `claude` e `codex` executam dentro do sandbox (versão e status de login conferidos).

## Etapa 2 — continuidade com executores reais

### Ambiente da prova real

| Item | Valor |
|---|---|
| Worker | processos `node dist/worker.js` no contêiner de desenvolvimento em nuvem (ADR-014) |
| Claude Code CLI | 2.1.311, login OAuth **oficial** já existente no host (`claude auth status` → `loggedIn: true`, `oauth_token`); modelo padrão da conta (`claude-sonnet-5-5` na sondagem) |
| Ambiente do agente | mínimo (sem `DATABASE_URL`, sem chaves), `--permission-mode acceptEdits`, sem regras genéricas, Bash/WebFetch/WebSearch negados |
| Codex CLI | 0.164.0 instalado, **sem login** → bloqueado |
| Banco | PostgreSQL 16 (`nivoo_test`) |

### 1. Comprovado com executor REAL (Claude Code CLI)

Todas as linhas abaixo saem de `docs/evidencias/2026-10-27/*.json`, extraídos do banco ao fim de cada
teste. Execução final sobre o código commitado: **5 testes reais passando** (custo total informado
pelo CLI: **US$ 1,15**).

| Prova | Teste | Evidência (sessões reais) | Resultado |
|---|---|---|---|
| Fim de sessão ≠ falha; continuação automática | `real-01` (a) | sessão `23bd34ba` termina por `max_turns` com progresso → `SESSAO_ENCERRADA`; o orquestrador abre sozinho a sessão `c815d99d` → verificação passa → `SUCESSO` | job **CONCLUIDO** pelo verificador; 0 comandos manuais |
| Falha real de execução | `real-01` (b) | sessão `e0739537`, `terminal_reason=api_error` (modelo inexistente) → `FALHA` | job **FALHOU / LIMITE_TENTATIVAS** (não `AGUARDANDO_RECURSO`) |
| Agente alega conclusão sem cumprir; tenta escrever fora do workspace | `real-01` (c) | sessões `a8e23503`, `204eebff` respondem "concluído"; permissão de escrita fora negada; verificação falha; sem mudança no trabalho | job **BLOQUEADO / REPETICAO_IMPRODUTIVA**; nunca CONCLUIDO; `arquivoForaDoWorkspaceExiste: false` |
| Continuidade entre várias sessões e queda de worker | `real-02` | etapa `funcoes`: sessão `3bacb200` (worker A, `max_turns`) → sessão #2 interrompida por **SIGKILL do worker A** → worker B: sessão `5bb240d2` (`max_turns`) → sessão `dd85d559` `SUCESSO`; etapa `resumo`: sessão `f27b9853` | job **CONCLUIDO**; 3 critérios aprovados; **0 comandos manuais de continuação** |
| Objetivo original íntegro | `real-02` | 1 única versão do objetivo (sha `6098e2abd7d6…`); **5/5 prompts** contêm o texto e o sha256 integrais | — |
| Notas, hipóteses e decisões preservadas sem resumo de conversa | `real-02` | **4/5 prompts** contêm notas de sessões anteriores (`autor agente:claude-code-cli:sessao:…`); a etapa `resumo` só passa citando `H-CONT-7Q` e `D-JAN-20`, que existem **apenas na memória do banco** (ver `real-02-prompt-ultima-sessao-funcoes.md`, linhas 33–36) | — |
| Ciclo científico completo, dados sintéticos | `real-03` | Claude escreve `src/experimento.py` (sessão `787d8e06`); o executor local roda; Claude escreve o relatório (sessão `191913c4`) | 4/4 critérios: **verificador de referência do operador**, **reprodutibilidade (`cmp`)**, relatório, métricas |
| Decisão por regra pré-registrada | `real-03` | métricas do experimento = referência (`taxa_reversao 0.8509`, `taxa_acerto_volume 0.5242`, 249 dias) | **H1 VALIDADA** (0.8509 ≥ 0.65), **H2 REJEITADA** (0.5242 < 0.65), conforme os efeitos plantados; pesquisa **ENCERRADA** só depois disso (antes: recusada, HTTP 400) |
| Relatório reproduzível rotulado | `real-03` | `real-03-relatorio.md` (aviso de DADOS SINTÉTICOS, sha256 do dataset, método, comando de reprodução) | — |

Achados que **só apareceram com o executor real** e foram corrigidos:

1. **Isolamento quebrado** — `--allowedTools Write` (padrão anterior do adaptador) liberava escrita em
   qualquer caminho: na 1ª execução o agente gravou fora do workspace e o job chegou a CONCLUIDO.
   Corrigido (ADR-017) e comprovado em `real-01` (c).
2. **Fim de sessão tratado como falha / conclusão** — corrigido com `SESSAO_ENCERRADA` (ADR-015).
3. **Notas como falso progresso** — o agente anotava "não consigo" a cada sessão e escapava da detecção
   de repetição (custo US$ 0,40 até o limite de sessões). Corrigido (ADR-018): agora bloqueia em 2
   sessões (US$ 0,18).
4. **Pré-registro contornável** — a regra de uma hipótese podia ser alterada após o início de um
   experimento não vinculado a ela. Corrigido (ADR-019).

### 2. Comprovado apenas com testes automatizados (sem IA) ou simulados

| Item | Teste | Natureza |
|---|---|---|
| Limite do provedor (usage limit) → `RECURSO_INDISPONIVEL` / `AGUARDANDO_RECURSO` | `acceptance/09` | **SIMULADO** (stub TEST-ONLY); o limite real não pode ser provocado de forma confiável |
| Sessões sem progresso → `REPETICAO_IMPRODUTIVA` | `acceptance/09` | SIMULADO (também comprovado com executor real em `real-01` c) |
| Etapa de IA sem `verifyCommand` é recusada | `acceptance/09` | automatizado |
| Pré-registro, decisão pela regra, verificador de referência, reprodutibilidade, notas → memória, encerramento de pesquisa | `acceptance/10` | automatizado, executor local, dados sintéticos |
| Parsing dos adaptadores Claude/Codex, regras de permissão | `unit/cli-adapters` | SIMULADO (stubs) |
| Mecânica de fila, lease, recuperação de órfãos, interrupção/retomada, navegador fechado, isolamento de rotas, limites, aprovações | `acceptance/01–08` | automatizado, executor local (V1) |

Suíte automatizada sobre o código final: **53 passando**, 6 pulados (os opt-in reais).

### 3. Permanece bloqueado

| Bloqueio | Causa precisa | O que é necessário |
|---|---|---|
| **Codex CLI — nenhuma execução real** | `codex login status` → "Not logged in" (`real-04-codex-status.json`); não há conta ChatGPT logada nem `OPENAI_API_KEY` neste host | No host do worker: `codex login` (ou `codex login --device-auth`, ou `printenv OPENAI_API_KEY \| codex login --with-api-key`) e rodar `NIVOO_RUN_CODEX_INTEGRATION=1 npx jest test/integration/real-04`. Os argumentos do adaptador foram conferidos com `codex exec --help` (0.164.0), mas o parsing do JSONL real **não foi verificado** |
| Limite real do provedor | não reproduzível sob demanda | observar em produção; o log do job registra `[limite do provedor]` (eventos `rate_limit_event` do stream-json) |
| Conectores de API (Anthropic/OpenAI) | sem chaves | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` no `.env` do host |
| Isolamento em nível de SO | o worker roda como root no contêiner; a proteção atual é do próprio Claude Code + detecção de alteração no diretório de dados | executar o worker com usuário dedicado/contêiner (`docs/OPERACAO.md §5–6`) |

### 4. Comandos para reproduzir

```bash
# preparação (uma vez)
createdb nivoo_test && npm ci && cp .env.example apps/backend/.env

# automatizados (sem IA) — 53 testes
npm test

# reais (Claude Code CLI logado no host do worker)
cd apps/backend && npm run build
NIVOO_RUN_CLI_INTEGRATION=1 NIVOO_EVIDENCE_DIR=$PWD/../../docs/evidencias/$(date +%F) npx jest test/integration/real-01
NIVOO_RUN_CLI_INTEGRATION=1 NIVOO_EVIDENCE_DIR=$PWD/../../docs/evidencias/$(date +%F) npx jest test/integration/real-02
NIVOO_RUN_CLI_INTEGRATION=1 NIVOO_EVIDENCE_DIR=$PWD/../../docs/evidencias/$(date +%F) npx jest test/integration/real-03

# Codex (falha com "BLOQUEIO:" enquanto não houver login)
NIVOO_RUN_CODEX_INTEGRATION=1 NIVOO_EVIDENCE_DIR=$PWD/../../docs/evidencias/$(date +%F) npx jest test/integration/real-04
```

Os testes reais dependem de um modelo não determinístico: uma reexecução pode usar um número
diferente de sessões. As asserções verificam propriedades (classificação, integridade, conclusão
pelo verificador), não a transcrição exata.

## Etapa 1 — V1 estrutural (concluída anteriormente)

| Critério V1 | Teste | Estado |
|---|---|---|
| Criação de projeto e pesquisa | `acceptance/01` | passa |
| Persistência do objetivo e das etapas | `acceptance/02` | passa |
| Execução por conector disponível | `acceptance/03` (executor local) + `integration/real-01..03` (**Claude Code real**) | passa |
| Registro de logs e artefatos | `acceptance/03`, `real-*` | passa |
| Interrupção e retomada | `acceptance/04` | passa |
| Recuperação após reinício do worker | `acceptance/05` + `real-02` (**com sessão de IA real**) | passa |
| Bloqueio de conclusão sem evidências | `acceptance/06` + `real-01` (c) (**agente real**) | passa |
| Isolamento entre projetos | `acceptance/07` + `real-01` (c) | passa |
| Funcionamento com navegador fechado | `acceptance/08` | passa |
| Documentação | `README.md`, `docs/OPERACAO.md`, `docs/PROCEDIMENTO-CLI.md` | feito |

## Próximos passos

1. Fazer o login oficial do Codex no host do worker e rodar `real-04` (único bloqueio da integração).
2. Rodar `real-01..03` no host de produção do worker (não só no contêiner de desenvolvimento).
3. Executar o worker com usuário de SO dedicado.
