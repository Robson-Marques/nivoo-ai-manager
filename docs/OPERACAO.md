# Operação — Nivoo AI Manager

## 1. Como usar (fluxo do usuário)

1. **Conectar uma IA** — menu **Conexões** → **+ Nova** → escolha o tipo (Claude, ChatGPT ou Gemini, pela
   conta ou por chave de API; também GitHub e GitLab) e dê um nome. Pela conta, o login começa na hora:
   abra o link, entre com a sua conta e cole o código (Claude, Gemini) ou digite o código mostrado no site
   (ChatGPT). Pode criar **quantas quiser do mesmo tipo** ("ChatGPT 1", "ChatGPT 2"…): cada uma tem o seu
   login/chave e nunca se misturam. Em cada linha: conectar/reconectar, chave, ★ padrão (IA dos projetos
   novos), renomear, desconectar e excluir (só se nenhum projeto a usa).
2. **Criar um modelo** (opcional) — menu **Modelos** → novo modelo a partir de um pronto (Geral, Software,
   Atendimento, Imagem e conteúdo, Vídeo). Escreva em "Como a IA deve funcionar neste modelo" o jeito de
   trabalhar (o texto é usado exatamente como você escreveu) ou importe de um PDF, Word ou texto. Envie os
   **materiais de referência** (arquivos ou uma pasta inteira). Ex.: modelo "Sistemas ERP / SaaS".
   O modelo **Software — Studio Workflow** já vem instalado: relatório de alinhamento no plano, doutrina
   de engenharia e especialidades no repositório do projeto.
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
11. **Anexos no chat** — no clipe ao lado da mensagem (ou colando com Ctrl+V, ou arrastando para a caixa
    de texto): imagens e fotos (a IA vê a imagem), PDF, Word, Excel, PowerPoint, LibreOffice (viram texto)
    e arquivos de texto/código; até 10 por mensagem, 10 MB cada. Se você pedir para usar um anexo no
    projeto (ex.: "coloque este logo no site"), o plano diz onde ele vai e o sistema copia o arquivo.
12. **Login recusado** — se a IA recusar o login (token expirado ou revogado), a conexão aparece como
    "Login recusado pela IA — reconecte" em **Conexões**; clique em conectar de novo. Enquanto isso, dá
    para continuar a conversa com outra IA. Token do Git vencido: ícone da chave na linha → "Trocar o token".
13. **Vídeos (Veo)** — crie em Conexões uma "Gemini — chave de API" (AI Studio, com cobrança ativada).
    Em Ajustes → Vídeos escolha o modelo Veo (a lista vem da sua chave). Peça na conversa ("vídeo vertical
    de 8 s do meu logo girando"); a IA propõe, você clica Fazer, e o `.mp4` aparece no chat e em Arquivos.
    Cobrança do Google por segundo de vídeo; o Nivoo estima e respeita o limite de gasto do projeto.
    O modelo pronto **"Vídeo com IA (Veo)"** já vem instalado: crie o projeto nele, conte a ideia (e mande uma
    imagem, se quiser); a IA confere o briefing, monta as cenas e gera um vídeo por cena.
14. **Trabalho até o fim e IA reserva** — trabalhos aprovados na conversa não têm limite de sessões nem de
    tempo. Em Ajustes → "Se a IA parar…", marque as IAs reserva (em ordem): sem crédito/limite, o trabalho
    continua sozinho na próxima, e a conversa avisa. Defina um limite de gasto se usar chaves de API.
15. **Acesso pela internet** — `nivoo dominio nivoo.suaempresa.com.br` (como root) publica o Nivoo num domínio
    seu pela Cloudflare (túnel, HTTPS, sem abrir portas) e liga o token; depois ligue o Cloudflare Access
    (login por e-mail) no painel da Cloudflare. Ver `docs/INSTALACAO-DEBIAN.md`, seção 3b.
16. **Git** — em **Contas**, seção Git, cadastre o GitHub ou o seu GitLab (endereço + token; GitHub: token
    com acesso a "Contents" de leitura e escrita; GitLab: escopos `read_repository` e `write_repository`).
    Pode cadastrar o GitHub e o GitLab ao mesmo tempo (e mais de uma conta de cada). Para **criar**
    repositórios, o token precisa dessa permissão (GitHub: "Administration" de escrita ou token clássico
    com `repo`; GitLab: escopo `api`).
    No "+ Novo projeto": **Do zero + repositório novo** cria o repositório na conta e no grupo escolhidos
    e mantém atualizado; **Trazer de um repositório Git** baixa um projeto que você já tem, escolhendo da
    lista dos seus repositórios (ou digitando o endereço).
    Para mudar um projeto de servidor (ex.: do GitHub para o GitLab): aba **Git** → "mudar para outro
    repositório" — cria o novo, envia todo o histórico e passa a usá-lo; o antigo fica como está. Na aba **Git**
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
| `NIVOO_VEO_USD_POR_SEGUNDO` / `NIVOO_VEO_USD_POR_SEGUNDO_RAPIDO` | 0.40 / 0.15 | estimativa de custo por segundo de vídeo (modelos normais / fast); ajuste conforme a tabela do Google |
| `NIVOO_OMNI_USD_POR_SEGUNDO` | 0.10 | estimativa por segundo do Gemini Omni Flash (o vídeo atual do Google; o Veo foi desligado na API do Gemini) |
| `NIVOO_GEMINI_API_BASE` | `https://generativelanguage.googleapis.com` | endereço da API do Gemini (vídeo) |
| `NIVOO_CF_ACCESS_TEAM` / `NIVOO_CF_ACCESS_AUD` | — | login da Cloudflare como entrada (gravados por `nivoo dominio acesso`) |
| `NIVOO_CONEXOES_FILE` | `<pasta acima de NIVOO_WORKSPACES_ROOT>/conexoes.json` | lista das conexões de IA (nome, tipo, padrão; permissão 600) |
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
| `NIVOO_PLANNER_TIMEOUT_SEC` / `NIVOO_PLANNER_MAX_TURNS` | 900 / 25 | limites de cada resposta do chat (a conversa usa a IA escolhida no projeto) |
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
* ChatGPT e Gemini (API) não foram testados com conta real neste desenvolvimento (só com stub). O Gemini
  pela conta Google foi removido: o Google encerrou o Gemini CLI com conta pessoal.
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
