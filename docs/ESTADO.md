# Estado do desenvolvimento (checkpoint para retomada)

> Atualizado em 2026-11-14. Código na `main`. Procedimento das IAs reais: `docs/PROCEDIMENTO-CLI.md`.
> Evidências brutas: `docs/evidencias/<data>/`.

## Gemini pela conta removido (2026-11-15)

O Google encerrou o Gemini CLI com conta pessoal ("IneligibleTierError… migrate to Antigravity"), então o
tipo "Gemini — conta" saiu por completo: conector, login pela tela, mensagens e documentação. Na atualização
(`removerGeminiConta`, pelo seed), as conexões dele saem com login e pasta, e projetos, trabalhos em
andamento, listas de reserva e modelos escolhidos passam para a IA padrão. Fica o **Gemini por chave de
API** (que também gera os vídeos com o Veo). Teste `25-remover-gemini-conta`.

## Versionamento padrão e entrega na conversa (2026-11-15)

* **Projeto ligado ao GitHub/GitLab versiona sozinho**: a cada trabalho concluído que mudou arquivos, commit
  legível + tag da próxima versão (segue as tags X.Y.Z do repositório; sem nenhuma, `v0.1.0`) + push. Se o
  repositório andou, atualiza (pull) e envia de novo; só para em conflito real, avisando. Vale para projetos
  já ligados (migração). A conversa avisa a versão enviada. Feito pelo sistema: qualquer IA.
* **Entrega**: terminado um trabalho aprovado na conversa, a IA volta sozinha com o que fez, os caminhos dos
  arquivos e TODAS as perguntas que dependem do usuário, numeradas, com opções e recomendação. O cartão
  "Pronto" e a entrega listam os arquivos criados/alterados/apagados, que abrem pela tela (ler, copiar,
  assistir vídeo). Rota `GET /projects/:pid/jobs/:jid/arquivos`.

Testes: suíte 113/113, `15` (versão automática, repositório à frente), `22` (entrega); tela OK.

## Apagar e mover arquivos pela IA (2026-11-15)

O Claude no Nivoo não tem terminal (só lê e edita), então uma limpeza não conseguia apagar nada. Agora o
plano pode ter a etapa do sistema `arquivos-projeto` (`remover`/`mover`, caminhos validados; nunca `.git`,
`contexto/`, `.nivoo/` ou fora do projeto). Executa direto: o "Fazer" do plano é a confirmação e o git
guarda tudo (commit do trabalho; GitHub/GitLab se ligado). O registro diz o que saiu. Correção junto: PDF
com pouco texto não é mais trocado pelo resultado do OCR (OCR só para PDF sem camada de texto).
Teste `24-apagar-mover-arquivos`; suíte 111/111.

## Memória do projeto reorganizada (2026-11-15)

Aba "Memória" (antes "O que o projeto lembra"). Cada item em UM grupo só — nota de trabalho da IA nunca
aparece como resultado (antes aparecia duplicada e com o texto "Concluído e conferido"). Ordem: Decisões,
Combinados e próximos passos, Preferências e regras, Sobre o projeto, Trabalhos concluídos (com a data),
Lições e, por último e recolhidas, as Anotações de trabalho da IA. Item compacto (2 linhas; clique abre
inteiro), ações em ícones (copiar, esquecer), contagem por grupo.

## Correções — entrada, Gemini encerrado, lições, trava de gasto (2026-11-15)

* **Entrada**: com o login da Cloudflare configurado (`nivoo dominio acesso <equipe> <aud>`), quem passou
  pelo código por e-mail entra direto — o Nivoo confere o JWT `Cf-Access-Jwt-Assertion` (RS256, chaves da
  equipe, AUD, validade). Sem isso, uma **tela de entrada** pede o token UMA vez (no lugar da caixinha do
  navegador, que aparecia em dobro).
