# Estado do desenvolvimento (checkpoint para retomada)

> Atualizado em 2026-11-14. Código na `main` (histórico de desenvolvimento da branch `claude/lucid-lamport-z7zup1` incorporado).
> Auditoria que motivou esta etapa: `docs/AUDITORIA.md`. Procedimento dos executores reais:
> `docs/PROCEDIMENTO-CLI.md`. Evidências brutas: `docs/evidencias/2026-10-27/`.

## Etapa 7 — chat simples, modelos com pasta de padrões e memória automática (2026-11-14)

**Pedido:** o sistema estava complexo demais para o usuário final. Agora a tela inicial é um **chat**:
projetos na lateral (agrupados por modelo), "+ Novo projeto" (nome, sobre o que é, tipo), conversa,
proposta "Posso fazer isto" com botão **Fazer**, andamento em linguagem simples (Trabalhando / Pronto /
Preciso da sua confirmação / Parei + Tentar de novo) e painel lateral **O que o projeto lembra** (com
"esquecer") e **Arquivos** da pasta principal. As telas antigas continuam em **Modo avançado**.

**Modelos (áreas).** Mercado é o modelo pronto; há Web, Imagem, Vídeo e Geral, e o usuário cria os seus.
Tela **Modelos**: regras editáveis (versionadas) e **Enviar pasta de padrões** — a pasta inteira (ex.:
um fluxo de criação de software com padrões e identidade visual) vira a base do modelo, num commit git.
Todo projeto do modelo recebe essa base em cada conversa e trabalho. Arquivos de agente da pasta
(`.claude/`, `CLAUDE.md`, `AGENTS.md`) chegam renomeados (`_claude/`, `_CLAUDE.md`): a IA os lê como
padrões, mas o executor não os carrega como configuração (sem hooks).

**Continuidade.** Cada trabalho concluído entra na pasta principal (`main`) do projeto; o próximo parte
dela. O que o usuário diz na conversa (decisões, preferências, fatos, pendências) vira memória do projeto
automaticamente, sem duplicar, e entra em todas as próximas conversas e trabalhos.

**Prova com Claude real** (`test/integration/real-06`, evidência em `docs/evidencias/2026-11-14/`):
modelo "Pizzaria" com pasta de padrões (regra da casa com o código CASA-PZ-9137 + um `CLAUDE.md`) →
pedido no chat → a IA leu a base, propôs plano com critérios verificáveis e um critério subjetivo
("o usuário aprova o tom") e guardou na memória "o público são as famílias do bairro" → aprovado →
Claude Code escreveu a legenda terminando com o código da casa → verificador aprovou → incorporado à
pasta principal → na pergunta seguinte a IA citou o arquivo criado e o público lembrado. Custo total
≈ US$ 0,31 (conversa 0,11 + 0,06; trabalho 0,14).

**Testes:** suíte automatizada 81/81 (nova `acceptance/13`, 9 casos); interface do chat e dos modelos
pelo navegador (`apps/web/e2e/chat-smoke.cjs`, IA simulada); interface avançada no servidor instalado
(`ui-smoke.cjs`, todos os passos).

**Debian (real, com systemd):**

| Verificação | Resultado |
|---|---|
| Debian 12: instala a `main` anterior, cria dados, `nivoo update` para esta versão | **falhou e foi corrigido** (abaixo); depois: projetos preservados e migrados para o modelo Mercado, job novo em projeto antigo concluído e incorporado, conversa responde "IA indisponível" com orientação, tela inicial ok |
| Debian 13: instalação do zero | 57 s; job de ponta a ponta e `nivoo verificar` ok; interface avançada 100% |

**Problemas reais encontrados nesta etapa:**

* `nivoo update` quebrava a instalação (antigo, não detectado antes porque os testes rodavam o
  instalador direto): o comando usa `umask 077` (backups privados) e o instalador herdava; dependências,
  compilação e CLIs ficavam ilegíveis para o serviço → a API não subia. Corrigido (umask 022 no
  instalador + reparo de permissões em servidores já afetados).
* O seed, rodando como root, criava a pasta do modelo Mercado como root → API sem permissão. Corrigido.
* Painel lateral não atualizava quando um trabalho terminava; memória da conversa não aceitava o campo
  `texto` (só `conteudo`). Corrigidos.

**Se o seu servidor já rodou `nivoo update` e a API não sobe:** copie a versão nova para `/opt/nivoo/app`
e rode `bash /opt/nivoo/app/deploy/install-debian.sh` (repara as permissões).

**Continua pendente:** Codex sem login (nenhuma execução real); geração de imagens/vídeo de verdade
exige um conector de imagem/vídeo (hoje a IA entrega textos, briefings, prompts, SVG/HTML); a pasta do
seu computador (ex.: `STUDIO-WORKFLOW`) precisa ser enviada pela tela Modelos — esta sessão de
desenvolvimento não tem acesso ao seu PC.

## Etapa 6 — revisão independente (2026-11-02)

