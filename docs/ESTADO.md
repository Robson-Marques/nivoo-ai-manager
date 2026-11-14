# Estado do desenvolvimento (checkpoint para retomada)

> Atualizado em 2026-11-14. Código na `main`. Procedimento das IAs reais: `docs/PROCEDIMENTO-CLI.md`.
> Evidências brutas: `docs/evidencias/<data>/`.

## Etapa 8 — modelos, fine-tune do projeto, trava e contas de IA pela tela (2026-11-14)

**Pedido do responsável:** um sistema simples, com o chat na frente, que sirva para qualquer assunto;
remover **por completo** tudo o que era do Mercado (não só esconder); nada de JSON nem configuração
técnica na tela.

### 1. Mercado removido por completo

Saíram: módulo de mercado (ativos WIN/WDO, datasets, pesquisas, hipóteses, experimentos, "Painel
Mercado"), critérios permanentes do projeto, conectores por API HTTP (`anthropic-api`, `openai-api`),
a política de operações financeiras (era específica de trading), a pasta `data/` de datasets e
`NIVOO_DATA_DIR`, as telas avançadas (Painel, Projetos e pesquisas, Execução, JobDetalhe, Conectores) e
o "Modo avançado". A memória agora tem 5 categorias: ESPECIFICACAO, ARQUITETURA_RESTRICOES,
DECISAO_APROVADA, EVIDENCIA, PENDENCIA.

A migração `apps/backend/prisma/migrations/20261114180000_bases_sem_mercado/migration.sql` preserva os
dados: projetos do antigo modelo Mercado passam para o modelo "Geral"; memórias de hipótese viram
PENDENCIA e resultados validados viram EVIDENCIA; aprovações de liberação de dataset são apagadas.

### 2. Modelos

Um **modelo** (no banco, `Area`; na API, `/areas`) é o jeito de trabalhar de um tipo de projeto. Modelos
prontos (`apps/backend/src/areas/area-templates.ts`): **Geral** (padrão, criado sozinho), **Software**,
**Atendimento**, **Imagem e conteúdo** e **Vídeo**. Cada modelo tem:

* **"Como a IA deve funcionar"** — texto livre, versionado. O texto que o usuário escreve é usado
  **exatamente** como está (sem texto, vale o do modelo pronto).
* **Materiais de referência** — pasta versionada em git (`WORKSPACES_ROOT/areas/<slug>/base`), enviada
  como arquivos ou pasta inteira.

O usuário cria os seus modelos (ex.: "Sistemas ERP / SaaS") a partir de um pronto; eles aparecem em
"Novo projeto".

### 3. Fine-tune do projeto

Não é fine-tuning do modelo de IA: é um contexto persistente, por projeto, que prende qualquer IA ao
projeto. É composto por:

* regras do modelo + **regras do projeto** (novas, versionadas: `ProjectRule`, `POST /projects/:pid/rules`);
* **conhecimento do projeto** (pasta git `<projeto>/conhecimento`, API `/projects/:pid/knowledge/*`);
* memória automática da conversa;
* a **IA escolhida** para o projeto (`Project.provider`: `claude-code-cli`, `codex-cli` ou `gemini-cli`).

`apps/backend/src/projects/project-profile.service.ts` monta o "perfil do projeto", que vai no topo de
todo prompt (conversa, trabalho e conferência) e, no Claude, também como `--append-system-prompt`. Em
cada sessão, a IA recebe cópias de leitura em `contexto/base` e `contexto/conhecimento` (fora do git;
arquivos de agente como `.claude/`, `CLAUDE.md`, `AGENTS.md` aparecem com `_` no início: legíveis, mas
inertes).

### 4. A trava (conferência das regras)

`apps/backend/src/jobs/rule-review.ts`: todo trabalho com etapa de IA ganha uma etapa final automática
`conferencia-regras`, feita por **outra sessão de IA**, que recebe as mudanças em relação à pasta
principal (`WorkspaceService.diffAgainstMain`), pode corrigir violações e precisa gravar
`out/conferencia-regras.json` com `{"conforme": true|false, "violacoes": [...]}`. Um critério COMMAND
confere o arquivo: o trabalho só fica CONCLUIDO se `conforme` for `true` e não houver violações. Pela API
ela só é dispensada com `conferencia: false`; o chat nunca dispensa. O prompt do chat
(`worker/planner.service.ts`) manda a IA recusar pedidos fora do escopo do projeto.

### 5. PDF e Word viram texto

`POST /api/extract-text` converte PDF (`pdftotext`, pacote `poppler-utils`, agora instalado pelo
`deploy/install-debian.sh`) e `.docx` em texto — usado pelo botão "Importar de PDF, Word ou texto" dos
editores de regras. PDF/DOCX enviados como material ou conhecimento ganham uma cópia `.txt` ao lado
(`common/text-extract.ts`, `common/knowledge-upload.ts`).

### 6. Contas de IA pela tela

`apps/backend/src/accounts/*`. Claude, ChatGPT (Codex CLI) e Gemini (Gemini CLI, novo conector
`providers/gemini-cli.provider.ts`) são conectados **pelo navegador**, usando o login oficial de cada CLI
(conduzido por uma ponte Python com pseudo-terminal):

| IA | Fluxo oficial | Onde fica a credencial |
|---|---|---|
| Claude | `claude setup-token`: link + colar o código | token salvo como `CLAUDE_CODE_OAUTH_TOKEN` no arquivo de segredos |
| ChatGPT | `codex login --device-auth`: link + código do usuário | login do próprio Codex (`~/.codex`) |
| Gemini | login interativo com `NO_BROWSER`: link + colar o código | `~/.gemini/oauth_creds.json` (gravado pelo CLI) |

Chaves de API opcionais: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` e chave OpenAI (via
`codex login --with-api-key`). Segredos ficam em `<pasta acima de NIVOO_WORKSPACES_ROOT>/segredos.json`,
permissão 600 (no servidor: `/var/lib/nivoo/data/segredos.json`), nunca no git nem no banco; variáveis
de ambiente de mesmo nome têm prioridade. Os comandos `nivoo login-claude`, `nivoo set-claude-token` e
`nivoo login-codex` continuam como alternativa. O instalador agora instala o Gemini CLI.

**Honestidade:** Gemini e Codex **não** foram executados com uma conta real neste ambiente. O fluxo de
login do Gemini e o formato da saída `stream-json` do Gemini CLI foram implementados pela documentação e
testados só com stub.

### 7. Interface nova

`apps/web/src`: `Layout.tsx` (lateral com projetos agrupados por modelo, "+ Novo projeto", links Modelos
e Contas de IA), `pages/Projeto.tsx` (chat, cartão "Posso fazer isto" + **Fazer**, andamento, painel com
as abas "O que o projeto lembra", "Arquivos" e "Ajustes"), `pages/Ajustes.tsx` (regras do projeto com
"Importar de PDF, Word ou texto", envio de arquivos/pasta de conhecimento, IA escolhida, limite de gasto,
"Excluir projeto"), `pages/Modelos.tsx`, `pages/Contas.tsx`, `pages/NovoProjeto.tsx` (nome, sobre,
modelo, IA), `pages/Inicio.tsx`. Rotas: `/`, `/p/:pid`, `/modelos`, `/contas`.

### 8. Outras mudanças na API

`PATCH /projects/:pid` (`name`, `description`, `provider`, `maxCostUsd`) substitui
`PATCH /projects/:pid/budget`; `POST /projects` aceita `name`, `description`, `base`, `provider`, `rules`,
`author`; novo `DELETE /projects/:pid` (apaga registros, pasta e artefatos do projeto; 409 se houver
trabalho em andamento ou a IA ainda estiver respondendo); `PATCH /areas/:area` (`name`, `description`).
Removidos: `PUT /areas/:area/base/file`, `POST /areas/:area/base/from-artifact`, `/invariants`,
`/dashboard` e as rotas de mercado. Limite do corpo JSON: `NIVOO_BODY_LIMIT` (60mb) em `app-setup.ts`.
`nivoo verificar` agora exclui o projeto de teste no fim.

### 9. Problemas reais corrigidos nesta etapa

* `nivoo update` deixava a instalação ilegível para o serviço (herdava `umask 077`): o instalador agora
  força `umask 022` e repara as permissões de instalações já afetadas.
* O seed, rodando como root, criava dados de propriedade do root: o instalador agora faz `chown` de `data/`.
* `nivoo set-claude-token`, `nivoo login-claude` e `nivoo login-codex` agora reiniciam API e worker
  (antes o token novo só valia depois de um reinício manual).

**Se o seu servidor já rodou `nivoo update` e a API não sobe:** copie a versão nova para `/opt/nivoo/app`
e rode `bash /opt/nivoo/app/deploy/install-debian.sh` (repara as permissões).

### Resultados dos testes

<!-- RESULTADOS-TESTES -->

### Continua pendente

* Codex e Gemini sem execução real com conta (só stub).
* Geração de imagem/vídeo de verdade exige um conector próprio; hoje a IA entrega textos, briefings,
  prompts e peças em SVG/HTML.
* Sessões de login pela tela ficam na memória do processo da API: um reinício da API no meio do login
  obriga a recomeçar.

---

## Etapas anteriores (resumo; o que foi provado continua valendo para o motor)

As etapas 1 a 7 foram feitas quando o produto ainda era o "Mercado V1". O motor (fila, execução
durável, sessões de IA, verificador, isolamento) é o mesmo; as provas específicas do Mercado
(datasets, hipóteses, regra pré-registrada, `real-03`, `acceptance/01` e `acceptance/10`) são
**históricas**: o código e os testes foram removidos em 2026-11-14.

### Etapa 7 — chat simples, modelos e memória automática (2026-11-14)

Chat como tela inicial, modelos com pasta de padrões, pasta principal (`main`) que acumula o trabalho,
memória automática da conversa. **Prova com Claude real** (`real-06`, `docs/evidencias/2026-11-14/`):
modelo "Pizzaria" com materiais (regra com o código CASA-PZ-9137 + um `CLAUDE.md`) → pedido no chat →
plano com critérios → aprovado → Claude escreveu a legenda com o código da casa → verificador aprovou →
incorporado à pasta principal → na pergunta seguinte a IA citou o arquivo e o público lembrado. Custo
≈ US$ 0,31. Debian 12 (atualização de instalação existente) e 13 (do zero) verificados com systemd real;
encontrados e corrigidos o problema do `umask` no `nivoo update` e o seed como root.

### Etapa 6 — revisão independente (2026-11-02)

`docs/REVISAO-2026-11-02.md`: 10 problemas confirmados e corrigidos, cada um com teste de regressão
(`acceptance/12`). Os itens #4 e #5 (dataset e hipótese) eram do Mercado e saíram com ele.

### Etapa 5 — telas completas e Debian real (2026-11-02)

Instalador testado em máquinas Debian 12.15 e 13.7 limpas com systemd: instalação em 1–2 min, serviços
como usuário `nivoo`, `systemd-analyze security nivoo-worker` = **3.1 OK**, job de ponta a ponta
CONCLUIDO, reinstalação idempotente, reinício da máquina, backup com permissão 600. (As telas desta etapa
— Painel Mercado e afins — foram removidas.)

### Etapa 4 — ideias do ECC (2026-10-31)

`docs/AVALIACAO-ECC.md`. **Com Claude real:** brecha fechada — hook plantado em `.claude/settings.json`
executava shell e `CLAUDE.md` injetava instruções ocultas; depois da correção (`--restricted`, limpeza de
harness) `real-05` → `hookExecutou: false`, `respostaSeguiuInstrucaoOculta: false`. Automatizado:
limpeza de harness, orçamento de contexto, lições de falha por projeto, orçamento de custo do projeto,
aprovação presa ao hash (`acceptance/11`). Critérios permanentes também eram desta etapa (removidos em
2026-11-14).

### Etapa 3 — instalação em servidor Debian (2026-10-28)

`deploy/install-debian.sh`, comando `deploy/nivoo`, serviços systemd com usuário `nivoo`. Corrigidos:
corrida na conclusão (conclusão e evidência na mesma transação) e ordem na interrupção (checkpoint antes
de liberar a etapa).

### Etapa 2 — continuidade com executores reais (2026-10-27)

Worker no contêiner de desenvolvimento (ADR-014), Claude Code CLI com login oficial. Provas **com Claude
real** (`docs/evidencias/2026-10-27/`), que continuam valendo:

| Prova | Teste | Resultado |
|---|---|---|
| Fim de sessão ≠ falha; continuação automática | `real-01` (a) | sessão termina por `max_turns` → `SESSAO_ENCERRADA` → nova sessão sozinha → verificação passa → CONCLUIDO, 0 comandos manuais |
| Falha real de execução | `real-01` (b) | `api_error` (modelo inexistente) → FALHOU / LIMITE_TENTATIVAS, não AGUARDANDO_RECURSO |
| Agente alega conclusão e tenta escrever fora do workspace | `real-01` (c) | escrita fora negada; BLOQUEADO / REPETICAO_IMPRODUTIVA; nunca CONCLUIDO |
| Continuidade entre várias sessões e SIGKILL do worker | `real-02` | worker B retoma; CONCLUIDO; objetivo íntegro em 5/5 prompts; notas e decisões só no banco chegaram à sessão final |
| Ciclo científico com dados sintéticos | `real-03` | **histórico** (Mercado; teste removido) |

Achados que só apareceram com o executor real e foram corrigidos: `--allowedTools Write` liberava escrita
fora do workspace (ADR-017); fim de sessão tratado como falha (ADR-015); notas como falso progresso
(ADR-018).

Simulado/automatizado (sem IA): limite do provedor e sessões sem progresso (`acceptance/09`, stub);
parsing dos adaptadores (`unit/cli-adapters`, stubs); fila, lease, recuperação, interrupção/retomada,
navegador fechado, isolamento (`acceptance/02–08`).

### Etapa 1 — V1 estrutural

Objetivo e etapas persistidos, execução por conector, logs e artefatos, interrupção e retomada,
recuperação após reinício do worker, bloqueio de conclusão sem evidências, isolamento entre projetos,
funcionamento com navegador fechado (`acceptance/02–08`).

## Próximos passos

1. Conectar ChatGPT e Gemini com contas reais pela tela Contas de IA e rodar `real-04` (Codex); criar uma
   prova real equivalente para o Gemini.
2. Rodar `real-01`, `real-02`, `real-05` e `real-06` com o serviço instalado no servidor de produção.