* **Gemini (conta)**: o Google encerrou o Gemini CLI com conta pessoal ("IneligibleTierError… migrate to
  Antigravity"). Agora isso é reconhecido: a conexão aparece "Não funciona mais (mudança do Google)", o
  trabalho passa para a IA reserva em vez de repetir até parar. Gemini por chave de API continua.
* **Lições**: só para falha do jeito de fazer; nunca de infraestrutura (programa faltando, IA sem acesso,
  limite do sistema); uma por etapa e motivo; o trabalho concluído apaga as dele; a atualização remove as
  lições-lixo existentes. Corrigido também `ModuleNotFoundError` sendo lido como "sem rede" (`ENOTFOUND`).
* **Trava de gasto**: opcional. Trabalho sem trava por padrão (0); vale só o limite do projeto, se você
  definir. Trabalhos parados pela antiga trava padrão de US$ 5 ficam sem trava. A tela não mostra mais
  "a conferência encontrou algo fora das regras" quando o motivo real é outro.

Testes: suíte 110/110 (+7 de IA real puladas), `23-login-cloudflare`, lições em `22`, unitários do Gemini;
interface pela tela e `entrada-smoke.cjs`.

## Etapa 19 — publicar num domínio pela Cloudflare (2026-11-15)

`nivoo dominio <endereço>` (como root): instala o `cloudflared`, autoriza o servidor na conta da Cloudflare (link no
navegador), cria o túnel e o registro DNS, sobe o serviço e liga o token do Nivoo; mostra o passo a passo do
Cloudflare Access. `status` e `remover`. Validado por simulação (cloudflared/systemctl/curl falsos): fluxo
completo, segunda execução reaproveitando túnel e token, endereço inválido recusado. Não testado com a
Cloudflare real.

## Etapa 18 — vídeo com o Veo, trabalho até o fim e IA reserva (2026-11-14)

* **Vídeo (Veo, Google) pela API do Gemini**: conector `gemini-video` (etapa do sistema, não de IA de texto)
  que usa a conexão "Gemini — chave de API". Formato REST conferido na biblioteca oficial `@google/genai`
  (a documentação do Google não estava acessível desta rede): `models/{modelo}:predictLongRunning` →
  consulta da operação → `generatedSamples[].video.uri` → download com a chave. **Modelos escolhíveis**
  (Ajustes → Vídeos) com a lista que a própria chave libera (`GET /v1beta/models`, só os Veo). Na conversa
  a IA propõe a etapa (descrição, duração, 16:9/9:16, imagem inicial opcional — anexo do chat colocado no
  projeto); o `.mp4` vai para a pasta do projeto e aparece com player no chat e em Arquivos. Custo
  ESTIMADO por segundo (`NIVOO_VEO_USD_POR_SEGUNDO`=0,40 e `…_RAPIDO`=0,15 — confira a tabela do Google) e
  conferido ANTES de gerar contra o limite do trabalho e do projeto; recusa por segurança explicada.
* **Até o fim**: trabalho aprovado na conversa não tem limite de sessões nem de tempo (`0` = sem limite) e
  ignora limites que a IA ponha no plano; para só por repetição sem avanço ou pelo limite de gasto do
  projeto. **IA reserva** (Ajustes): sem crédito/limite/login, o trabalho e a conversa continuam sozinhos
  na próxima IA conectada da lista, do ponto em que estavam, com aviso na conversa.
* **Conferência impossível**: verificação com programa inexistente (`rg` no servidor real: 8 sessões
  perdidas) agora para na hora com `VERIFICACAO_IMPOSSIVEL` dizendo qual programa falta; a IA é orientada
  a usar só comandos básicos; o instalador passa a instalar `ripgrep`.

Testes: suíte 106/106 (+7 de IA real puladas), `21-video-veo` (API do Google simulada: modelos, plano com
imagem inicial, pedido no formato oficial, arquivo no projeto, custo, limite antes de gerar, recusa),
`22-ate-o-fim-e-ia-reserva`; interface pela tela OK. Não testado com a API real do Google.

## Correção — Claude recusando o login e trabalho longo parando "repetindo sem avançar" (2026-11-14)

* **Token do Claude corrompido no login pela tela**: o `claude setup-token` imprime o token e, logo abaixo,
  "Store this token securely…". O Nivoo juntava as linhas antes de ler o token e grudava o começo da
  frase nele (`…Storethistokensecurely`), e a Anthropic respondia 401 — reconectar não resolvia. Agora o
  token é lido sem juntar linhas e **conferido com uma chamada mínima** antes de "Conectado"; recusado =
  erro na tela. Teste com a saída real do CLI (e prova de que a regra antiga corrompia).
* **"A IA ficou repetindo sem avançar" em tarefa longa** (ler o projeto inteiro): duas sessões seguidas
  só lendo, sem gravar arquivo, bloqueavam o trabalho, e as anotações de progresso não contavam. Agora
  progresso anotado conta como avanço (o limite de sessões por etapa continua), e a IA é orientada a criar
  o arquivo de resultado no começo e ir completando.
* **Tela**: "Parei" com "ver o que aconteceu" (motivo e erro de cada tentativa, copiável) e "continuar com
  outra IA"; itens da memória abrem para ler inteiro e copiar; lições em português.

Testes: suíte 101/101 (+7 de IA real puladas), `09` com sessões longas que anotam progresso e concluem,
`20` com token recusado na conferência; interface pela tela com memória abrindo e copiando.

## Etapa 17 — anexos no chat, login recusado e trocar token do Git (2026-11-14)

* **Anexos no chat**: clipe, colar (Ctrl+V) e arrastar. Imagens vão como imagem (a IA abre e vê; o
  ChatGPT também as recebe por `--image`); PDF/Office/LibreOffice viram texto; texto e código como estão.
  Miniaturas e etiquetas na conversa (clique abre). As etapas do trabalho aprovado recebem os mesmos
  anexos; "coloque este logo no site" → o plano indica `anexosNoProjeto` e o sistema copia o arquivo.
* **Login recusado**: erro real do Claude "401 OAuth access token is invalid" com a tela mostrando
  "Conectado" (o CLI só confere que o token existe). Agora a primeira recusa marca a conexão como
  "Login recusado pela IA — reconecte", a mensagem explica e oferece outra IA; reconectar limpa.
* **Git**: trocar o token na linha da conexão (conferido antes de salvar; projetos continuam ligados).

Testes: suíte 100/100 (+7 de IA real puladas), `20-anexos-e-login-recusado` (anexos chegando à IA e às
etapas, recusas, abrir pela tela, caminho malicioso, logo copiado para o projeto, exclusão; 401 marcando
e reconexão limpando), `18` com troca de token; interface pela tela com anexos (imagem e Word).

## Etapa 16 — Conexões: várias contas do mesmo serviço (2026-11-14)

A tela "Contas" virou **Conexões**, no formato de lista de integrações: "Conexões cadastradas (N)", botão
**+ Nova** (escolhe o tipo: Claude/ChatGPT/Gemini pela conta ou por chave de API, GitHub, GitLab) e, em
cada linha, ícone, nome, selos (tipo, ★ padrão), estado e ações (conectar/reconectar, chave, padrão,
renomear, desconectar, excluir; no Git, testar o token). Pode haver quantas conexões quiser de cada tipo
("ChatGPT 1", "ChatGPT 2"), cada uma com login/chave e pasta próprios — nunca se misturam; o projeto
escolhe a conexão. O que já estava conectado vira conexão automaticamente, sem reconectar. A conexão
padrão é a IA dos projetos novos. Testes: suíte 98/98 (+7 de IA real puladas), `19-conexoes-multiplas`
(migração, duas chaves do Claude em projetos diferentes chegando cada uma à sua sessão com pasta própria,
nome repetido, padrão, exclusão recusada em uso e limpeza ao excluir, login pela tela de uma segunda conta
do Claude sem tocar na primeira); interface pela tela com conexões e Git na mesma lista. Não testado com
duas contas reais do mesmo serviço.

## Etapa 15 — Git: criar repositório, escolher da lista, mudar de servidor (2026-11-14)

GitHub e GitLab conectados ao mesmo tempo (várias contas). Novo projeto **"Do zero + repositório novo"**:
escolhe a conta, o dono (você ou um grupo/organização), o nome e se é privado; o Nivoo cria o
repositório vazio, envia o projeto e liga o envio automático. **"Trazer de um repositório Git"** mostra a
lista dos seus repositórios (com busca) em vez de exigir o endereço. Na aba Git: projeto sem repositório
→ "Criar repositório novo" ou "Ligar a um que já existe" (também com a lista); projeto ligado → "mudar
para outro repositório (ex.: do GitHub para o GitLab)", com todo o histórico. Testes: suíte 95/95 (+7 de
IA real puladas), `18-git-criar-repositorio` (servidores GitHub Enterprise e GitLab simulados por API
local: duas contas, token errado recusado, lista, grupos, criar no grupo, nome repetido → 409, mudar
do GitHub para o GitLab); interface pela tela com o passo 8 (conta GitLab, repositório novo num grupo,
escolher da lista). Não testado: API real do github.com e do seu GitLab.

