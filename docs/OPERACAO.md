# Operação — Nivoo AI Manager

## 1. Como usar (fluxo do usuário)

1. **Conectar uma IA** — menu **Contas de IA**: escolha Claude, ChatGPT ou Gemini e clique em
   "Conectar". Abra o link, entre com a sua conta e cole o código (Claude, Gemini) ou digite o código
   mostrado no site (ChatGPT). Também dá para usar uma chave de API (cobrança à parte, pelo provedor).
2. **Criar um modelo** (opcional) — menu **Modelos** → novo modelo a partir de um pronto (Geral, Software,
   Atendimento, Imagem e conteúdo, Vídeo). Escreva em "Como a IA deve funcionar neste modelo" o jeito de
   trabalhar (o texto é usado exatamente como você escreveu) ou importe de um PDF, Word ou texto. Envie os
   **materiais de referência** (arquivos ou uma pasta inteira). Ex.: modelo "Sistemas ERP / SaaS".
3. **Criar o projeto** — "+ Novo projeto": nome, sobre o que é (vira a primeira memória), modelo e a IA
   que vai trabalhar nele.
4. **Ajustar o projeto** (aba **Ajustes**) — regras do projeto (também com importação de PDF/Word/texto),
   conhecimento do projeto (manuais, especificações, cardápios...), IA escolhida, limite de gasto e
   "Excluir projeto". Isto é o "fine-tune do projeto": vai em toda conversa e todo trabalho.
5. **Conversar** — peça o que precisa. A IA responde ou propõe um plano no cartão **"Posso fazer isto"**.
   Pedidos fora do escopo do projeto são recusados com explicação.
6. **Fazer** — o plano vira um trabalho. O andamento aparece no chat (Trabalhando… / Preciso da sua
   confirmação / Parei + Tentar de novo).
7. **Conferência** — no fim, uma IA separada confere as mudanças contra as regras do modelo e do projeto
   (a trava). Se ela apontar violação, o trabalho não fica pronto.
8. **Pronto** — o resultado entra na pasta principal do projeto (aba **Arquivos**) e o próximo trabalho
   parte dele. O que foi combinado na conversa aparece em **O que o projeto lembra** (dá para "esquecer").
9. **Várias conversas** — dentro do projeto, "+ Nova conversa" abre uma conversa limpa (sem o histórico
   longo das outras), mas a IA continua sabendo tudo do projeto: memória, regras, conhecimento e arquivos.
   A conversa ganha como nome o começo da primeira mensagem. No "⋯" de cada conversa: **Renomear**,
   **Arquivar** (sai da lista; fica em "conversas arquivadas", e para continuar nela é só desarquivar) e
   **Excluir** (apaga as mensagens; o que o projeto aprendeu continua). Projetos também podem ser
   **arquivados** em Ajustes (ficam em "projetos arquivados", na lateral).
10. **Documentos viram texto** — tudo que você envia como material do modelo ou conhecimento do projeto
    fica guardado como texto: PDF (inclusive escaneado), Word, PowerPoint, Excel e LibreOffice viram
    `<nome>.txt` e o original não é guardado. Formato antigo (.doc, .xls, .ppt) ou arquivo ilegível
    não entra, e a tela diz o motivo (salve como PDF ou no formato novo).
11. **Git** — em **Contas**, seção Git, cadastre o GitHub ou o seu GitLab (endereço + token; GitHub: token
    com acesso a "Contents" de leitura e escrita; GitLab: escopos `read_repository` e `write_repository`).
    No "+ Novo projeto", **Trazer de um repositório Git** baixa um projeto que você já tem. Na aba **Git**
    do projeto: **Atualizar do Git**, **Enviar para o Git** (com versão/tag opcional) e o envio
    automático depois de cada trabalho pronto. Cada trabalho vira um commit com mensagem legível.

## 2. Critérios de aceitação (para quem usa a API)

| Tipo | Configuração | Verificação |
|---|---|---|
| `COMMAND` | `{"command": "pytest -q", "expectExitCode": 0, "timeoutSec": 300}` | executa no worktree do trabalho |
| `FILE_EXISTS` | `{"path": "src/app.py", "minBytes": 1}` | arquivo no worktree (com sha256) |
| `ARTIFACT_PRESENT` | `{"name": "relatorio.md"}` ou `{"pattern": "^graficos/.*\\.png$"}` | artefato registrado no trabalho |
| `METRIC_THRESHOLD` | `{"artifact": "metrics.json", "path": "cobertura", "op": ">=", "value": 80}` | lê um artefato JSON |
| `MANUAL_APPROVAL` | `{}` | exige aprovação explícita ("Preciso da sua confirmação") |

Sem critérios, o trabalho **nunca** é concluído (`BLOQUEADO / SEM_CRITERIOS`). Trabalhos com IA sempre
ganham o critério `conferencia-regras`.

## 3. Estados

| Estado | Significado | Ação típica |
|---|---|---|
| `PENDENTE` | criado, não iniciado | Iniciar |
| `EXECUTANDO` | worker processando | acompanhar |
| `AGUARDANDO_RECURSO` | IA indisponível ou no limite | reagendamento automático, ou Tentar de novo |
| `AGUARDANDO_APROVACAO` | ação destrutiva ou critério subjetivo | aprovar/rejeitar |
| `BLOQUEADO` | `INTERROMPIDO`, `CRITERIOS_NAO_ATENDIDOS`, `SEM_CRITERIOS`, `REPETICAO_IMPRODUTIVA`, `LIMITE_TEMPO`, `LIMITE_ORCAMENTO`, `LIMITE_ORCAMENTO_PROJETO`, `LIMITE_SESSOES`, `POLITICA`, `APROVACAO_REJEITADA`, `CONFLITO_INCORPORACAO` | corrigir e Tentar de novo |
| `FALHOU` | etapa esgotou tentativas | ajustar e Tentar de novo |
| `CONCLUIDO` | todos os critérios verificados com evidências e incorporado à pasta principal | — |

