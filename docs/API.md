# Referência da API

Base: `http://<host>:<porta>/api` (no servidor instalado: `http://127.0.0.1:3000/api`, via túnel SSH).
Corpo e respostas em JSON (limite do corpo: `NIVOO_BODY_LIMIT`, padrão 60mb). Se `NIVOO_API_TOKEN`
estiver definido, envie `Authorization: Bearer <token>` (para SSE e download de artefatos, use
`?token=<token>`). Rotas com `:pid` só enxergam recursos daquele projeto: um id de outro projeto responde 404.

Na interface, "modelo" = `Area` no banco e `/areas` na API.

## Sistema e conectores

| Método | Rota | Função |
|---|---|---|
| GET | `/health` | Saúde da API e do banco (não exige token). |
| GET | `/system/workers` | Workers e último sinal (`online`). |
| GET | `/system/config` | Diretórios e configuração não secreta. |
| GET | `/providers` | Conectores (`claude-code-cli`, `claude-api`, `codex-cli`, `codex-api`, `gemini-api`, `gemini-video`, `arquivos-projeto`, `local-shell`): status visto pela API e por cada worker. |
| POST | `/providers/:id/check` | Verifica um conector agora. |
| PATCH | `/providers/:id` | `{ "enabled": false }` desabilita; segredos são recusados. |
| POST | `/extract-text` | `{ "name", "contentBase64" }` → `{ "texto" }`. PDF (`pdftotext`; escaneado por OCR com `tesseract`), Word `.docx`, PowerPoint `.pptx`, Excel `.xlsx`, LibreOffice `.odt`/`.odp`/`.ods` ou texto; até 10 MB; nada é gravado. Formatos antigos (`.doc`, `.xls`, `.ppt`, `.rtf`) → 400 pedindo PDF ou formato novo. |

## Conexões de IA

Quantas conexões quiser de cada tipo (`claude-code-cli`, `claude-api`, `codex-cli`, `codex-api`,
`gemini-api`). `:id` = id da conexão: a primeira de cada tipo tem o próprio tipo como id (configuração padrão
do serviço); as seguintes são `<tipo>--<8 hex>`, com credencial e pasta próprias (`~/.nivoo-ia/<id>`).
O `provider` de um projeto é o id da conexão.

| Método | Rota | Função |
|---|---|---|
| GET | `/accounts` | Conexões: `id`, `tipo`, `ia`, `modo` (`conta` \| `api`), `nome`, `padrao`, `instalado`, `conectado`, `problema`, `loginRecusado` (a IA recusou o login numa sessão real: token expirado/revogado; some ao reconectar), `projetos` (quantos usam), `configuradoPeloAdministrador` e o login em andamento. `?atualizar=1` confere todas agora. Na primeira vez, as contas já conectadas (ou em uso) viram conexões com os nomes de antes. |
| GET | `/accounts/tipos` | Tipos para "+ Nova" (`tipo`, `ia`, `modo`, `nomePadrao`, `conta`/`ondeChave`). |
| POST | `/accounts` | `{ "tipo", "nome"? }` — cria a conexão (nome automático "ChatGPT 2"... se omitido; nome repetido → 409). A primeira criada vira padrão. |
| PATCH | `/accounts/:id` | `{ "nome"?, "padrao"?: true }` — renomear e/ou usar como padrão (IA dos projetos novos sem IA escolhida). |
| DELETE | `/accounts/:id` | Exclui a conexão (desconecta, apaga credencial e pasta própria). 409 se algum projeto a usa. |
| POST | `/accounts/:id/disconnect` | Desconecta (logout / apaga a chave) mantendo a conexão na lista. |
| GET | `/accounts/:id/models` | Modelos da IA, lidos do programa oficial (Claude: aliases fable/opus/sonnet; ChatGPT: `codex debug models`; Gemini: `gemini --list-models`); cache de 1 h. |
| POST | `/accounts/:id/login` | Inicia o login oficial do CLI nesta conexão. Devolve `{ state, url?, userCode?, message }`. |
| GET | `/accounts/:id/login` | Estado do login: `iniciando`, `aguardando_codigo` (Claude, Gemini), `aguardando_site` (ChatGPT), `conectado`, `erro`, `cancelado`. 404 se não houver login em andamento. |
| POST | `/accounts/:id/login/code` | `{ "code" }` — código colado pelo usuário (Claude e Gemini). 409 se o login não estiver esperando código. |
| DELETE | `/accounts/:id/login` | Cancela o login em andamento. |
| POST | `/accounts/:id/key` | `{ "key" }` — chave de API desta conexão: Anthropic (Claude), Google AI Studio (Gemini), OpenAI via `codex login --with-api-key` (ChatGPT). |