## Etapa 14 — modelo pronto "Software — Studio Workflow" (2026-11-14)

O pacote STUDIO-WORKFLOW adaptado pelo responsável (`apps/backend/modelos-prontos/studio-workflow/`, 19
arquivos de texto, conferidos: sem dados pessoais, caminhos locais, credenciais ou instruções de terminal)
vira um modelo pronto que **já vem criado** em toda instalação (seed/inicialização), sem sobrescrever um
modelo existente com o mesmo nome. `NIVOO-REGRAS.md` (6.495 caracteres) é o "Como a IA deve funcionar";
os outros 18 arquivos são os materiais (`contexto/base/…`). O método casa com o Nivoo: o Relatório de
alinhamento é o texto do plano "Posso fazer isto", o "ok" é o botão Fazer, a IA declara comandos de
verificação e critérios (o sistema executa) e especialidades novas vão para `docs/prompt-framework/` do
repositório do projeto. Também aparece como ponto de partida em "+ Novo modelo". Testes: suíte 94/94
(+7 de IA real puladas), `17-modelo-studio-workflow` (regras exatas, 18 materiais, toda referência
`contexto/base/…` das regras existe, perfil do projeto); interface pela tela OK. Não testado com IA real.

## Etapa 13 — tudo que é importado vira texto (2026-11-14)