`GET /api/projects/:pid/jobs/:jid/report` mostra o estado real e as pendências.

## 4. Variáveis de ambiente (`apps/backend/.env`; no servidor, `/etc/nivoo/nivoo.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL |
| `HOST` / `PORT` | `0.0.0.0` / 3000 (instalador: `127.0.0.1`) | endereço e porta da API |
| `NIVOO_WORKSPACES_ROOT` | `./data/workspaces` | raiz autorizada (modelos, projetos, worktrees) |
| `NIVOO_ARTIFACTS_ROOT` | `./data/artifacts` | armazenamento de artefatos |
| `NIVOO_GIT_ACCOUNTS_FILE` | `<pasta acima de NIVOO_WORKSPACES_ROOT>/git-contas.json` | contas Git e tokens (permissão 600) |
| `NIVOO_SECRETS_FILE` | `<pasta acima de NIVOO_WORKSPACES_ROOT>/segredos.json` | credenciais conectadas pela tela (permissão 600) |
| `NIVOO_WORKER_ID` | `hostname-pid` | identificador do worker |
| `NIVOO_LEASE_MS` | 30000 | lease de tarefas (recuperação após queda) |
| `NIVOO_POLL_MS` | 1000 | intervalo de consulta da fila |
| `NIVOO_API_TOKEN` | — | se definido, exige `Authorization: Bearer` |
| `NIVOO_BODY_LIMIT` | `60mb` | tamanho máximo de uma requisição JSON (envio de materiais em lotes) |
| `NIVOO_CLAUDE_BIN` / `NIVOO_CODEX_BIN` / `NIVOO_GEMINI_BIN` | `claude` / `codex` / `gemini` | caminho dos CLIs |
| `NIVOO_CLAUDE_MODEL` / `NIVOO_CODEX_MODEL` / `NIVOO_GEMINI_MODEL` | — | modelo opcional de cada IA |
| `NIVOO_CLAUDE_MAX_TURNS` | — | limite de turnos por sessão do Claude (também por etapa em `providerOptions.maxTurns`) |
| `NIVOO_CLAUDE_ALLOWED_TOOLS` | vazio | regras extras **restritas a caminho** (ex.: `Edit(./src/**)`); regras genéricas são recusadas. Bash/WebFetch/WebSearch sempre negados |
| `NIVOO_PLANNER_TIMEOUT_SEC` / `NIVOO_PLANNER_MAX_TURNS` | 300 / 25 | limites de cada resposta do chat (a conversa usa a IA escolhida no projeto) |
| `NIVOO_CONTEXT_MAX_CHARS` | 60000 | orçamento de contexto por sessão (memória excedente fica em `.nivoo/memoria.md`) |
| `NIVOO_PRECO_ENTRADA_USD_MTOK` / `NIVOO_PRECO_SAIDA_USD_MTOK` | 3 / 15 | preço por milhão de tokens, só para ESTIMAR o custo de sessões encerradas à força |
| `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | — | opcionais; se definidas, têm prioridade sobre o que foi conectado pela tela (a tela mostra "configurado pelo administrador") |

API e worker precisam compartilhar o mesmo banco, os mesmos diretórios **e** o mesmo usuário de SO /
HOME (o login do Codex fica em `~/.codex` e o do Gemini em `~/.gemini`).

## 5. Serviço

O instalador (`deploy/install-debian.sh`) cria `nivoo-api` e `nivoo-worker` no systemd, com usuário
`nivoo`, `HOME=/var/lib/nivoo`, sistema de arquivos somente leitura exceto `/var/lib/nivoo`, `/tmp`
privado e `NoNewPrivileges`. `Restart=always` + lease garantem retomada após quedas. Ver
`docs/INSTALACAO-DEBIAN.md`.

## 6. Limitações conhecidas

* "Fine-tune do projeto" é contexto, não treino: a IA recebe regras e materiais em toda sessão e a
  conferência cobra o resultado, mas um modelo de IA ainda pode errar; a trava reduz, não elimina.
* Gemini e Codex não foram testados com conta real neste desenvolvimento (só com stub).
* O Codex e o Gemini recebem o perfil do projeto só no prompt (o Claude também como instrução de sistema).
* Geração de imagem/vídeo de verdade exige um conector próprio; hoje a IA entrega texto, briefing,
  prompts e peças em SVG/HTML.
* O login pela tela fica na memória da API: se a API reiniciar no meio, recomece o login.
* OCR de PDF escaneado depende da qualidade da digitalização; confira o `.txt` gerado (aba de materiais/conhecimento). Imagens soltas (PNG, JPG) entram como imagem, sem OCR.
* O isolamento do executor `local-shell` é por diretório, ambiente mínimo e política; para isolamento
  forte, use o serviço instalado (usuário dedicado + systemd) ou contêiner.
* A política de ações destrutivas é por padrões de texto: reduz riscos, mas não substitui o isolamento do SO.
* O custo só é contabilizado quando a IA informa (o Claude Code informa `total_cost_usd`; nos demais
  casos é estimado pelos tokens, quando há).
* Encerramento de processos órfãos após queda funciona quando o novo worker está no mesmo host.