Lista de conexões em `conexoes.json`; credenciais em `segredos.json` (permissão 600) ou nos arquivos do próprio CLI; nunca no banco.

## Modelos

| Método | Rota | Função |
|---|---|---|
| GET | `/areas` | Lista os modelos (com contagem de projetos). |
| GET | `/areas/templates` | Modelos prontos: `geral`, `software`, `atendimento`, `imagem`, `video`. |
| POST | `/areas` | `{ "name", "template"?, "instructions"?, "description"?, "slug"?, "author"? }` — cria o modelo e a pasta de materiais (git). `instructions` é usado exatamente como enviado; sem ele, vale o texto do modelo pronto. |
| GET | `/areas/:area` | Detalhe: versões do texto "Como a IA deve funcionar", projetos, materiais e histórico. |
| PATCH | `/areas/:area` | `{ "name"?, "description"? }`. |
| POST | `/areas/:area/instructions` | `{ "text", "reason"?, "author"? }` — nova versão do texto (a anterior fica no histórico). |
| GET | `/areas/:area/base/file?path=` | Lê um material (servido em sandbox). |
| DELETE | `/areas/:area/base/file?path=&author=` | Remove um material (commit). |
| POST | `/areas/:area/base/import` | `{ "files": [{ "path", "contentBase64" }], "message"?, "author"? }` — envia arquivos ou uma pasta inteira num commit. Ignora `node_modules`, `.git`, `__pycache__`, `.venv`, arquivos de sistema e arquivos > 10 MB (listados em `ignorados`); até 3000 arquivos. **Documentos (PDF, Office, LibreOffice) são guardados só como texto**: `manual.pdf` → `manual.txt` (ou `manual.pdf.txt` se `manual.txt` vier no mesmo envio); o original não é gravado. Resposta: `{ importados, bytes, convertidos: [{de, para}], ignorados (com o motivo; inclui documento ilegível ou formato antigo), commit }`. |

## Projetos

| Método | Rota | Função |
|---|---|---|
| GET | `/projects` | Lista projetos ativos (com o modelo); `?arquivados=1` lista os arquivados. |
| POST | `/projects` | `{ "name", "description"?, "base"? (slug do modelo; padrão `geral`), "provider"? (id de uma conexão de IA; padrão: a conexão padrão), "rules"?, "author"? }`. A descrição vira memória ESPECIFICACAO; `rules` vira a versão 1 das regras do projeto. |
| GET | `/projects/:pid` | Projeto com regras vigentes, arquivos de conhecimento e `custoGastoUsd` (trabalhos + conversa). |
| PATCH | `/projects/:pid` | `{ "name"?, "description"?, "provider"?, "model"? (modelo da IA do projeto; `null` = padrão; guardado por IA em `aiModels`), "modeloDe"? (guardar o modelo de outro conector, ex.: `gemini-video`), "reserva"? (lista ordenada de conexões de IA reserva), "maxCostUsd"? (número ou `null`), "archived"? (true/false) }`. |
| DELETE | `/projects/:pid` | Exclui o projeto: para antes os trabalhos e respostas em andamento (espera até 20 s as sessões encerrarem) e apaga registros, pasta e artefatos. |
| POST | `/projects/:pid/rules` | `{ "text", "reason"?, "author"? }` — nova versão das regras do projeto. |
| GET | `/projects/:pid/rules/history` | Todas as versões das regras. |
| POST | `/projects/:pid/knowledge/import` | Mesmo formato de `/areas/:area/base/import`, para o conhecimento do projeto. |
| GET | `/projects/:pid/knowledge/file?path=` | Lê um arquivo do conhecimento (sandbox). |
| DELETE | `/projects/:pid/knowledge/file?path=&by=` | Remove um arquivo do conhecimento (commit). |
| GET | `/projects/:pid/files` | Arquivos da pasta principal (`main`). |
| GET | `/projects/:pid/files/content?path=` | Conteúdo de um arquivo da pasta principal (sandbox). |