Material do modelo e conhecimento do projeto ficam guardados **só como texto** (o original não é gravado):
PDF (inclusive escaneado: OCR com `tesseract`, português + inglês), Word, PowerPoint (slides em ordem),
Excel (por planilha, colunas separadas por tabulação) e LibreOffice (Writer, Impress, Calc) viram
`<nome>.txt`. Formato antigo (.doc/.xls/.ppt/.rtf) ou arquivo ilegível é recusado com o motivo, mostrado
na tela. Na atualização (`nivoo update`), os documentos já guardados são convertidos num commit (o
original fica no histórico do git). O instalador agora instala `tesseract-ocr` e `tesseract-ocr-por` e
roda o seed como usuário do serviço. A pasta do projeto (repositório de código) não é convertida.
Testes: suíte 93/93 (+7 de IA real puladas), incluindo `16-documentos-em-texto` (Office/LibreOffice com
conteúdo exato, nomes sem colisão, antigos e quebrados recusados, OCR de PDF escaneado, conversão do que
já estava guardado e idempotência); interface pela tela OK.

## Etapa 12 — Git: GitHub e GitLab próprio (2026-11-14)

**Contas Git** (menu Contas, seção "Git"): GitHub ou GitLab próprio (endereço do servidor) + token de
acesso; o token é conferido no servidor Git ao salvar e fica em `git-contas.json` (permissão 600, ao lado
de `segredos.json`), nunca no banco, no git ou para a IA. Autor dos commits opcional por conta.

