# Operação — Nivoo AI Manager (Mercado V1)

## 1. Fluxo de trabalho típico

1. **Projeto** (Projetos e pesquisas → Novo projeto). A descrição vira a memória `ESPECIFICACAO`.
   É criado um workspace git isolado (`repo/` com `main`, `data/`, `worktrees/`).
2. **Dados**: copie os arquivos para `<workspace>/data/` e registre o dataset (ativo, papel
   `TREINO`/`VALIDACAO`/`RESERVADO`). "Validar" aplica as regras do ativo (WIN e WDO têm regras
   independentes: faixa de preço, múltiplo do tick, horário do pregão, OHLC, amplitude).
   Conjuntos `RESERVADO` ficam bloqueados para experimentos até uma aprovação de liberação.
3. **Pesquisa** vinculada a WIN e/ou WDO → **hipóteses** (memória `HIPOTESE_INVESTIGACAO`).
4. **Job** (aba Jobs): objetivo, etapas com dependências, critérios de aceitação verificáveis,
   limites (tentativas, tempo, orçamento), conector, e opcionalmente experimento (hipótese,
   dataset, parâmetros).
5. **Execução** (worker): cada etapa gera tentativas, logs, artefatos (`out/` do worktree) e
   checkpoints (commit na branch `job/<id>`).
6. **Conclusão**: quando todas as etapas terminam, o backend avalia cada critério e grava
   evidências. Só então o job pode virar `CONCLUIDO`. Critérios `MANUAL_APPROVAL` exigem
   aprovação explícita (Painel Mercado ou tela do job).
7. **Resultado**: experimento concluído recebe métricas (`metrics.json`) e commit; a memória
   recebe uma `EVIDENCIA` com referências. Uma hipótese só pode ser `VALIDADA` com experimentos
   verificados; vira `RESULTADO_VALIDADO` com dados, código, parâmetros e resultados referenciados.

## 2. Critérios de aceitação disponíveis

| Tipo | Configuração | Verificação |
|---|---|---|
| `COMMAND` | `{"command": "pytest -q", "expectExitCode": 0, "timeoutSec": 300}` | executa no worktree do job |
| `FILE_EXISTS` | `{"path": "src/estudo.py", "minBytes": 1}` | arquivo no worktree (com sha256) |
| `ARTIFACT_PRESENT` | `{"name": "relatorio.md"}` ou `{"pattern": "^graficos/.*\\.png$"}` | artefato registrado no job |
| `METRIC_THRESHOLD` | `{"artifact": "metrics.json", "path": "sharpe", "op": ">=", "value": 1}` | lê o artefato de métricas |
| `MANUAL_APPROVAL` | `{}` | exige aprovação explícita |

Sem critérios, o job **nunca** é concluído (`BLOQUEADO / SEM_CRITERIOS`).

## 3. Estados

| Estado | Significado | Ação típica |
|---|---|---|
| `PENDENTE` | criado, não iniciado | Iniciar |
| `EXECUTANDO` | worker processando | acompanhar |
| `AGUARDANDO_RECURSO` | conector indisponível/limite | aguarda reagendamento automático, ou Retomar |
| `AGUARDANDO_APROVACAO` | ação destrutiva ou critério subjetivo | aprovar/rejeitar |
| `BLOQUEADO` | `INTERROMPIDO`, `CRITERIOS_NAO_ATENDIDOS`, `SEM_CRITERIOS`, `REPETICAO_IMPRODUTIVA`, `LIMITE_TEMPO`, `LIMITE_ORCAMENTO`, `POLITICA`, `APROVACAO_REJEITADA` | corrigir (adicionar etapas/critérios, ajustar limites) e Retomar |
| `FALHOU` | etapa esgotou tentativas | ajustar limites/etapa e Retomar |
| `CONCLUIDO` | todos os critérios verificados com evidências | — |

O relatório `GET /api/projects/:pid/jobs/:jid/report` (e a tela do job) mostra o estado real e as
pendências.