## Git (GitHub e GitLab próprio)

Tokens ficam em `git-contas.json` (600) no servidor; nenhuma rota devolve o token.

| Método | Rota | Função |
|---|---|---|
| GET | `/git/accounts` | Contas Git (sem token). |
| POST | `/git/accounts` | `{ "tipo": "github" \| "gitlab", "host"? (GitLab próprio, ex.: `https://git.empresa.com.br`), "token", "nome"?, "usuario"?, "autorNome"?, "autorEmail"?, "verificar"? (padrão true: confere o token na API do servidor) }`. |
| DELETE | `/git/accounts/:id` | Remove a conta. |
| PATCH | `/git/accounts/:id` | `{ "nome"?, "token"? }` — renomear e/ou trocar o token (conferido antes de salvar; os projetos ligados continuam ligados). |
| POST | `/git/accounts/:id/testar` | Confere agora se o token vale (`{ ok, usuario }`). |
| GET | `/git/accounts/:id/repos?busca=` | Repositórios da conta (mais recentes primeiro): `[{ nome, url, branch, privado }]`. |
| GET | `/git/accounts/:id/namespaces` | Onde a conta pode criar repositórios: `[{ id, nome, tipo: "usuario" \| "grupo" }]` (GitHub: usuário e organizações; GitLab: usuário e grupos). |
| POST | `/projects/:pid/git/create` | `{ "accountId", "namespace"?, "tipoNamespace"? ("usuario" \| "grupo"), "nome"? (padrão: nome do projeto), "privado"? (padrão true), "autoEnvio"? (padrão true) }` — cria o repositório vazio na conta, liga o projeto, envia tudo e liga o envio automático. Projeto já ligado: passa a usar o novo (mudar de servidor, com todo o histórico; o antigo não é alterado). Nome já usado → 409. |
| GET | `/projects/:pid/git` | `{ ligado, url, branch, conta, autoEnvio, enviar, receber, remotoVazio, erro, commits[] }` (faz `fetch`). |
| POST | `/projects/:pid/git/link` | `{ "url", "branch"?, "accountId"? }` — liga um projeto existente a um repositório (vazio ou com o mesmo histórico). |
| DELETE | `/projects/:pid/git` | Desliga do repositório (nada é apagado). |
| PATCH | `/projects/:pid/git` | `{ "autoEnvio": true \| false }` — versionamento automático (padrão ligado): a cada trabalho concluído que mudou arquivos, tag da próxima versão + push (com pull antes, se o repositório andou). |
| POST | `/projects/:pid/git/pull` | Atualiza a pasta principal com o repositório; conflito → 409 e nada muda. |
| POST | `/projects/:pid/git/push` | `{ "tag"?, "mensagem"? }` — envia a pasta principal para a branch; tag anotada opcional. Repositório à frente → 409 (atualize antes). |

`POST /projects` também aceita `"git": { "url", "branch"?, "accountId"? }` para criar o projeto a partir de
um repositório existente.

## Memória do projeto

Categorias: `ESPECIFICACAO`, `ARQUITETURA_RESTRICOES`, `DECISAO_APROVADA`, `EVIDENCIA`, `PENDENCIA`.

| Método | Rota | Função |
|---|---|---|
| GET | `/projects/:pid/memory` | `?category=` filtra; `?all=1` inclui versões substituídas. |
| POST | `/projects/:pid/memory` | `{ "category", "title", "content", "references"?, "author"? }` — EVIDENCIA exige `references.artifactIds` e `references.gitCommit`. |
| POST | `/projects/:pid/memory/:mid/supersede` | Nova versão de uma entrada (a anterior fica no histórico). |
| DELETE | `/projects/:pid/memory/:mid?by=nome` | "Esquecer": a entrada deixa de valer (fica no histórico como substituída). |

## Conversa (chat)