Ver `docs/REVISAO-2026-11-02.md`: 10 problemas confirmados e corrigidos (3 de segurança/integridade:
link simbólico em `dados/`, hash de dataset substituído em silêncio, sessões paralelas na retomada;
e `nivoo restore`, que não funcionava). Cada um tem teste de regressão que falha no código antigo.
Suíte: 72 passando. Claude real: `real-01` e `real-05` passando. Debian 12 real: atualização de uma
instalação existente (migração + dados preservados) e restauração de backup verificadas.

## Etapa 5 — telas completas, Debian real e incorporação à main (2026-11-02)

**Telas.** Todos os recursos agora aparecem na interface: regra pré-registrada e "Decidir pela regra",
"Encerrar pesquisa" com pendências, aba Configurações do projeto (orçamento com gasto acumulado e
critérios permanentes), tabela de sessões de IA (sessão do provedor, término, turnos, orçamento de
contexto, link para o prompt exato, custo, notas), lições e notas do agente na memória, campos de
turnos por sessão e limite de sessões no formulário de job.

**Teste de interface ponta a ponta** (`apps/web/e2e/ui-smoke.cjs`, Playwright, sem chamar a API
diretamente): painel → orçamento e critério permanente → pesquisa e hipótese com regra → encerramento
prematuro recusado → job pelo formulário → CONCLUÍDO com critério permanente aplicado, sessões, logs e
artefatos → hipótese VALIDADA pela regra → pesquisa ENCERRADA → resultado na memória → conectores.

**Instalador em Debian real** (máquinas limpas com systemd; código em `/opt/nivoo/app`; como root):

| Verificação | Debian 12.15 (PostgreSQL 15, Python 3.11) | Debian 13.7 (PostgreSQL 17, Python 3.13) |
|---|---|---|
| Instalação do zero | 1 min 10 s | 1 min 37 s |
| Serviços como `nivoo` (não root) | sim | sim |
| `systemd-analyze security nivoo-worker` | 3.1 OK | 3.1 OK |
| `nivoo check` (API, worker, conectores com status real) | ok | ok |
| Job de ponta a ponta (executor local) | CONCLUIDO, checkpoint git | CONCLUIDO, checkpoint git |
| Teste de interface completo no servidor instalado | 6/6 passos | 6/6 passos |
| Reinstalação por cima (idempotente) | config e dados preservados | — |
| Reinício da máquina | serviços voltam, dados preservados | serviços voltam |
| Backup | permissão 600 | — |

**Problemas reais encontrados e corrigidos nesta etapa:**

* Memória contraditória: ao decidir uma hipótese, a entrada "em investigação" continuava vigente ao
  lado do resultado; sessões de IA receberiam as duas. Agora é substituída pela decisão
  (teste em `acceptance/10`).
* Tela de memória mostrava "(0)" em todas as categorias enquanto carregava.
* Instalador: versão do npm não aparecia no passo 2 (cosmético) e saída excessiva do apt.

Suíte automatizada: 63 passando. Provas com Claude real: inalteradas desde 2026-10-31 (6/6), pois o
adaptador de IA não mudou.

**Continua pendente:** Codex sem login (nenhuma execução real); sessão de IA real **dentro** do serviço
instalado depende do `nivoo login-claude` no seu servidor; clone por chave de deploy SSH não exercitado
aqui.

## Etapa 4 — ideias do ECC incorporadas (2026-10-31)

Detalhes e justificativas: `docs/AVALIACAO-ECC.md`. Evidências: `docs/evidencias/2026-10-31/`.

| Item | Prova | Natureza |
|---|---|---|
| **Brecha fechada**: hook plantado em `.claude/settings.json` executava shell (contornando Bash negado) e `CLAUDE.md` injetava instruções ocultas | antes: hook executou e o agente obedeceu à regra oculta; depois: `real-05-harness.json` → `hookExecutou: false`, `respostaSeguiuInstrucaoOculta: false`, arquivo pedido criado | **Claude real** |
| Limpeza de arquivos de harness no workspace | `acceptance/11` | automatizado (stub) |
| Orçamento de contexto + memória completa em `.nivoo/memoria.md` | `unit/context-builder`, `acceptance/11` | automatizado |
| Lições de falha por projeto (não vazam para outros projetos) | `acceptance/06`, `acceptance/11` | automatizado |
| Critérios permanentes do projeto | `acceptance/11` | automatizado |
| Orçamento de custo do projeto | `acceptance/11` (custo anterior simulado no banco) | automatizado |
| Aprovação presa ao hash do conteúdo | `acceptance/11` (adulteração simulada no banco) | automatizado |
| Regressão das provas reais com `--restricted` | `real-01` (3 testes), `real-02`, `real-03`, `real-05`: **6/6 passando** | **Claude real** |

Suíte automatizada: **63 passando** (2 execuções seguidas), 7 opt-in reais pulados.
Correção adicional: ordem dos critérios de um job agora é determinística.
Codex: argumento `-c project_doc_max_bytes=0` adicionado, **não testado** (Codex continua sem login).

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

1. ~~Não testado em Debian real~~ — **resolvido em 2026-11-02**: testado em Debian 12 e 13 reais (ver Etapa 5).
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