* **Novo projeto → "Trazer de um repositório Git"**: endereço (https ou `git@…`, convertido para https),
  branch e conta (automática pelo servidor do endereço). O repositório é clonado como pasta principal do
  projeto; repositório vazio ganha um commit inicial. Instruções do próprio repositório (`CLAUDE.md`,
  `AGENTS.md`, `.claude/`…) **continuam no repositório** e chegam à IA como regras do projeto, em cópia de
  leitura (`contexto/repositorio/`) — a IA não as altera e o envio não as apaga.
* **Aba Git do projeto**: estado (commits para enviar / novos no repositório), últimos commits,
  **Atualizar do Git** (pull: avanço direto ou commit de junção; em conflito nada muda e a tela avisa),
  **Enviar para o Git** com **versão/tag** opcional (tag anotada), **envio automático** depois de cada
  trabalho concluído, ligar um projeto existente a um repositório e desligar.
* **Commits legíveis**: cada trabalho entra na pasta principal como **um commit** (squash) com título,
  objetivo e "critérios verificados e conferência das regras aprovada" — os checkpoints internos ficam só
  na branch do trabalho e não vão para o GitHub/GitLab.
* Envio recusado porque o repositório andou → a tela pede "Atualizar do Git" antes (nunca força).
* Correção achada pela suíte: arquivo de agente criado por uma etapa do trabalho era tratado como
  instrução do repositório; agora só conta o que está versionado na pasta principal (o resto é plantio e
  é removido antes da sessão de IA).

Testes: suíte 90/90 (+ 7 de IA real puladas), incluindo `15-git` (endereços, contas, clonar branch
`develop` preservando o `CLAUDE.md`, commits sem checkpoint, envio + tag, envio recusado, pull, conflito,
repositório vazio, envio automático); interface pela tela (`chat-smoke.cjs`) com o passo 7: projeto
trazido de um repositório, aba Git e envio com tag. Não testado: tokens reais de GitHub/GitLab (só
repositórios locais de teste).

## Etapa 11 — escolher o modelo de cada IA no projeto (2026-11-14)

No topo do chat (e em Ajustes), ao lado da IA, um seletor de **modelo**. A lista vem do programa oficial da
IA, então modelos novos aparecem sozinhos: Claude (aliases `fable`, `opus`, `sonnet` = versão mais recente,
e Haiku), ChatGPT (`codex debug models`: GPT-6.1-Sol, GPT-6-Astra, GPT-5.6-Sol…), Gemini
(`gemini --list-models`: auto, gemini-2.5-pro, gemini-3.5-flash…); "Outro…" aceita qualquer nome. A escolha
fica guardada **por IA** no projeto (`Project.aiModels`), vale para o chat e para os trabalhos (a etapa
pode sobrepor) e chega ao CLI como `--model`. Testes: suíte 85/85 (o `--model` escolhido chega ao CLI no
chat e no trabalho; a escolha é guardada por IA).

## Correção — fila parada em servidor fora de UTC (2026-11-14)

**Relato comprovado no servidor** (Debian 13, `America/Sao_Paulo`, versão `28f997d`): worker online, mas
nenhuma tarefa nova reivindicada; `nivoo verificar` em `EXECUTANDO` com 0 tentativas; tarefas `RUN_STEP` e
`PLAN_MESSAGE` acumuladas e processadas só 3 horas depois. **Causa:** o Prisma grava `DateTime` em UTC em
colunas `timestamp without time zone`, e o SQL bruto da fila (`QueueService`) comparava e gravava com
`now()`, que é a hora local da sessão do PostgreSQL (-3 h). **Correção:** seleção (`runAt`), recuperação de
lease (`lockedUntil`), criação e renovação de lease, `updatedAt` e marcação `DEAD` usam
`CURRENT_TIMESTAMP AT TIME ZONE 'UTC'`. Fuso do servidor e do banco não foram alterados; nenhum dado foi
corrigido à mão (as tarefas presas já tinham `runAt` em UTC e ficam elegíveis com a comparação certa).
Revisado o repositório: não resta `now()` em SQL bruto do código (sobram só duas migrações antigas já
aplicadas, que preencheram uma vez a data de criação de um registro de modelo — sem efeito na fila).