| Método | Rota | Função |
|---|---|---|
| GET / POST | `/projects/:pid/conversations` | Lista as conversas ativas (`?arquivadas=1` para as arquivadas) / cria conversa `{ "title"? }` (sem título: "Nova conversa", que vira o começo da primeira mensagem). Todas compartilham memória, regras, conhecimento e arquivos do projeto; o histórico enviado à IA é só o da conversa. |
| PATCH | `/projects/:pid/conversations/:cid` | `{ "title"?, "archived"? }` — renomear / arquivar / desarquivar. Conversa arquivada não recebe mensagens (409). |
| DELETE | `/projects/:pid/conversations/:cid` | Exclui a conversa (mensagens); para antes a resposta em andamento. Memória, arquivos e trabalhos do projeto continuam. |
| POST | `/projects/:pid/conversations/:cid/cancel` | Para a resposta em andamento ("Pensando…"). |
| GET | `/projects/:pid/conversations/:cid` | Conversa com as mensagens (`status`: PENDENTE, PRONTA, ERRO; `kind`: resposta, plano, sistema, erro). |
| POST | `/projects/:pid/conversations/:cid/messages` | `{ "content", "anexos"?: [{ "nome", "contentBase64" }] }` — enfileira a resposta da IA do projeto (409 se ainda houver uma pendente). Até 10 anexos de 10 MB: imagens (PNG, JPG, GIF, WEBP) ficam como imagem; PDF/Office/LibreOffice viram texto (`<nome>.txt`, com `de`); texto e código como estão; outro tipo ou formato antigo → 400. Com anexos, `content` pode ser vazio. A mensagem guarda `attachments: [{ nome, tipo, bytes, de? }]`. |
| GET | `/projects/:pid/conversations/:cid/messages/:mid/anexos/:nome` | Abre um anexo (imagem com o tipo certo; o resto como texto; sandbox). |
| POST | `/projects/:pid/conversations/:cid/messages/:mid/approve` | `{ "decidedBy", "start"? }` — o "Fazer": transforma o plano em trabalho (sempre com a conferência das regras) e inicia. Se o plano tem `anexosNoProjeto: [{ anexo: "contexto/anexos/<msg>/<arquivo>", para }]`, o sistema copia esses anexos da conversa para a pasta do trabalho antes de começar. 400 sem `decidedBy`; 409 se já aprovado. |

## Trabalhos (jobs)

| Método | Rota | Função |
|---|---|---|
| GET | `/jobs` | Todos os jobs (`?status=BLOQUEADO`). |
| GET / POST | `/projects/:pid/jobs` | Lista / cria (exemplo abaixo). |
| GET | `/projects/:pid/jobs/:jid` | Job completo: objetivos, etapas, tentativas, critérios com evidência, checkpoints, artefatos, aprovações e `ultimaAtividade` ({mensagem, em}: última linha do log, para a tela mostrar o andamento). |
| GET | `/projects/:pid/jobs/:jid/report` | Estado real e pendências (o que falta para concluir). |
| POST | `/projects/:pid/jobs/:jid/start` | PENDENTE → EXECUTANDO. |
| POST | `/projects/:pid/jobs/:jid/interrupt` | `{ "by"? }` — interrompe (BLOQUEADO/INTERROMPIDO), preservando o estado. |
| POST | `/projects/:pid/jobs/:jid/resume` | `{ "by"? }` — retoma do último checkpoint. |
| POST | `/projects/:pid/jobs/:jid/evaluate` | Pede nova verificação dos critérios (nunca conclui diretamente). |
| POST | `/projects/:pid/jobs/:jid/objective` | `{ "text", "reason" }` — nova versão do objetivo (a anterior é preservada). |
| POST | `/projects/:pid/jobs/:jid/steps` | `{ "steps": [...] }` — adiciona etapas (a conferência das regras passa a cobri-las). |
| POST | `/projects/:pid/jobs/:jid/criteria` | `{ "criteria": [...] }` — adiciona critérios. |
| PATCH | `/projects/:pid/jobs/:jid/limits` | Altera limites (tentativas, tempo, custo, sessões). |
| GET | `/projects/:pid/jobs/:jid/logs` | Logs (`?after=<id>` para incremental). |
| GET (SSE) | `/projects/:pid/jobs/:jid/events` | Tempo real: eventos `state` e `logs`. |
| GET | `/projects/:pid/artifacts` | Artefatos (`?jobId=`). |
| GET | `/projects/:pid/artifacts/:aid` | Download (cabeçalho `X-Content-SHA256`; servido em sandbox). |