## 4. Variáveis de ambiente (`apps/backend/.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL |
| `PORT` | 3000 | porta da API |
| `NIVOO_WORKSPACES_ROOT` | `./data/workspaces` | raiz autorizada dos workspaces |
| `NIVOO_ARTIFACTS_ROOT` | `./data/artifacts` | armazenamento de artefatos |
| `NIVOO_WORKER_ID` | `hostname-pid` | identificador do worker |
| `NIVOO_LEASE_MS` | 30000 | lease de tarefas (recuperação após queda) |
| `NIVOO_POLL_MS` | 1000 | intervalo de consulta da fila |
| `NIVOO_API_TOKEN` | — | se definido, exige `Authorization: Bearer` |
| `NIVOO_CLAUDE_BIN` / `NIVOO_CODEX_BIN` | `claude` / `codex` | caminho dos CLIs |
| `NIVOO_CLAUDE_ALLOWED_TOOLS` | vazio | regras extras **restritas a caminho** (ex.: `Edit(./src/**)`); regras genéricas como `Write` são recusadas porque liberariam escrita fora do workspace. Bash/WebFetch/WebSearch sempre negados |
| `NIVOO_PRECO_ENTRADA_USD_MTOK` / `NIVOO_PRECO_SAIDA_USD_MTOK` | 3 / 15 | preço por milhão de tokens usado só para ESTIMAR o custo de sessões encerradas à força (o CLI não informa o custo nesses casos) |
| `NIVOO_CONTEXT_MAX_CHARS` | 60000 | orçamento de contexto por sessão de IA (memória excedente fica em `.nivoo/memoria.md`) |
| `NIVOO_CLAUDE_MAX_TURNS` | — | limite de turnos por sessão (padrão; também por etapa em `providerOptions.maxTurns`) |
| `NIVOO_CLAUDE_MODEL` / `NIVOO_CODEX_MODEL` | — | modelo opcional |
| `NIVOO_PLANNER_PROVIDER` | `claude-code-cli` | IA que responde na conversa (chat) |
| `NIVOO_PLANNER_TIMEOUT_SEC` / `NIVOO_PLANNER_MAX_TURNS` | 300 / 25 | limites de cada resposta da conversa |
| `NIVOO_BODY_LIMIT` | `60mb` | tamanho máximo de uma requisição JSON (envio de pasta de padrões em lotes de até 25 MB) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | — | conector API opcional |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | — | conector API opcional |

API e worker devem compartilhar o mesmo banco **e** os mesmos diretórios de workspaces/artefatos
(mesmo host ou volume compartilhado).

## 5. Serviço (exemplo systemd)

```ini
# /etc/systemd/system/nivoo-worker.service
[Unit]
Description=Nivoo AI Manager worker
After=network-online.target postgresql.service

[Service]
User=nivoo
WorkingDirectory=/opt/nivoo-ai-manager/apps/backend
ExecStart=/usr/bin/node dist/worker.js
Restart=always
# Isolamento adicional em nível de SO
ProtectSystem=strict
ReadWritePaths=/opt/nivoo-ai-manager/data /home/nivoo/.claude /home/nivoo/.codex
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Crie um serviço análogo para a API (`dist/main.js`). `Restart=always` + lease garantem retomada
após quedas.

## 6. Limitações conhecidas da V1

* O isolamento do executor `local-shell` é por diretório de trabalho, ambiente mínimo e política;
  um comando pode, em tese, ler caminhos absolutos permitidos ao usuário do SO. Para isolamento
  forte, execute o worker com usuário dedicado/`ProtectSystem` (acima) ou em contêiner.
* A política de ações destrutivas/financeiras é baseada em padrões textuais: reduz riscos, mas não
  substitui o isolamento do SO. Agentes de IA também recebem as regras no prompt e o Claude Code
  roda sem a ferramenta Bash por padrão.
* O custo só é contabilizado quando o conector informa (Claude Code CLI informa `total_cost_usd`;
  APIs informam tokens).
* Encerramento de processos órfãos após queda funciona quando o novo worker está no mesmo host.