| Verificação | Resultado |
|---|---|
| `acceptance/14-fila-fuso-horario` (banco em `America/Sao_Paulo` e em UTC): tarefa nova reivindicada na hora (`claims` 0 → 1), tarefa futura não, heartbeat e renovação de lease, lease vencido recuperado, `DEAD`, worker consome `RUN_STEP` e `PLAN_MESSAGE` | 8/8; **com o código antigo: 3 falham em São Paulo** (reprodução do bug) |
| Suíte completa | 84/84 |
| Debian 13 real com fuso `America/Sao_Paulo`: instala `28f997d` → `nivoo verificar` | **falha** (`EXECUTANDO`, 0 tentativas; `"runAt" <= now()` = f, em UTC = t) — bug reproduzido |
| Mesmo servidor após `nivoo update` para a correção | o job que estava preso concluiu sozinho (1 tentativa); `nivoo verificar` → `OK: job de verificação CONCLUIDO pelo verificador`; fila sem tarefas pendentes |

## Etapa 10 — trocar de IA no meio do projeto, conta e API separadas, nada fica preso (2026-11-14)

* **Seis opções de IA**, conectáveis ao mesmo tempo: Claude, ChatGPT e Gemini, cada uma **pela conta**
  (assinatura) e **por chave de API** (cobrança por uso). Variantes API usam pasta de configuração própria
  (`~/.nivoo-ia/<ia>-api`), então conta e chave nunca se misturam. Conectores: `claude-code-cli`,
  `claude-api`, `codex-cli`, `codex-api`, `gemini-cli`, `gemini-api`.
* **Trocar a IA do projeto** direto no topo do chat (ou em Ajustes). O trabalho ainda não terminado passa
  para a nova IA e, se estava esperando a anterior (limite/crédito), continua na hora. A nova IA relê o
  projeto (regras, conhecimento, memória, pasta, notas e checkpoints): nada depende da IA anterior.
  Quando a IA esgota, o chat e o cartão do trabalho mostram **"Continuar com …"**.
* **Nada fica preso:** "Pensando…" mostra o tempo e tem **parar**; **Ajustes → Trabalhos em andamento**
  lista e **para** qualquer trabalho (inclusive os que não vieram do chat); **Excluir projeto** para
  sozinho trabalhos e respostas em andamento antes de excluir; excluir conversa também.
* **O chat não espera trabalho longo:** o worker tem duas faixas (trabalhos; respostas do chat).
* Aviso no topo da tela quando o worker está parado (nada anda).
* Testes: suíte 76/76; interface pela tela ok.

## Correção — login do Claude pela tela travava em "Conferindo o código…" (2026-11-14)

Relato do usuário no servidor. Causa: o código de login do Claude é longo; escrito de uma vez no terminal
simulado, o Claude CLI o trata como "colar" e o Enter ia junto, sem enviar. Agora o texto e o Enter vão
separados (testado com o Claude CLI real: o código passa a ser enviado e conferido). Se o código for
recusado, a tela mostra o motivo e pede para conectar de novo (antes ficava parada); sem resposta em 90 s,
também avisa. ChatGPT: a OpenAI exige ativar "login com código de dispositivo" em chatgpt.com →
Configurações → Segurança; a tela agora explica isso.

## Etapa 9 — várias conversas por projeto, arquivar e excluir (2026-11-14)