## Aprovações

| Método | Rota | Função |
|---|---|---|
| GET | `/approvals` | `?status=PENDENTE&projectId=` |
| POST | `/approvals/:id/decide` | `{ "decision": "APROVADO"\|"REJEITADO", "decidedBy": "nome", "reason" }` — vale só para o conteúdo aprovado (hash). |

## Exemplo: criar um trabalho com etapa de IA

```json
POST /api/projects/<pid>/jobs
{
  "title": "Página de contato",
  "objective": "Criar contato.html com formulário de nome, e-mail e mensagem, seguindo o padrão visual do projeto.",
  "defaultProvider": "claude-code-cli",
  "limits": { "maxAttemptsPerStep": 3, "maxSessionsPerStep": 6, "maxDurationSec": 3600, "maxCostUsd": 5, "stepTimeoutSec": 600 },
  "steps": [
    { "key": "pagina", "instructions": "Escreva contato.html ...",
      "verifyCommand": "test -s contato.html && grep -q '<form' contato.html",
      "providerOptions": { "maxTurns": 20 } }
  ],
  "criteria": [
    { "key": "arquivo", "description": "página criada", "kind": "FILE_EXISTS", "config": { "path": "contato.html", "minBytes": 100 } },
    { "key": "aprovacao", "description": "o usuário aprova o visual", "kind": "MANUAL_APPROVAL", "config": {} }
  ]
}
```

O sistema acrescenta sozinho a etapa `conferencia-regras` e o critério de mesmo nome (a trava). Para
dispensá-la, só pela API: `"conferencia": false` no corpo.

Regras de validação na criação: etapas de IA exigem `verifyCommand`; a chave `conferencia-regras` é
reservada; dependências precisam existir e não formar ciclo; ações destrutivas passam a exigir aprovação.

## Ferramentas MCP

| Método | Rota | O que faz |
|---|---|---|
| GET | `/mcp` | `{ ferramentas, prontos }`: ferramentas cadastradas (segredos só como `{nome, definido}`) e modelos prontos. |
| POST | `/mcp` | Cria: `{ nome, tipo: 'comando'|'http', comando, args, url, variaveis {K:v}, segredos {K:valor}, cabecalhos {Nome:valor}, projetos: 'todos'|[ids], ativo }`. |
| PATCH | `/mcp/:id` | Edita (segredo vazio = mantém; `null` = apaga). |
| DELETE | `/mcp/:id` | Exclui (e os segredos dela). |
| POST | `/mcp/:id/testar` | Liga e lista as ferramentas: `{ ok, ferramentas: [{nome, descricao}], erro? }`. |

## Servidores SSH e pedidos de comando

| Método | Rota | O que faz |
|---|---|---|
| GET/POST | `/ssh/servidores` | Lista / cria `{ nome, host, porta, usuario, projetos }` (gera a chave; devolve `chavePublica`). |
| PATCH/DELETE | `/ssh/servidores/:id` | Edita / exclui (apaga a chave). |
| POST | `/ssh/servidores/:id/testar` | Teste do usuário: `{ ok, saida, dica? }`. |
| POST | `/ssh/servidores/:id/nova-chave` | Gera outra chave (troque no servidor). |
| GET | `/projects/:pid/ssh/pedidos?status=PENDENTE` | Pedidos de comando da IA. |
| POST | `/projects/:pid/ssh/pedidos/:id/decidir` | `{ permitir: true|false, por }`: permitir roda o comando (em segundo plano). |

## Diagnóstico

| Método | Rota | O que faz |
|---|---|---|
| GET | `/projects/:pid/jobs/:jid/diagnostico` | Relatório do trabalho em Markdown (sem segredos). |
| GET | `/system/diagnostico` | Relatório do sistema em Markdown (versão, worker, fila, IAs, parados, últimos erros). |
