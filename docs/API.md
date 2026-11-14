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
| GET | `/providers` | Conectores (`claude-code-cli`, `codex-cli`, `gemini-cli`, `local-shell`): status visto pela API e por cada worker. |
| POST | `/providers/:id/check` | Verifica um conector agora. |
| PATCH | `/providers/:id` | `{ "enabled": false }` desabilita; segredos são recusados. |
| POST | `/extract-text` | `{ "name", "contentBase64" }` → `{ "texto" }`. PDF (`pdftotext`), Word `.docx` ou texto; até 10 MB; nada é gravado. |

## Contas de IA

`:id` = `claude-code-cli` (Claude), `codex-cli` (ChatGPT) ou `gemini-cli` (Gemini).

| Método | Rota | Função |
|---|---|---|
| GET | `/accounts` | As três IAs: `instalado`, `conectado`, `problema`, `configuradoPeloAdministrador` (credencial vinda de variável de ambiente) e o login em andamento. |
| POST | `/accounts/:id/login` | Inicia o login oficial do CLI. Devolve `{ state, url?, userCode?, message }`. |
| GET | `/accounts/:id/login` | Estado do login: `iniciando`, `aguardando_codigo` (Claude, Gemini), `aguardando_site` (ChatGPT), `conectado`, `erro`, `cancelado`. 404 se não houver login em andamento. |
| POST | `/accounts/:id/login/code` | `{ "code" }` — código colado pelo usuário (Claude e Gemini). 409 se o login não estiver esperando código. |
| DELETE | `/accounts/:id/login` | Cancela o login em andamento. |
| POST | `/accounts/:id/key` | `{ "key" }` — chave de API: `ANTHROPIC_API_KEY` (Claude), `GEMINI_API_KEY` (Gemini), chave OpenAI via `codex login --with-api-key` (ChatGPT). |
| DELETE | `/accounts/:id` | Desconecta: apaga token/chave do arquivo de segredos e faz logout no CLI. |

Credenciais ficam em `segredos.json` (permissão 600) ou nos arquivos do próprio CLI; nunca no banco.

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
| POST | `/areas/:area/base/import` | `{ "files": [{ "path", "contentBase64" }], "message"?, "author"? }` — envia arquivos ou uma pasta inteira num commit. Ignora `node_modules`, `.git`, `__pycache__`, `.venv`, arquivos de sistema e arquivos > 10 MB (listados em `ignorados`); até 3000 arquivos. PDF/DOCX ganham cópia `.txt`. |

## Projetos

| Método | Rota | Função |
|---|---|---|
| GET | `/projects` | Lista projetos (com o modelo). |
| POST | `/projects` | `{ "name", "description"?, "base"? (slug do modelo; padrão `geral`), "provider"? (`claude-code-cli` \| `codex-cli` \| `gemini-cli`; padrão Claude), "rules"?, "author"? }`. A descrição vira memória ESPECIFICACAO; `rules` vira a versão 1 das regras do projeto. |
| GET | `/projects/:pid` | Projeto com regras vigentes, arquivos de conhecimento e `custoGastoUsd` (trabalhos + conversa). |
| PATCH | `/projects/:pid` | `{ "name"?, "description"?, "provider"?, "maxCostUsd"? (número ou `null`) }`. |
| DELETE | `/projects/:pid` | Exclui o projeto: registros no banco, pasta e artefatos. 409 se houver trabalho EXECUTANDO / AGUARDANDO_RECURSO / AGUARDANDO_APROVACAO ou a IA ainda estiver respondendo. |
| POST | `/projects/:pid/rules` | `{ "text", "reason"?, "author"? }` — nova versão das regras do projeto. |
| GET | `/projects/:pid/rules/history` | Todas as versões das regras. |
| POST | `/projects/:pid/knowledge/import` | Mesmo formato de `/areas/:area/base/import`, para o conhecimento do projeto. |
| GET | `/projects/:pid/knowledge/file?path=` | Lê um arquivo do conhecimento (sandbox). |
| DELETE | `/projects/:pid/knowledge/file?path=&by=` | Remove um arquivo do conhecimento (commit). |
| GET | `/projects/:pid/files` | Arquivos da pasta principal (`main`). |
| GET | `/projects/:pid/files/content?path=` | Conteúdo de um arquivo da pasta principal (sandbox). |

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
| GET / POST | `/projects/:pid/conversations` | Lista / cria conversa `{ "title"? }`. |
| GET | `/projects/:pid/conversations/:cid` | Conversa com as mensagens (`status`: PENDENTE, PRONTA, ERRO; `kind`: resposta, plano, sistema, erro). |
| POST | `/projects/:pid/conversations/:cid/messages` | `{ "content" }` — enfileira a resposta da IA do projeto (409 se ainda houver uma pendente). |
| POST | `/projects/:pid/conversations/:cid/messages/:mid/approve` | `{ "decidedBy", "start"? }` — o "Fazer": transforma o plano em trabalho (sempre com a conferência das regras) e inicia. 400 sem `decidedBy`; 409 se já aprovado. |

## Trabalhos (jobs)

| Método | Rota | Função |
|---|---|---|
| GET | `/jobs` | Todos os jobs (`?status=BLOQUEADO`). |
| GET / POST | `/projects/:pid/jobs` | Lista / cria (exemplo abaixo). |
| GET | `/projects/:pid/jobs/:jid` | Job completo: objetivos, etapas, tentativas, critérios com evidência, checkpoints, artefatos, aprovações. |
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