Pedido: a lista não pode crescer sem fim. Agora cada projeto tem **várias conversas** (como no ChatGPT):
"+ Nova conversa" começa limpa, mas a IA continua sabendo tudo do projeto (memória, regras, conhecimento,
arquivos) — o histórico enviado à IA é só o da conversa aberta. Cada conversa pode ser **renomeada**,
**arquivada** (sai da lista; conversa arquivada não recebe mensagens até ser desarquivada) ou
**excluída** (apaga as mensagens; o que o projeto aprendeu continua). Projetos também podem ser
**arquivados**. Migração `20261114200000_arquivar_conversas_projetos` (só colunas novas).
Testes: suíte 73/73 (novo caso em `acceptance/13`: memória chega na conversa nova, histórico de outra
não; arquivar, desarquivar, excluir; projeto arquivado); interface pela tela (`chat-smoke.cjs`): nova
conversa, arquivar, ver arquivadas e excluir.

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

| Verificação | Resultado |
|---|---|
| Suíte automatizada (`npx jest test/unit test/acceptance`) | **72/72** passando (`acceptance/13`: 12 casos novos — modelos, fine-tune do projeto, trava, conversa, limite de gasto, contas de IA) |
| Interface pela tela (`apps/web/e2e/chat-smoke.cjs`, IA simulada) | todos os passos: contas → novo modelo com regras importadas de PDF e pasta de materiais → novo projeto → ajustes → conversa → Fazer → conferência → pronto → memória e arquivos → excluir |
| **Claude real** (`real-06`, evidência em `docs/evidencias/2026-11-14/real-06-conversa-modelo.json`) | pedido fora do escopo ("script de imposto de renda") **recusado** com explicação; pedido no escopo → plano → trabalho real → **conferência real por sessão separada** (`conforme: true`, leu `contexto/base/_CLAUDE.md`, as regras da casa e o cardápio) → CONCLUÍDO e incorporado; legenda segue o modelo (termina com CASA-PZ-9137, só ingredientes do cardápio, sem inventar preço); memória "público: famílias do bairro" gravada e lembrada na pergunta seguinte. Custo ≈ US$ 0,55 |
| Debian 12 real (systemd): instala a `main` anterior (com Mercado), cria dados (inclusive hipótese de pesquisa) e roda `nivoo update` | dados preservados; projeto antigo passa ao modelo "Geral"; memória de hipótese convertida; job novo em projeto antigo CONCLUÍDO e incorporado; `pdftotext` e Gemini CLI instalados; conversa sem IA conectada orienta a conectar; `nivoo verificar` ok e sem deixar projeto de teste; `nivoo check` lista Claude, ChatGPT, Gemini e executor local |
| Login pela tela **no serviço instalado** (usuário `nivoo`, isolamento do systemd) | Claude: link completo do login oficial + espera do código; ChatGPT: link + código de dispositivo; Gemini: link do Google + espera do código. (Concluir o login exige a conta real do usuário.) |

Problemas encontrados nesta rodada de testes e corrigidos:

* No servidor, o link de login do Claude vinha cortado (terminal simulado estreito): o terminal agora é
  largo e o link é lido do hyperlink do terminal.
* O Gemini CLI ignora arquivo de configuração "de sistema" fora de pasta do root; como o serviço não roda
  como root, o login ficava parado e a exclusão de shell/web não valeria. A configuração passou para o
  arquivo do usuário do serviço (`~/.gemini/settings.json`), que o CLI aceita.
* `nivoo check` ainda consultava os conectores de API removidos e parava com erro: corrigido.
* A tela não tinha como informar o token de acesso (`NIVOO_API_TOKEN`): agora pede o token quando o
  servidor exige e guarda no navegador.
* O limite de gasto do projeto não valia para a conversa: agora vale (mensagem clara ao atingir).

### Continua pendente

* Codex e Gemini sem execução real com conta (o login pela tela foi testado até a etapa que exige a conta do usuário; o trabalho em si, só com simulação).
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

1. Conectar ChatGPT e Gemini com contas reais pela tela Conexões e rodar `real-04` (Codex); criar uma
   prova real equivalente para o Gemini.
2. Rodar `real-01`, `real-02`, `real-05` e `real-06` com o serviço instalado no servidor de produção.
