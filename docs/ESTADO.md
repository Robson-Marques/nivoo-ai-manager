# Estado do desenvolvimento (checkpoint para retomada)

> Atualizado em 2026-11-16. Código na `main`. Procedimento das IAs reais: `docs/PROCEDIMENTO-CLI.md`.
> Evidências brutas: `docs/evidencias/<data>/`.

## Login por usuário e senha; domínio próprio sem limite de upload (2026-11-18)

Além do token de API e do login da Cloudflare, o Nivoo agora tem **login por usuário e senha**, para servir num
**domínio próprio** sem depender da Cloudflare (e do limite de 100 MB dela no upload). Liga-se no servidor com
`nivoo senha [usuario]` (grava `NIVOO_LOGIN_USUARIO`/`NIVOO_LOGIN_SENHA` em `nivoo.env`, 640, e reinicia); desliga com
`nivoo sem-senha`. A tela de entrada passa a pedir **usuário e senha**; `POST /api/login` confere e devolve um **crachá
de sessão assinado** (HMAC, validade `NIVOO_LOGIN_HORAS`, padrão 30 dias) que o guard aceita como o token. A senha nunca
sai do servidor; há trava de força bruta por IP. Para o upload sem limite, põe-se um **nginx** na frente do domínio com
`client_max_body_size 2048m;` (DNS do domínio → IP do servidor). Teste `34` (status, 401 sem crachá, login certo entra,
errado/forjado não; sem login configurado fica aberto local).

## Auto-correção: a conversa conserta sozinha o trabalho que parou (2026-11-18)

Quando um trabalho **para** (bloqueado ou falhou), a conversa de onde ele veio recebe o **erro** como uma "entrega"
pendente, e a IA do projeto **diagnostica e propõe um plano de conserto sozinha** — sem o usuário precisar pedir. Se o
projeto está em **"seguir sozinho"**, o conserto **roda automático** (dentro do teto de 8 planos seguidos e do limite de
gasto do projeto). Para não gastar à toa, só tenta `NIVOO_AUTOCORRIGIR_MAX` (padrão **3**) vezes sem o usuário falar;
passado disso, para e pede ajuda no chat. Parada **pedida pelo usuário** (pausar/interromper) nunca dispara correção.
O `dadosDaEntrega` (planner) passou a montar, para trabalho parado, o motivo + a etapa/erro + critérios + últimas linhas
do log, e orienta a IA a explicar em uma frase e propor o conserto (com `continuacao:true`). Teste `13` (trabalho que
falha vira diagnóstico + plano de conserto sozinho) e `32` (trabalho da conversa que para volta para a conversa).

## Revisão "não conforme" volta para correção, sem loop (2026-11-15)

Caso real (diagnóstico do ConnectChat): a etapa de auditoria foi dada como concluída com o inventário vazio (o ChatGPT
ainda não conseguia ler), e a conferência das regras, corretamente, reprovou — mas a etapa da revisora só terminava
com "conforme=true", então ela repetia a revisão até o trabalho parar. Agora: a etapa de revisão termina quando o
relatório existe (conforme true OU false; vale também para trabalhos antigos); o critério final continua exigindo
conforme=true, e quando ele falha a etapa de correção leva para a IA do projeto as **violações apontadas pela
revisora** (o relatório antigo é apagado; a revisão roda de novo), até 6 rodadas (ADR-083). Informação que só o usuário tem não
trava mais: a IA faz a melhor versão e registra em `out/perguntas-ao-usuario.md` (vai na entrega). O diagnóstico
mostra a versão mesmo com a pasta do código de outro dono (`safe.directory`). Testes em `22` e `13`.

## Diagnóstico para o suporte e registro de erros (2026-11-15)

Para corrigir sem tentativa e erro:
* **Trabalho parado** → botão **Copiar diagnóstico completo** (e "baixar .md"): motivo, objetivo, limites, cada
  etapa (IA/executor, conferência), as tentativas recentes (erro, término, turnos, fim da resposta, se mudou
  arquivo, notas), critérios com evidência, aprovações e comandos SSH, status/versão das IAs usadas, ferramentas
  MCP, as últimas 150 linhas do log e os erros do sistema ligados ao trabalho. `GET /projects/:pid/jobs/:jid/diagnostico`.
* **Página Diagnóstico** (menu lateral) e **`nivoo diagnostico`** (salva em /root, inclui o journal dos serviços):
  versão (commit), worker no ar, fila (inclusive tarefas mortas), conexões de IA, trabalhos parados recentes e os
  últimos erros do sistema. `GET /system/diagnostico`.
* **Registro de erros do sistema** (`erros.log` ao lado dos dados, 600, gira em 2 MB): todo 500 da API (filtro global)
  e toda falha do worker/conector, com detalhe.
* Tudo passa por `redigir()`: chaves privadas, tokens (Anthropic, OpenAI, Google, GitHub, GitLab), "Bearer …",
  senha em URL de banco e `senha=/token=/api_key=` saem ocultos. Teste `29-diagnostico` e tela (`chat-smoke`).

## ChatGPT: histórico antigo e teste no servidor (2026-11-15)

O aviso de ferramentas do Codex agora diz que notas/lições anteriores do tipo "não tenho leitor" / "terminal é
proibido" estão erradas (elas reforçavam o bloqueio a cada sessão nova do mesmo trabalho). `nivoo testar-chatgpt`
pede ao Codex, no servidor, como o worker faz (sandbox workspace-write), para ler um arquivo pelo terminal e diz
OK ou mostra o trecho do erro (login, sandbox, bwrap…).

## Servidores SSH com permissão a cada comando (2026-11-15)

Conexões → **Servidores SSH**: nome, endereço, porta, usuário e quais projetos podem usar. O Nivoo gera uma chave
ed25519 só para isso (privada em `segredos.json` como `ssh--<id>/CHAVE_PRIVADA`, nunca sai do servidor; a pública
aparece com o comando pronto para o `authorized_keys`); **Testar o acesso** (ação do usuário) e **gerar nova chave**.
Lista em `ssh.json` (600). Nos projetos liberados, a IA ganha a ferramenta MCP do próprio Nivoo `servidores-ssh`
(`listar_servidores`, `executar_no_servidor` com comando e motivo): ela NÃO tem a chave — cada chamada vira um
`SshPedido` PENDENTE que aparece na conversa do projeto com **Permitir / Recusar**; só o Permitir faz a API rodar
o comando (ssh com BatchMode, `known_hosts_nivoo`, tempo limite) e gravar a saída, que volta para a IA. Recusar
avisa a IA; sem resposta em 14 min (`NIVOO_SSH_ESPERA_SEG`), o pedido expira. Tudo fica registrado (quem
permitiu, quando, comando, saída, código). Vale nas etapas e na conversa, para Claude, ChatGPT e Gemini. Rotas
`/ssh/servidores…`, `/projects/:pid/ssh/pedidos` e `…/decidir`. Instalador inclui `openssh-client`. Testes:
`28-servidores-ssh` (protocolo MCP de verdade: pendente → permitir → saída; recusar; expirar; servidor não liberado;
a chave não vai para a ferramenta) e tela (`chat-smoke`: cadastro, teste, cartão na conversa e Permitir).

## Ferramentas das IAs (MCP) (2026-11-15)

Tela **Conexões → Ferramentas das IAs (MCP)**: cadastrar servidores MCP — programa no servidor (stdio; ex.: `npx -y
<pacote-mcp>`) ou endereço (HTTP streamable; ex.: Context7, GitHub) —, com variáveis,
tokens/senhas (variáveis ou cabeçalhos secretos: guardados em `segredos.json` como `mcp--<id>/<NOME>`, nunca devolvidos
pela API nem postos no texto da IA), liga/desliga e **quais projetos usam** (todos ou escolhidos). Botão **Testar**:
liga a ferramenta, faz `initialize` + `tools/list` e mostra as ferramentas (ou o erro). Modelos prontos: Documentação
(Context7) e GitHub (navegador ficou de fora, a pedido). Lista em `mcp.json` (600) ao lado de `conexoes.json`.

Em cada sessão de IA do projeto (etapas, conferência das regras e conversa), as ferramentas liberadas vão no formato
de cada IA: Claude `--mcp-config` (arquivo só da sessão, 600, fora da pasta do trabalho; `--strict-mcp-config`
continua: só essas valem) + `--allowedTools mcp__<nome>`; ChatGPT/Codex `-c mcp_servers.<nome>.…` só para a execução
(o log não mostra segredos); Gemini `mcpServers` num HOME só da sessão. O prompt avisa quais ferramentas existem. Rotas `GET/POST /mcp`,
`PATCH/DELETE /mcp/:id`, `POST /mcp/:id/testar`. Testes: `27-ferramentas-mcp` (servidor MCP de teste por stdio,
segredo chega ao programa e nunca à API/prompt, só nos projetos escolhidos; formatos Codex/Gemini) e tela
(`chat-smoke`: criar, testar, excluir). Limitação: no Codex, valores secretos de ferramentas por comando vão em
argumentos da execução (visíveis a quem tiver acesso de root ao servidor durante a sessão).

## ChatGPT "sem leitor local": cada IA é avisada das próprias ferramentas (2026-11-15)

Caso real: auditoria com o ChatGPT (Codex) parando sessão após sessão — "terminal é proibido pelo perfil;
necessário leitor local". As regras do Studio Workflow (e o plano) diziam "não executa terminal", pensando no
Claude (que lê com Read/Grep); o Codex só lê arquivos por comandos e, obedecendo, ficava cego. Agora toda sessão
(etapas, conferência das regras e conversa) leva a seção "Suas ferramentas nesta sessão": ao Codex, comandos de
LEITURA (ls, cat, sed -n, rg, git show…) são permitidos e necessários; testes, build, instalação, commit, push,
apagar e rede continuam proibidos (e o sistema bloqueia o perigoso). A IA que planeja não proíbe mais comandos de
leitura nas etapas. A regra do modelo Studio Workflow foi reescrita (o já instalado ganha versão nova no seed).
Não era falta de MCP.

## Vídeo: trilha de fundo única com a fala por cima (2026-11-15)

Caso real: cada cena vinha com a própria música (uma canta, a outra fala com outra música), e a fusão não resolvia.
Agora o vídeo pode ter **uma trilha só, de ponta a ponta**: `trilha` na primeira cena — `{"arquivo":"audio/x.mp3"}`
(música do usuário, anexada no chat: grátis) ou `{"descricao":"..."}` (o Google compõe com o Lyria,
`lyria-3-pro-preview` e, se não houver, `lyria-3-clip-preview`; estimativa `NIVOO_LYRIA_USD_POR_MUSICA` = 0,08).
Com trilha, as cenas são pedidas SEM música própria (só falas e sons do ambiente). Na montagem, a música repete se
for curta, entra e sai em fade, fica a 30% (`volume`) e abaixa sozinha sob a fala (sidechain/ducking);
`volumeCenas` (0–1) abaixa o som que veio nas cenas. A trilha gerada fica em `<nome>-completo-trilha.mp3` e é
reaproveitada ao juntar de novo com a mesma descrição (sem pagar outra). Chat aceita anexo de áudio (mp3, wav,
m4a, aac, ogg). Tudo da montagem roda no servidor, sem IA e sem custo; só cena e música usam o Google. Testes
em `21` (Lyria simulado, reaproveitamento) e `26` (trilha do projeto contínua).

## Vídeo: narração (voz) pela Gemini TTS, com o fundo abaixando sob a voz (2026-11-17)

Pedido do usuário: "consumo de Gemini para fazer voz". O vídeo agora pode ter **locução por cima**: `narracao` na
primeira cena, ou na etapa que junta/edita — `{"texto":"o que a voz diz"}` (o Google fala com a Gemini TTS,
`gemini-2.5-flash-preview-tts` e, se não houver, `gemini-2.5-pro-preview-tts`; estimativa
`NIVOO_TTS_USD_POR_NARRACAO` = 0,03) ou `{"arquivo":"audio/locucao.mp3"}` (voz que o usuário já gravou e pôs no
projeto: grátis). Escolhe-se a voz com `"voz":"Kore"` (padrão `Kore`) e o quanto o fundo fica sob ela com
`"volumeFundoSobVoz"` (0–1, padrão 0,35). O áudio devolvido pela TTS (PCM "L16" ou já com cabeçalho) é convertido
para mp3; na mistura, a voz fica em **primeiro plano** e o fundo (cenas + trilha) abaixa sozinho enquanto ela fala
e volta nos silêncios (sidechaincompress + alimiter). A locução gerada por texto fica em `<nome>-completo-narracao.mp3`
(com `<nome>-completo-narracao.txt` guardando voz+texto) e é **reaproveitada** ao juntar de novo com o mesmo texto,
sem pagar outra. Narração (voz falada) e legenda (texto escrito na tela) podem ser usadas juntas. Tudo da mistura
roda no servidor, sem IA e sem custo; só gerar a voz usa o Google. Testes em `21` (TTS simulado, voz Kore, texto
enviado, reaproveitamento) e `26` (narração de um áudio do projeto com ducking).

**Seletor de voz (feminina/masculina).** As vozes ficam num catálogo único (`providers/vozes.ts`), cada uma com o
gênero (feminina/masculina) e um estilo curto; a tela lê de `GET /projects/vozes-narracao`. Em **Ajustes → Vídeos**
há um seletor "Voz da narração" que mostra, por grupo, as vozes **femininas** (Kore, Zephyr, Aoede, Leda) e
**masculinas** (Charon, Puck, Orus, Fenrir). A escolha fica guardada no projeto (`Project.vozNarracao`, padrão
`Kore`) e vai ao planejador, que a usa na narração — o usuário ainda pode pedir outra voz na conversa. Uma voz fora
do catálogo é recusada com a lista das válidas. Teste em `26` (catálogo com gênero, voz padrão guardada, voz
inexistente recusada) e no fumaça da tela (escolher uma voz masculina no projeto de vídeo e conferir que ficou).

## Vídeo: legendas e estilo de transição (2026-11-15)

* **Legendas**: cada cena pode ter `legenda` (texto curto, escrito pela IA no plano); a junção calcula o tempo
  real de cada cena no vídeo final (já com as transições), grava a legenda na imagem (branco com contorno,
  embaixo, centralizado, quebra de linha automática; ffmpeg `subtitles` com DejaVu Sans) e salva
  `<nome>-completo.srt` ao lado (para Instagram/YouTube). Sem conseguir gravar, fica só o .srt, com aviso.
* **Transição escolhível** por emenda (`transicao` na cena; `transicoes` na junção manual): fade (padrão),
  fadeblack, fadewhite, dissolve, wipeleft/right, slideleft/right/up, circleopen/close, smoothleft, zoomin ou
  corte. A IA pergunta se o usuário quer legenda e qual transição. Instalador inclui `fonts-dejavu-core`.
  Teste em `26` (legenda conferida no quadro e nos tempos do .srt).

## Vídeo completo com transição suave (2026-11-15)

Caso real: o vídeo juntado tinha trancos e micro-pausas no áudio entre as cenas (corte seco; cada cena tem o
próprio som). Agora a junção faz meio segundo de fusão entre as cenas, na imagem (`xfade`) e no som
(`acrossfade`), reencodando o vídeo final (`NIVOO_VIDEO_TRANSICAO_SEG`, padrão 0.5; 0 = corte seco). Se a fusão
falhar, emenda como antes. O vídeo fica 0,5 s mais curto por emenda. A IA que planeja é orientada a descrever o
mesmo ambiente sonoro em todas as cenas e a terminar falas antes do último segundo. Teste em `26`.

## Conferência que falha calada agora explica (2026-11-15)

Caso real: "a conferência da etapa falhou 6 vezes seguidas do mesmo jeito: (exit 1):" — sem dizer o quê (ex.:
`test -f docs/auditoria.md` não imprime nada). Agora a falha diz o comando e, para `test -f/-s/-e/-d` e
`grep -q texto arquivo`, o que falta de fato ("falta docs/auditoria.md", "CLAUDE.md não contém \"CHANGELOG\"").
Isso vai para a IA na sessão seguinte e para o usuário no motivo da parada. Teste em `22`.

## Bug real: vídeos e imagens baixados pela tela vinham corrompidos (2026-11-15)

A rota que entrega um arquivo da pasta principal (`GET /projects/:pid/files/content`, usada pelo player, pelo
"baixar" e pelos arquivos da entrega) lia a saída do `git show` como texto UTF-8: todo arquivo binário (vídeo,
imagem) chegava estragado ("formato incomum" no WhatsApp, VLC sem tocar) e o limite era 20 MB. Agora lê os bytes
exatos (`git cat-file blob`, até 1 GB) e manda o tipo certo (`video/mp4`, `image/png`…). O arquivo no servidor
sempre esteve certo. Teste em `26` (baixado pela API = idêntico ao do projeto).

## Vídeo: Veo desligado pelo Google → Gemini Omni Flash (2026-11-15)

O Google desligou o Veo da API do Gemini (o 3.1 "preview" em 22/10/2026; no servidor real, todos os Veo —
3.1, 3 e 2 — respondem 404, e a lista da chave não traz nenhum). O substituto é o **Gemini Omni Flash**
(`gemini-omni-1.2-flash`, `gemini-omni-1.1-flash`), por outro caminho da API: `POST /v1beta/interactions`
(`model`, `input` [imagem do 1º quadro + texto], `response_format` {type video, delivery uri, aspect_ratio,
resolution, duration "Ns"}, `background: true`), andamento em `GET /v1beta/interactions/{id}` (`status`
in_progress/completed/failed/cancelled) e o vídeo em `steps[].content[]` {type video, uri | data}. A leitura do
resultado é tolerante (procura o item de vídeo onde vier), porque o formato foi tirado de integrações públicas,
não testado aqui contra o Google real. Lista de modelos só com o Omni (o Veo some, mesmo se a chave o listar);
"automático" tenta 1.2 e depois 1.1; modelo escolhido desligado vira automático (e o seed limpa a escolha
antiga). Preço estimado US$ 0,10/s (`NIVOO_OMNI_USD_POR_SEGUNDO`); 402 (sem crédito) = indisponível com o
motivo. 3 a 15 s por pedido. Testes em `21` (Google simulado no protocolo Interactions).

## ChatGPT sem conseguir ler o projeto no servidor (2026-11-15)

Caso real: trabalho com o ChatGPT (Codex) na "sessão 43", a IA dizendo "as ferramentas disponíveis não oferecem
leitura nem listagem do workspace sem terminal". O Codex roda cada comando num isolamento próprio (bubblewrap,
com namespaces do Linux), e o serviço `nivoo-worker` tinha `RestrictNamespaces=true`: todo comando dele falhava.
Agora o worker (onde as IAs rodam) tem `RestrictNamespaces=false` — vale no próximo `nivoo update`; a API continua
com a restrição. E se o isolamento falhar mesmo assim, a sessão em que nenhum comando roda vira "IA indisponível"
com o motivo (a reserva assume, se houver) em vez de sessão após sessão; o cartão mostra o motivo. Teste unitário
com o stub do Codex.

## Correção automática, ciclo sem fim, andamento da conversa e Veo automático (2026-11-15)

* **Critério final não passou → a IA corrige sozinha**: em vez de parar esperando o usuário, o sistema cria a
  etapa "Corrigir o que a conferência final cobrou" (`correcao-criterios-N`) para a IA do projeto, com o critério,
  a descrição e a evidência; a etapa só termina quando os mesmos critérios passam; a conferência das regras roda
  de novo e os critérios são reavaliados. Até 6 rodadas, parando antes se a revisão repetir (ADR-083); só trabalho feito por IA e só critério automático
  (o de aprovação manual reprovado volta para o usuário). "Tentar de novo" num trabalho parado por critério
  também passa a corrigir. Teste em `22`.
* **Ciclo sem fim**: sem limite de sessões, se a conferência da etapa falha 6 vezes seguidas do mesmo jeito (mesmo
  com a IA mexendo em arquivos), o trabalho para e diz o que a conferência cobra (caso real: "sessão 29" em 23 min).
  O cartão mostra também por que a sessão anterior terminou. Teste em `22`.
* **"Pensando…" com fases**: Preparando → Lendo o projeto → Escrevendo a resposta, barra animada, tempo e a
  última atividade da IA (coluna nova `ConversationMessage.andamento`, gravada no máximo a cada 3 s).
* **Veo "automático"**: a lista de modelos da chave do Google pode não trazer o Veo mesmo com cobrança ativa (caso
  real: "esta chave não tem nenhum modelo Veo"). Agora o automático tenta os conhecidos, do mais barato ao mais
  caro (3.1 Fast, 3 Fast, 3.1, 3, 2), pulando os que a chave recusa (404). Teste em `21`.

## Andamento ao vivo do trabalho (2026-11-15)

O cartão do trabalho na conversa mostra que está vivo: bolinha pulsando, **barra de porcentagem** (pelas etapas
concluídas; a etapa atual aparece animada — dentro de uma etapa não há como medir "quanto falta" sem inventar),
"Etapa N de M", há quanto tempo a etapa roda, em qual sessão está e a **última atividade da IA** em português
("lendo src/app.ts", "rodando: npm test"…), com aviso se ficar 10 min sem novidade. O ChatGPT (Codex) e o
Gemini passaram a registrar cada passo na hora (antes só no fim da sessão, que pode levar 15 min). A API do
trabalho devolve `ultimaAtividade`. Teste de tela (`chat-smoke`, foto `6b-andamento`) e unitário do Codex.

## Correções retestadas e interação das telas comprovada (2026-11-16)

* **Bug real (ConnectChat)**: a revisão apontou "falta evidência funcional das correções": a etapa de correção
  conferia só o critério que falhou — no caso da revisão, `true` — e a etapa criada pela resposta do usuário também. A IA
  mexia no código e nada rodava os testes de novo. Agora correções e respostas rodam DE NOVO as conferências de todas as
  etapas do trabalho (testes, build, fotos) + `nivoo-conferir-telas --se-houver` (`conferenciasDasEtapas`).
* **`nivoo-roteiro`** (interação, sem a IA navegar): roteiros em `nivoo-roteiros/*.json` (ir, clicar, preencher,
  digitar — confere foco e valor a cada letra —, tecla, esperarTexto, esperar, sumir, semTexto, focoEm, valorDe,
  recarregar, foto, aguardar), executados num navegador sem tela, no computador e/ou celular; fotos e relatório em
  `out/telas-interativas/`; falha no passo que não acontecer ou com erro de script. A revisão trata a falta de roteiro
  como violação quando o trabalho mexeu em interação (disciplina de interface do Studio Workflow).
* **`nivoo-conferir-telas`**: uma linha na conferência — liga o sistema como a prévia (`nivoo-previa.json`, com
  `"telas"`), tira as fotos (`--exigir-sem-erros`), roda os roteiros e desliga.
* Testes `32` (campo que perde o foco → corrige → passa) e reais `real-10`: Claude e ChatGPT corrigiram um campo que
  perdia o foco, planejando sozinhos a conferência com `nivoo-roteiro`, comprovado no computador e no celular.

## Agente "Design de Vídeo": projeto de vídeo separado, ligado a um projeto de origem (2026-11-17)

* Na interface, "Modelo" (o jeito de trabalhar de um tipo de projeto) agora se chama **Agente**; o "modelo da IA"
  (Opus/Sonnet, o motor) continua "modelo". Rotas/banco mantêm `areas`; `/agentes` e `/modelos` abrem a mesma tela.
* Novo agente **Design de Vídeo** (`design-video`, instalado): reúne motion, edição, música, legenda e corte por cena.
* Ao criar um projeto nesse agente, você escolhe um **projeto de origem**. O projeto de vídeo é SEPARADO (não embola com o
  software) e **enxerga a origem**: `Project.projetoOrigemId`; o contexto da IA (conversa e trabalhos) ganha o nome, a
  descrição, as regras, o conhecimento e os arquivos/telas da origem (`contextoDaOrigem`), para fazer o vídeo do app de
  verdade. Vínculo apagado se a origem for removida (ON DELETE SET NULL).
* **A montagem não gasta o Gemini.** Em projetos de vídeo (`design-video`, `video-veo`), a IA que **monta** (roteiro,
  estrutura, divisão em cenas, texto de legenda/narração, código do motion) é **Claude ou ChatGPT** — nunca o Gemini.
  Se o pedido escolher o Gemini (`gemini-api`), o `create`/`update` troca pela primeira IA não-Gemini (Claude de
  preferência, senão ChatGPT). A **chave do Gemini** fica reservada para **gerar** a mídia (Veo/Omni, Lyria, TTS), que é
  o que custa caro. A tela do Novo projeto esconde o Gemini na escolha da IA do vídeo e explica o porquê; o planejador e o
  template do agente orientam o mesmo. Projeto comum (não de vídeo) continua aceitando o Gemini como IA de trabalho.
* Testes `13` (projeto de vídeo separado enxerga nome/descrição/regras da origem; origem inexistente recusada; Gemini
  pedido para o vídeo cai em IA não-Gemini, inclusive ao trocar em Ajustes; projeto comum mantém Gemini) e tela
  (`chat-smoke`: criar projeto no agente Design de Vídeo escolhendo a origem e conferindo o aviso de que o Gemini não é a
  IA de montagem; fotos `4b-projeto-video` e `4c-voz-narracao`).

## Motion Design: animação de código vira vídeo, sem Veo (2026-11-17)

* Capacidade chamável de QUALQUER projeto (não é um modelo à parte): a IA escreve uma ANIMAÇÃO em código
  (`motion/<nome>/index.html`, HTML/CSS/JS, um arquivo; declara `window.__motionSegundos` e seta `window.__motionFim`);
  a ferramenta `nivoo-renderizar-motion` abre a página num navegador sem tela (Playwright recordVideo), grava e converte
  para mp4 em `midia/saida/<nome>.mp4`, com a duração cortada no tempo pedido. SEM Veo e SEM custo de vídeo.
* Fluxo no planejador: etapa de IA escreve a animação → etapa `local-shell` renderiza → `juntar-videos` soma música,
  legenda e junta com outras cenas. O Veo fica só para filmagem realista; animação/apresentação prefere Motion Design.
* A animação (código) fica no git (reutilizável); o vídeo pesado vai para `midia/` (fora do git). Teste `26` (anima →
  renderiza → baixa, 2 s/640x360; index.html no git, mídia não).
* Próximo incremento: VOZ (locução por texto) pela Gemini, para o Motion ganhar narração além de música e legenda.

## Modo edição de vídeo, etapa 3: a IA analisa o vídeo e sugere cortes (2026-11-17)

* Ferramenta `nivoo-analisar-video <video> --pasta out/analise/<nome>` (ffmpeg, grátis): extrai 1 quadro/s (reduzidos para a
  IA ler barato) e aponta trechos ESCUROS (blackdetect), SILÊNCIOS (silencedetect) e CORTES DE CENA (select scene), com os
  tempos, em `resumo.md` + `dados.json`. Caminhos `midia/...` resolvem na pasta de mídia do projeto (`NIVOO_MIDIA_DIR`).
* As etapas `local-shell` e a conferência recebem as ferramentas no PATH (`PASTA_FERRAMENTAS`) e `NIVOO_MIDIA_DIR`.
* Fluxo (no planejador): etapa `local-shell` roda a análise; depois uma etapa de IA ABRE os quadros + o resumo e escreve
  `out/analise/<nome>/sugestoes.md` com cortes concretos; o usuário aprova e só então vem a edição com `juntar-videos`.
  Assim a IA "vê" o vídeo por quadros + os apontamentos (sem assistir o filme), gastando centavos.
* Teste `26` (análise aponta o trecho escuro e o silêncio e extrai os quadros). Transcrição da fala (voz→texto) fica para
  um próximo incremento (via Gemini quando conectado).

## Modo edição de vídeo, etapa 2: enviar vídeo pelo app e mídia fora do git (2026-11-17)

* O usuário **arrasta o vídeo na conversa** e ele sobe por **streaming** (não pelo anexo base64, que trava em arquivo
  grande): `POST /projects/:id/videos` grava direto em disco com limite `NIVOO_MAX_VIDEO_MB` (2 GB). Barra de progresso no
  chat; o vídeo vira um chip "para editar".
* **Mídia fora do git**: os vídeos (enviados e editados) ficam em `<projeto>/midia/` — `entrada/` e `saida/` —, nunca no
  repositório (vídeo é pesado) nem na sessão da IA. O provider `juntar-videos` resolve `midia/...` nessa pasta durável
  (`ExecutionRequest.projectMediaDir`); o vídeo editado sai em `midia/saida/<nome>.mp4`. Download por `GET /midia/content`.
* O **planejador lista** os vídeos enviados (`midia/entrada/...`, nome e tamanho) para a IA referenciar em `cenas`, e
  orienta: editar o que o usuário enviou, salvando em `midia/saida/`, sem Veo.
* API: `GET /projects/:id/videos`, `POST /projects/:id/videos` (streaming), `DELETE /projects/:id/videos/:id`,
  `GET /projects/:id/midia/content`. Testes `26` (enviar por streaming → editar → baixar; nada de mídia no git) e tela
  (`chat-smoke`: arrastar vídeo vira chip e não vira anexo; foto `9a2-video-para-editar`).
* **Robustez do envio (2026-11-17):** a contagem de bytes/limite virou um `Transform` DENTRO do pipeline (respeitando a
  contrapressão) — antes um `on('data')` por fora punha o fluxo em modo corrente e, atrás de um proxy, podia perder
  pedaços e salvar o vídeo com **0 byte**. Corpo vazio agora é recusado com a dica de liberar o tamanho no proxy (nginx
  `client_max_body_size`, Cloudflare 100 MB — ver `docs/OPERACAO.md`), e `listarVideos` **ignora restos de 0 byte** para
  não confundir a IA nem a tela. Teste `26` (upload de ~6 MB chega inteiro; corpo vazio recusado; resto de 0 byte some).
  Um teste real de HTTP de **50 MB** por streaming grava o arquivo inteiro: o código está certo; o 0 MB em produção é o
  **proxy/túnel na frente** (precisa liberar o tamanho do corpo), não o Nivoo.
* **Enviar em lote (.zip) e achar o que foi jogado na mão (2026-11-17):** além de arrastar vídeos soltos, dá para mandar
  um **.zip** pelo chat — `POST /projects/:id/videos/zip` (streaming) extrai **todos os vídeos de dentro** (em qualquer
  subpasta) com `yauzl`; o nome em disco é um id gerado (sem "zip-slip"), com limites por vídeo, total e quantidade, e
  ignora não-vídeos e o lixo do macOS. E um botão **"Procurar vídeos que coloquei no servidor"**
  (`POST /projects/:id/videos/importar-da-pasta`) varre a pasta do projeto (menos `repo/`/git) e **move** para
  `midia/entrada` os vídeos colocados por SCP/FTP; a tela mostra o caminho exato (`<workspacePath>/midia/entrada`). Teste
  `26` (zip com 2 vídeos + 1 não-vídeo em subpasta extrai os 2; zip sem vídeo recusado; varredura pega os soltos e pula
  o do `repo`).
* **Critério final acha a mídia (2026-11-17):** como a mídia fica FORA do git (`<projeto>/midia/`), um critério
  `FILE_EXISTS` com caminho `midia/...` passou a resolver na **pasta do projeto**, não na cópia do repositório
  (worktree); os `COMMAND` finais recebem `NIVOO_MIDIA_DIR`. Antes, o vídeo era montado (trilha + locução + legenda) mas
  o trabalho ficava **BLOQUEADO** dizendo que `midia/saida/<nome>.mp4` "não existe". Teste `26` (edição com critério
  `FILE_EXISTS` sobre `midia/saida/final.mp4` conclui o trabalho).
* **Aviso de limite no envio:** quando o upload de um vídeo falha, a conversa mostra um aviso de que provavelmente é
  **limite de tamanho** do servidor/proxy, sugerindo mandar um **.zip**.

## Montagem de vídeo: áudio junto, vídeo no tamanho do áudio, player e tamanhos certos (2026-11-17)

Vários defeitos reais numa montagem de Reel, corrigidos:
* **Música + narração montadas JUNTAS** (antes eram dois passos que brigavam na duração). O vídeo pode **não ter áudio
  próprio** (uma prévia pronta, só imagem): a música/voz viram a trilha. O vídeo final tem o **tamanho do áudio** — se a
  narração passar do vídeo, o sistema **segura o último quadro** (`tpad`) até a fala acabar, em vez de cortar pela metade.
  A música enche o vídeo inteiro (loop + fade) e abaixa sob a voz (ducking).
* **Fluxo recomendado para quem já tem o vídeo pronto:** usar o vídeo inteiro como **única cena** e só somar trilha e/ou
  narração — não cortar em pedaços. O planejador orienta isso; com narração, a legenda é curta/opcional.
* **Player do chat** passou a abrir a mídia por `/midia/content` (fora do git), não por `/files/content` — antes dava
  "Não foi possível abrir" no vídeo final.
* **Tamanhos pequenos mostram KB** (não "0 MB" arredondado): arquivos de ~200 KB apareciam como "0 MB" na tela e para a
  IA, que concluía que os vídeos estavam "vazios". Corrigido na tela e no contexto do planejador.
* Teste `26` (prévia SEM áudio + narração mais longa → ganha som e o vídeo é esticado até o fim da fala; os casos de
  trilha e narração continuam verdes).

## Trocar o agente (área) de um projeto (2026-11-17)

* Em **Ajustes → "Agente do projeto"**, um seletor migra o projeto para outro agente. `PATCH /projects/:id` passou a
  aceitar `base` (slug do agente): muda só **quais regras da base valem** daqui para a frente; a **pasta** do projeto
  (`dirKey`), os **arquivos**, a **memória**, o **histórico** e as **regras próprias** continuam. Migrar para um agente de
  vídeo (`design-video`/`video-veo`) também **tira o Gemini da montagem** (ver seção acima). Agente inexistente é recusado.
* Teste `13` (migrar `geral`→`design-video` mantém regras e pasta e troca a IA de montagem; voltar para `geral`; agente
  inexistente recusado) e tela (`chat-smoke`: migrar o projeto de vídeo para outro agente pelo seletor).

## Modo edição de vídeo, etapa 1: recorte e velocidade por clipe (2026-11-17)

* A mesma etapa do sistema `juntar-videos` (ffmpeg, SEM IA e SEM custo) passa a EDITAR, não só juntar cenas geradas pelo Veo:
  `cortes:[{inicio,fim,velocidade}|null]` alinhado com `cenas` corta início/fim (segundos) e acelera/desacelera (0.25–8)
  cada clipe; reordenar = mudar a ordem de `cenas`. Junção, transições, legendas e trilha continuam como antes.
* Validado em `opcoesDeJuncao` (início ≥ 0, fim > início, velocidade 0.25–8). O planejador ganhou a orientação de EDIÇÃO:
  para "editar o que já tenho", use `juntar-videos` com `cortes`, NUNCA gere com o Veo (o Veo só para um trecho novo pedido).
* Teste `26` (corta um clipe para [1,3] e acelera outro 2x; a duração final confere, ~4 s em vez de ~9 s).
* Próximas etapas (em construção): upload de vídeo pelo app por streaming (arquivo grande) com a mídia fora do git; a IA
  analisar o vídeo por quadros + transcrição e sugerir cortes.

## Token de registro privado: 401 para na hora e vai nas Variáveis da conferência (2026-11-17)

* **Caso real (financas-pessoais)**: depois da cura do `npm ci`, o `npm install` do `admin-panel` levou `401 Unauthorized`
  do registro privado `git.nivoo.dev.br` ao baixar `@studio-ux-ds/components` — o `.npmrc` usa `${GITLAB_PACKAGE_TOKEN}`,
  que a conferência não tinha. A IA diagnosticou certo (não mexeu na credencial), mas o sistema insistiu 6 sessões (US$ 3,19).
* **Para na primeira** (`faltaCredencial`): 401/403 num registro de pacotes (npm/yarn/pnpm/pip) é falta de token, que
  nenhuma sessão resolve. Bloqueia na 1ª conferência com `VERIFICACAO_IMPOSSIVEL` e a mensagem explica que falta o token e
  manda guardá-lo em Ajustes → "Variáveis da conferência".
* **Variáveis da conferência (por projeto)**: tokens/segredos que a instalação e os testes precisam. O valor pode ser
  DIGITADO (cofre 600, `confenv:<projectId>:<NOME>`) ou APONTAR para o token de uma conta Git já conectada
  (`confref:<projectId>:<NOME>` guarda o id da conta; o token é lido dela na hora — útil quando o projeto é do GitHub mas o
  registro de pacotes é do GitLab, ou o contrário). Nunca no banco, no git nem na sessão da IA; entram SÓ no
  `ambienteDaConferencia`. A tela (Ajustes) mostra os nomes e a origem ("guardado" ou "token da \<conta\>"), nunca o valor.
  API `GET/POST /projects/:pid/conferencia-env` (POST com `contaId` usa a conta; com `valor:null` e sem `contaId` apaga).
  Apagadas ao excluir o projeto.
* Testes `32` (401 para na 1ª e cita "Variáveis da conferência"; o valor digitado e o token da conta Git chegam à
  conferência com o valor certo, nunca ao prompt da IA; a API só devolve nomes) e tela (`chat-smoke`: guardar, chip sem o
  valor, apagar).

## "npm ci" sem lockfile não trava mais o trabalho (2026-11-16)

* **Caso real (financas-pessoais, ChatGPT/Claude)**: a conferência das etapas usava `npm ci`, e o projeto não commita
  `package-lock.json`. O `npm ci` aborta com `EUSAGE` antes de testar; a IA diagnosticou certo (não inventou lockfile,
  não mexeu no comando), mas não tinha como resolver, e o trabalho repetiu 6 vezes e travou (US$ 1,57 à toa).
* Agora a conferência **se cura sozinha** (como já fazia com o cache do corepack): quando o comando usa `npm ci`
  (ou `--frozen-lockfile`/`--immutable`) e falha por falta de lockfile (`semLockfile`), o sistema refaz a conferência
  trocando `npm ci` por `npm install`, uma vez, e registra "o projeto não tem package-lock.json… refiz com npm install".
  Não é falha do código, então não gasta sessões da IA.
* O **planejador** também deixou de sugerir `npm ci`: a regra e os exemplos passam a usar `npm install`, e `npm ci` só
  quando o `package-lock.json` está entre os arquivos do projeto.
* Teste `32` (npm de mentira: `npm ci` sem lockfile falha, `npm install` cria o lockfile e passa; cura numa conferência,
  uma tentativa só).

## Pausar/Continuar trabalho e ditado por voz (2026-11-16)

* **Pausar**: o "parar" (interromper) virou **Pausar** por completo (`POST /jobs/:jid/pause`, motivo `PAUSADO`; o
  `interrupt` saiu). Para na hora e guarda tudo (arquivos, notas, checkpoint); a tela mostra "Pausado por você. Tudo o
  que foi feito está salvo." (em amarelo, não é erro) com **Continuar** (e "Continuar com" outra IA). "Continuar" logo
  depois de "Pausar" espera a sessão da IA terminar de fechar (até `NIVOO_ESPERA_ENCERRAR_MS`, 20 s) em vez de recusar —
  nunca duas sessões no mesmo trabalho. `INTERROMPIDO` fica só para o sistema (projeto sendo excluído). Ajustes →
  "Trabalhos em andamento" também pausa. Testes `04`, `12` e tela (`chat-smoke`, foto `6c-pausado`).
* **Ditado por voz**: microfone ao lado do Enviar; a fala vira texto na caixa (pt-BR) pelo reconhecimento do próprio
  navegador (Chrome, Edge, Safari) — não gasta a IA do projeto; o texto aparece enquanto fala e dá para corrigir antes
  de enviar; recomeça sozinho depois das pausas até clicar de novo; para ao enviar. Firefox não tem: o botão explica
  (Chrome/Edge/Safari ou o microfone do teclado do celular). Microfone bloqueado, sem internet ou sem microfone: aviso
  claro. Ícone Tabler "microphone". Tela (`chat-smoke`, reconhecimento simulado; foto `9f-ditado`).

## A IA sabe que a pasta é o repositório do projeto (2026-11-16)

* **Caso real (IA Studio, ChatGPT)**: pedido de auditoria; a IA parou ("a sessão está numa cópia Linux e o Git diz que não
  é um repositório; a regra exige a pasta original em C:\Users\...\IA STUDIO"), depois pediu autorização para usar o
  GitHub e por fim o endereço do repositório — que já estava ligado ao projeto e em dia (0 a enviar, 0 a receber). A
  conversa roda numa cópia sem `.git` (`git archive main`) e nada dizia isso à IA, nem que a pasta é o repositório.
* Agora toda conversa e toda etapa recebem "## Repositório do projeto" (`src/git/contexto-git.ts`): esta pasta É o projeto
  (main, último commit), ligada a `<url>` (branch), estado da última consulta (em dia / N commits a receber → "Atualizar
  do Git"), sem pedir endereço, autorização nem baixar de novo; na conversa, "not a git repository" é esperado e o
  histórico vai em `contexto/historico-git.txt`; caminhos de outra máquina (C:\Users\..., /home/...) nas regras, memória
  ou pedido são este mesmo projeto — nunca parar por isso. Endereço sem usuário/senha.
* Testes: `15` (etapa e conversa de projeto ligado: texto, histórico) e real `real-12` (ChatGPT, regra "pare se não estiver
  em C:\Users\..."; respondeu com o plano da auditoria em 35 s, sem bloquear nem pedir nada).

## Menu de projetos: "+" na linha do projeto e "Arquivados" no rodapé (2026-11-16)

* Pedido do usuário: os links soltos "conversas arquivadas" (dentro do projeto) e "projetos arquivados" (no fim da lista)
  e o "+ Nova conversa" em texto deixavam o menu bagunçado.
* Agora: o projeto aberto mostra só as conversas ativas, recuadas; o **"+"** (ícone Tabler, MIT) na linha do projeto abre
  uma conversa nova — e, se já há uma "Nova conversa" vazia, abre essa (`reaproveitarVazia`), sem acumular conversas em
  branco. **"Arquivados"** é um botão só, no rodapé do menu: abre uma janela com projetos e conversas arquivadas (Abrir,
  Desarquivar e, na conversa, Excluir). Projeto arquivado aberto aparece no topo do menu como "Arquivado (aberto)"; a tela
  do projeto acompanha quando ele é desarquivado pela janela.
* API: `GET /arquivados` substitui `?arquivados=1` (projetos) e `?arquivadas=1` (conversas), removidos por completo.
* Testes: `13` (lista de arquivados, "+" reaproveitando a conversa vazia) e tela (`chat-smoke`: "+", janela Arquivados
  com desarquivar e excluir, projeto arquivado; fotos `9-arquivados`, `9d-menu-projetos`, `9e-projeto-arquivado`).

## Telas no padrão do próprio sistema (2026-11-16)

* **Caso real (ctrl-leads)**: a IA criou "Atendimento e retenção" como um cartão largo solto na aba Integrações (conteúdo
  estreito, botão Salvar no meio, vazio sem função) em vez de uma aba de configurações, e a tela de Atendimento dentro do
  cliente pedia de novo o "Cliente" (título e caminho no topo perdiam o cliente). A lente de interface do Studio Workflow
  já condena isso ("não inventar um layout novo", componente/padrão local, cartão solto, vazio sem função), mas nada a fazia
  valer — e a foto provavelmente só cobria a tela inicial, sem login.
* Agora (`TEXTO_PADRAO_DAS_TELAS`, no plano e em toda sessão): antes de criar/mudar tela, a IA acha a tela IRMÃ existente
  e segue o mesmo padrão, e diz no plano qual é a referência; não pede de novo o que a navegação já escolheu; toda tela
  mudada tem foto nos dois tamanhos por roteiro com login de teste, junto com a irmã de referência.
* A revisão compara com as telas irmãs (PADRÃO LOCAL) e aponta como violação: cartão desproporcional, botão solto, CONTEXTO
  REPETIDO e tela alterada SEM foto. Teste em `13`.

## Correção não para enquanto avança; testes de interação do projeto rodam na conferência (2026-11-16)

* **Caso real (ConnectChat)**: o trabalho parou com testes (57, 34 com PostgreSQL), build, fotos e roteiros passando; a
  revisão cobrava "respostas atrasadas durante a troca de sessão" — e o teste que a IA escreveu para isso
  (`scripts/nivoo-interacoes.mjs`) ficava **fora** da conferência: nada o executava e a correção não tinha como incluí-lo.
  A IA não tinha como satisfazer a revisão; as rodadas fixas (3) acabavam e o trabalho parava.
* **Sem teto de rodadas** (`NIVOO_CORRECOES_MAX` é só um teto opcional; 0 = sem teto, o padrão). Enquanto a cobrança
  muda (avanço), a correção continua. A **mesma** cobrança de novo: a rodada seguinte avisa "é a Nª vez seguida… MUDE A
  ABORDAGEM" e passa para outra IA conectada (reservas do projeto, depois as que já trabalharam no trabalho). Só espera o
  usuário quando a mesma cobrança volta idêntica depois de **3 correções seguidas** (girar só gastaria). A contagem
  recomeça a cada intervenção do usuário ("Tentar de novo" ou resposta na caixa da revisão).
* **Testes de interação do projeto na conferência**: `nivoo-conferir-telas` roda, com o sistema ligado, os roteiros
  `nivoo-roteiros/*.json` e também os scripts `nivoo-roteiros/*.cjs|*.mjs` (duas abas, mensagens chegando, troca de sessão
  no meio de um envio…), com `NIVOO_BASE_URL`, `NIVOO_PLAYWRIGHT` (`require`) e `NIVOO_PLAYWRIGHT_MJS` (`import`); relatório
  em `out/telas-interativas/scripts.md`; código ≠ 0 = falhou; limite `NIVOO_ROTEIRO_SCRIPT_SEG` (600 s).
* **Rede lenta ou com erro nos roteiros**: `{"atrasar":"/api/mensagens","ms":4000}`, `{"falharRede":"/api/anexos"}`,
  `{"liberarRede":true}` (texto = "o endereço contém"; com `*` = glob do Playwright).
* IA, revisora e correção sabem disso: teste fora de `nivoo-roteiros/` não roda e não vale como evidência (a violação diz
  para movê-lo); a IA não pergunta ao usuário como rodar conferências.
* **"Perguntas para você" sem lixo**: o arquivo `out/perguntas-ao-usuario.md` dizendo "Nenhuma pergunta em aberto" (e
  itens assim na revisão) não vira pergunta; o título do arquivo sai.
* Testes: `13` (mesma cobrança: 3 correções, a 2ª e a 3ª mudando a abordagem, e para; "Tentar de novo" recomeça; 7
  cobranças diferentes = 7 correções até concluir), `32` (rede lenta/erro, scripts .cjs/.mjs passando e falhando),
  `unit/revisao-perguntas`, real `real-11`: o ChatGPT (Codex) corrigiu a troca de sessão com resposta atrasada, planejou a
  conferência com `nivoo-conferir-telas`, pôs o teste em `nivoo-roteiros/resposta-atrasada.cjs`, a revisão aprovou de
  primeira e um roteiro independente com a resposta da Alfa atrasada 2,5 s passou na pasta principal (computador e celular).

## Leitura robusta da resposta da IA (2026-11-16)

* **Bug real (ctrl-leads)**: a entrega da v0.17.39 virou só "[A resposta da IA veio com o plano quebrado…]". O leitor
  cortava o JSON no primeiro fechamento de bloco de código — e a entrega tinha um bloco de comandos do servidor DENTRO
  do texto. Agora o JSON final é lido pela estrutura (chaves, aspas, escapes), do último bloco para trás; quebra de
  linha/tabulação soltas e vírgula sobrando são consertadas; a resposta principal precisa ser `tipo` resposta/plano
  (um item de memória não é confundido com ela). Sem conserto, o texto da resposta é recuperado e a resposta original
  vai para o registro de erros (diagnóstico). Teste `unit/resposta-da-ia`.

## Ajustes de uso real: conferência visível, rolagem, prévia durante trabalho, limite da IA (2026-11-16)

* **Conferência visível**: a conferência (instalar, testar, compilar) registra quando começa, a última linha da saída a
  cada 15 s e "ainda rodando" a cada minuto (`NIVOO_CONFERENCIA_AVISO_MS`); a tela mostra "conferindo há N min — …"
  em vez de "Sem novidade há 18 min". Critérios finais também registram quando rodam. O botão de diagnóstico aparece
  também durante o trabalho.
* **Conversa abre no fim**: ficava parada no meio porque partes que carregam depois (progresso, arquivos, resultados,
  imagens, cartões) empurravam o fim. Agora fica grudada no fim enquanto carrega, a não ser que a pessoa role para
  cima. Tela (`chat-smoke` confere a distância do fim ao abrir).
* **Prévia durante um trabalho**: a mensagem explica que a prévia mostra a pasta principal e que o trabalho em
  andamento entra nela ao concluir; o botão "Pedir à IA" some enquanto há trabalho rodando. Teste em `33`.
* **Limite da IA**: "You've hit your 5-hour limit" (e semanal, "limit · resets") não era reconhecido como limite — a
  sessão era refeita na hora. Agora vira IA indisponível (espera a renovação ou passa para a IA reserva). O aviso de
  rotina do Claude sobre limite ("rate_limit_event") não aparece mais como código: só "perto do limite"/"limite
  atingido", com a hora em que renova. Teste `unit/limite-da-ia`.

## Fotos das telas pela conferência (2026-11-15)

* `apps/backend/bin/nivoo-fotos` (no PATH das conferências): com o sistema ligado, tira foto de cada tela pedida no
  computador (1366×900) e no celular (390×844) e registra erro de script, erro no console, arquivo que não carrega
  (4xx/5xx), tela em branco e página mais larga que o celular; grava `out/telas/*.png` + `relatorio.md`/`.json`
  (resultados do trabalho; abrem como imagem na tela). `--exigir-sem-erros` faz a conferência falhar com o problema.
  A IA não navega: a sessão seguinte é orientada a ABRIR as fotos e corrigir; a revisão independente abre as fotos e
  trata visual quebrado como violação.
* Navegador sem tela: `playwright-core` (dependência do backend) + Chromium instalado pelo `nivoo update` em
  `/opt/nivoo/navegadores` (`PLAYWRIGHT_BROWSERS_PATH`). Sem ele, a conferência para na hora como problema do servidor.
* **Erro pego pelo ensaio real e corrigido**: as IAs punham "aprovação manual do visual" e o trabalho ficava esperando
  o clique do usuário (a regra do plano mandava usar aprovação manual para "estética"). Agora aprovação manual só quando
  o usuário pede; visual é conferido pelas fotos e pela revisão.
* As fotos são conferidas CONTRA as regras de interface do modelo do projeto (no Studio Workflow, a disciplina
  "Composição e integridade de interface", `doctrine/disciplines/visual-interface-quality.md`). Checagens automáticas
  extras: acentos quebrados ("SÃ£o" — falta `<meta charset="utf-8">`) e, com `--sem-emoji-em-controles`, emoji usado
  como botão/ícone (regra do Studio). O que depende de interação (foco, digitação, teclado) não aparece em foto: fica
  para os testes do projeto e a revisão.
* Testes: `32` (ciclo página larga → corrige → passa) e real `real-09` — Claude e ChatGPT reais corrigiram um site
  quebrado no celular, planejando sozinhos a conferência com `nivoo-fotos`, e concluíram sem pedir nada.

## Painéis recolhíveis e prévia do projeto em tela dividida (2026-11-15)

* **Painéis**: a lista de projetos recolhe para a esquerda (faixa fina com ☰ e +); o painel Memória/Arquivos/Git/
  Ajustes recolhe e as abas ficam na barra de cima (abrem o painel direto nelas). Lembrado no navegador.
* **"Ver o projeto"**: divide a tela — conversa de um lado, o site/sistema do projeto rodando do outro (computador ou
  celular, recarregar, atualizar versão, nova aba, desligar). Abrir a prévia recolhe o painel.
* **Como roda** (`src/previa/previa.service.ts`): numa cópia da pasta principal (`<projeto>/previa`); site
  (`index.html` na raiz, public/, dist/, build/, site/, docs/, www/) servido direto, com rotas de página única; sistema
  (`package.json` com dev/start, ou `nivoo-previa.json` na raiz: tipo, pasta, instalar, comando com `$PORT`, caminho)
  instalado e ligado numa porta livre com banco de teste próprio (`previa_<id>`); desliga sozinho após 2 h sem uso
  (`NIVOO_PREVIA_OCIOSA_MIN`); excluir o projeto desliga. Erro mostra o registro e "Pedir à IA para arrumar a prévia".
* **Portão da prévia**: servidor HTTP próprio (`NIVOO_PREVIA_PORT`, padrão 3100, só 127.0.0.1) com código aleatório em
  cookie, encaminhando HTTP e WebSocket; publicado em endereço PRÓPRIO (`NIVOO_PREVIA_URL`) — o sistema roda na raiz
  (rotas funcionam) e não alcança o token do Nivoo. `nivoo dominio` cria `previa-<endereço>` no mesmo túnel da
  Cloudflare; para quem já tem domínio, o `nivoo update` cria sozinho (`nivoo dominio previa`).
* Plano orientado a criar `nivoo-previa.json` quando a detecção não basta. Testes: `33-previa` (site, sistema com
  WebSocket, desligar, projeto vazio) e tela (`chat-smoke`, fotos `7d-paineis-recolhidos`, `7e-previa-tela-dividida`).

## Ver o sistema rodando na conferência (2026-11-15)

* A conferência pode ligar o sistema do projeto numa porta livre (`NIVOO_PORTA_TESTE`), esperar responder e conferir
  com `curl` (página, API, /health) — sem navegador. O plano e as sessões recebem o exemplo.
* **Bug corrigido**: uma conferência que ligava um servidor em segundo plano ficava parada até esgotar o tempo (o
  servidor segurava a saída). Agora, quando o comando principal termina, o sistema desliga tudo o que ele ligou
  (`encerrarGrupoAoSair`) e segue. Vale para conferências das etapas e critérios. Teste em `32` (2,7 s; antes 30 min).

## Banco de teste descartável por trabalho (2026-11-15)

* Testes de integração dos projetos (ex.: os 28 do ConnectChat com PostgreSQL) eram pulados: o servidor não oferecia
  banco de teste. Agora cada trabalho ganha um PostgreSQL vazio só dele (`teste_<id>`), criado na primeira conferência
  e apagado quando o trabalho termina (concluído, parado ou com falha). Nas conferências e nos critérios,
  `DATABASE_URL_TEST`, `TEST_DATABASE_URL`, `DATABASE_URL` e `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` apontam para
  ele; o plano e as sessões são orientados a incluir os testes com banco.
* Instalador: usuário `nivoo_testes` (só cria bancos; não é superusuário; `REVOKE CONNECT` no banco do Nivoo para
  PUBLIC) e `NIVOO_TESTES_PG_URL` em `/etc/nivoo/nivoo.env`. Validado: o usuário de testes não entra no banco do
  Nivoo; cria banco, extensão (`pgcrypto`) e tabelas e apaga no fim. Teste em `32`. `src/common/banco-de-teste.ts`.

## Perguntas da IA com opções de clicar (2026-11-15)

* Quando a IA da conversa (ou da entrega) precisa de uma decisão do usuário, ela manda `perguntas`: de 1 a 4 perguntas,
  cada uma com 2 a 4 opções (rótulo + descrição, a recomendada primeiro, `multipla` opcional). A tela mostra cartões
  para clicar, "Outra" para escrever e "Enviar respostas" (só com todas respondidas), que vira a mensagem do usuário;
  depois de respondido, os cartões ficam marcados como respondidos. Coluna `ConversationMessage.perguntas` (migração
  `20261115160000_perguntas_com_opcoes`); validação em `normalizarPerguntas`.
* **Perguntas e plano nunca juntos**: com pergunta que bloqueia, a IA responde só com as perguntas e manda o plano
  depois das respostas; se ela mandar os dois, o sistema segura o plano ("Depois das suas respostas, eu mando o plano")
  — antes aparecia um "Fazer" que ignorava as respostas. Teste em `31`.
* Testes: `31` (validação), tela (`chat-smoke`, foto `7c-perguntas-com-opcoes`) e real `real-08` — Claude e ChatGPT
  reais perguntaram com cartões (texto curto, opções com a recomendada primeiro).

## Versão do projeto: padrão do usuário e etiqueta = arquivo (2026-11-15)

* **Bug real (ConnectChat)**: a IA subiu para 0.11.95 olhando o CHANGELOG (parava em 0.11.94), mas o Git já tinha
  etiquetas até v0.12.1; o Nivoo publicou v0.12.2 — número dentro do projeto e etiqueta diferentes.
* Agora o plano e toda sessão recebem "Versão do projeto": a versão nos arquivos (package.json, pyproject.toml ou
  VERSION), a última etiqueta do Git e a PRÓXIMA exata; a etiqueta publicada é a do arquivo.
* **Padrão de versão (todos os projetos, definido pelo usuário)**: 0.X.Y, cada casa de 0 a 99, sempre a próxima da
  sequência a partir da maior entre arquivo e etiqueta: 0.11.99 → 0.12.0; 0.99.99 → 1.0.0. Nunca pular nem voltar.
  `src/git/versao.ts` (`proximaNoPadrao`, `calcularVersao`), usado no plano, nas sessões e na etiqueta automática.
  Testes `unit/versao` e `15`.

## Ensaio real ponta a ponta com Claude e ChatGPT (2026-11-15)

* `test/integration/real-07-ensaio-ponta-a-ponta` (opt-in `NIVOO_RUN_CLI_INTEGRATION=1`, IA em `NIVOO_ENSAIO_IA`):
  projeto trazido de um repositório Git (pnpm, testes `node --test`, build) com um bug, um arquivo morto e sem
  CLAUDE.md; pedido em duas partes pelo chat → plano → "Fazer" → conferências com `npm test && npm run build` →
  revisão → entrega. Confere na pasta principal: testes passando, bug corrigido, arquivo apagado, CLAUDE.md, versão
  e CHANGELOG, nada de node_modules, entrega sem pedir nada ao usuário, sem "(sem resposta)", etiqueta = versão.
* **Resultado**: Claude (Claude Code) e ChatGPT (Codex) concluíram de primeira (uma sessão por etapa, memória com 1–2
  itens, entrega sem perguntas).
* **Erro pego pelo ensaio e corrigido**: a etiqueta do Git ignorava a versão do projeto ("Versão v0.1.0 enviada"
  com o package.json em 0.4.0). Agora a etiqueta é a versão declarada (`package.json`, `pyproject.toml` ou `VERSION`)
  quando ela ainda não tem etiqueta; sem subir a versão, segue a sequência (v0.4.1). Teste em `15`; confirmado no
  ensaio real.
* **Testes nunca mexem nos logins reais**: remover a conexão do ChatGPT roda `codex logout`; nos testes isso deslogava
  o ChatGPT real da máquina. Agora os testes usam `CODEX_HOME`, `CLAUDE_CONFIG_DIR` e `GEMINI_CLI_HOME` próprios.
* Plano não amarra a IA a um arquivo só, e a sessão corrige a causa quando a conferência falha por algo fora da etapa
  (o primeiro ensaio parou porque o script de teste do exemplo estava errado e o plano proibia mexer nele).

## Ferramentas de projeto no servidor e falha de ambiente (2026-11-15)

* **Bug real (ConnectChat)**: a etapa de versão parou depois de 6 sessões com "Cannot find module
  …/corepack/v1/pnpm/…/pnpm.cjs": o servidor não tinha o pnpm (o projeto usa pnpm), o corepack ficou com o cache
  quebrado, e a IA não tinha como consertar — só anotava a falha, sessão após sessão.
* O instalador (`nivoo update`) instala `pnpm@10` e `yarn@1` globais e refaz o cache do corepack.
* As conferências e critérios rodam com `CI=true` (testes sem modo "watch"), sem perguntas do corepack e sem o pnpm
  trocar de versão sozinho (`npm_config_manage_package_manager_versions=false`).
* Cache do corepack quebrado: o sistema apaga o cache e confere de novo, sozinho.
* Falha do SERVIDOR (corepack quebrado, sem espaço, sem rede para o registro de pacotes): o trabalho para na hora
  (VERIFICACAO_IMPOSSIVEL) dizendo que o problema é do servidor e o que fazer ("nivoo update" e "Tentar de novo"),
  sem gastar sessões da IA. Testes em `32`.

## Auditoria preventiva do fluxo de trabalho (2026-11-15)

Varredura do fluxo inteiro (conversa → plano → etapas → conferências → revisão → entrega → tela) atrás das mesmas
classes de defeito que o usuário encontrou em produção. Corrigido:

* **Erro da conferência pela parte certa**: a saída inteira vai para `.nivoo/ultima-conferencia.txt` (a próxima sessão
  é orientada a ler); o histórico mostra começo + fim do erro (antes só os primeiros 400 caracteres, ruído de
  instalação); a correção do critério final recebe o fim de stdout/stderr.
* **Tempo da sessão esgotado = sessão encerrada**: confere, salva (checkpoint) e continua em nova sessão (antes: falha
  sem conferência e dois tempos esgotados bloqueavam como "repetição").
* **Critérios COMMAND com o mesmo limite das conferências** (30 min; antes 5 min — testes e build estouravam).
* **Repetição comparada sem números/horários/hashes** (saída de teste muda a cada execução; o laço nunca era detectado).
* **Apagar/mover pela IA**: nenhuma IA tinha como apagar (Claude e Gemini sem terminal; Codex orientado a não apagar),
  e a revisão cobrava "código morto". Agora a IA lista em `.nivoo/remover.txt` ("caminho" ou "mover a -> b") e o
  sistema executa ao fim da sessão, antes da conferência; caminhos fora do projeto, `.git/`, `contexto/` e `.nivoo/`
  são recusados e registrados.
* **Saída das IAs guarda o fim** (onde ficam o resultado, o custo e o erro): limite 20 MB por processo, cortando o
  começo (antes guardava o começo de 5 MB e perdia o resultado final em sessões longas).
* **Programa faltando (exit 127)** só bloqueia na hora se for um comando da PRÓPRIA conferência; um `jest` faltando
  dentro de `npm test` a IA corrige.
* **Conversa avisa quando o trabalho para** (bloqueado/falhou), com o motivo.
* **Planner**: resposta vazia por limite de passos vira erro explicado (antes "(sem resposta)"); limite 40 passos;
  plano com JSON quebrado é dito, em vez de mostrar código.
* **Política de ação destrutiva** só sobre o que roda (verificação; instrução de etapa de comando): texto de IA
  com "não use rm -rf" ou achado citando "DELETE FROM" não pede mais aprovação.
* **Erro interno repetido 5 vezes** para o trabalho (FALHA_INTERNA) ou a resposta, com o motivo — antes repetia a cada
  10 s para sempre com o trabalho "executando".
* **Documento de instrução novo** de uma sessão que não concluiu fica guardado entre sessões (antes a limpeza
  apagava); relatório velho da revisão sempre sai antes de a revisão rodar de novo; FILE_EXISTS aceita pasta; a
  revisão vê os arquivos de `out/`; `.venv`, `coverage`, `.nyc_output` entram na limpeza e no ignore; vídeo usa
  padrões (fade, sem legenda) em vez de perguntar; tela mostra "conferindo o resultado final" no fim.
* **Ainda em aberto** (registrado, não corrigido): dois trabalhos da mesma conversa ao mesmo tempo podem conflitar ao
  integrar (o "Tentar de novo" pede resolução manual); pasta do projeto chamada `contexto/` colide com a pasta de
  contexto do Nivoo; um worker processa um trabalho por vez (mais workers = mais paralelismo); pasta `.claude/`
  pedida de propósito pelo usuário continua sendo removida (segurança).
* Testes: `32-auditoria-preventiva` (tempo esgotado, remoções pedidas, saída da conferência, aviso na conversa,
  política) e os anteriores ajustados.

## Ir até o fim: testes pelo sistema, seguir sozinho, menos perguntas, limpeza (2026-11-15)

* **Problema real (ctrl-leads)**: a entrega dizia "não rodei nenhum teste" e pedia ao usuário para rodar `npm run
  test:upgrade` e `npm run build`, religar processos e atualizar o servidor; terminava a "parte A" e parava, com uma
  lista de perguntas. Causas, todas do Nivoo: (1) a regra do plano PROIBIA `npm`/`node`/`python` nas conferências;
  (2) a IA Claude roda sem terminal (segurança), então só a conferência pode testar; (3) a instrução de entrega mandava
  listar TODAS as decisões como perguntas; (4) a entrega era forçada a ser só relatório.
* **Testes e build pela conferência**: etapa que muda código confere com os testes e o build reais do projeto
  (instalando dependências); se falhar, a IA recebe o erro (até 4000 caracteres) e corrige até passar. Conferência
  com até 30 min (`NIVOO_VERIFY_TIMEOUT_SEC`, antes 2 min).
* **Seguir sozinho**: plano com `"continuacao": true` (a próxima parte de um pedido já aprovado pelo usuário, ou a
  continuação depois das respostas dele) começa sozinho, aprovado por "Nivoo (seguindo o seu pedido)". A entrega com
  parte do pedido por fazer já traz esse plano. Pedido novo sempre espera o "Fazer"; no máximo `NIVOO_SEGUIR_MAX`
  (8) planos seguidos sem mensagem do usuário; desligável em Ajustes ("Seguir sozinho até terminar", coluna
  `Project.seguirSozinho`).
* **Perguntar pouco**: o que está claro (pedido, conversa, memória, arquivos) a IA faz; decisão reversível com opção
  clara ela decide e conta; pergunta só o que bloqueia, com opções e recomendação; nunca pede ao usuário o que o
  sistema faz (testes, build, arquivos, comandos no servidor quando há SSH). O plano faz o pedido inteiro.
* **Limpeza ao fim de cada trabalho** (concluído, parado ou com falha): `node_modules`, `__pycache__`, `.pytest_cache`,
  `.cache`, `.npm`, `.turbo` saem da pasta do trabalho (só o que o git não versiona) e nunca entram no commit
  (ignorados no git do Nivoo). O log diz quanto foi liberado. Testes `31-seguir-ate-o-fim` e `22`.

## Memória em camadas (2026-11-15)

* **Problema real**: a memória era uma pilha. Tudo caía na mesma tabela e no mesmo painel: notas de progresso de cada
  sessão da IA (dezenas por trabalho), lições de falhas, registro de trabalhos concluídos e as decisões de verdade; e
  o mesmo assunto, ao mudar, virava um item novo.
* **Camadas**: *base* (regras e materiais do modelo — o "organismo"; a IA lê, não altera), **memória do projeto**
  (`camada = PROJETO`: decisões, preferências, fatos e pendências que o usuário disse ou confirmou) e **memória
  interna do processo** (`camada = INTERNA`: notas das sessões, lições, registro de trabalhos — a IA usa, o painel
  mostra só recolhido em "Memória interna do processo").
* **Um item por assunto** (`chave` = título normalizado): o mesmo assunto com conteúdo novo atualiza o item (versão +1,
  a anterior fica no histórico, `?all=1`); conteúdo igual não grava. Vale para a conversa, a API, as respostas às
  perguntas da revisão e as pendências do sistema (envio ao Git, conflito).
* **Onde fica**: o banco é onde se grava (API e worker escrevem ao mesmo tempo, com transação); a cada mudança o
  Nivoo regrava `<projeto>/memoria/MEMORIA.md` (memória do projeto, por seção) e `memoria/interna.md`, na pasta
  definitiva do projeto.
* **O que a IA da conversa guarda**: só decisões concretas, preferências, fatos e pendências combinadas; nunca
  andamento, resumo de trabalho, planos ou suposições; para mudar algo, usa o mesmo título. As sessões de trabalho
  recebem a memória do projeto + as lições + as notas do próprio trabalho (não as de outros trabalhos).
* Migração `20261115140000_camadas_da_memoria`: move notas, lições e registros existentes para a interna e junta
  assuntos repetidos (fica o mais recente; os outros viram histórico). Teste `30-memoria-em-camadas`.

## Resultados do trabalho visíveis e na pasta do projeto (2026-11-15)

* **Bug real (ConnectChat)**: a auditoria gerou relatório, inventário e plano de limpeza em `out/` (resultados do
  trabalho, fora do repositório). Eles ficavam guardados, mas invisíveis: a tela mostrava só os arquivos do
  repositório (`CHANGELOG.md`) e a IA da entrega não conseguia relê-los.
* Agora: o trabalho mostra **"Resultados do trabalho"** (abrir, copiar, baixar; `GET .../jobs/:jid/resultados`);
  ao concluir, os resultados são copiados para a pasta definitiva do projeto,
  `<projeto>/resultados/<data>-<trabalho>-<id>/` (apagada só com o projeto; trabalhos antigos ganham a pasta ao abrir
  os resultados); a IA da conversa recebe os resultados dos trabalhos da conversa em `contexto/resultados/` (entrega e
  pedidos seguintes, ex.: "pode fazer a limpeza") e as etapas de um trabalho novo recebem os dos trabalhos anteriores
  da mesma conversa.
* A barra de andamento mostra só a rodada atual da etapa (antes exibia um erro de horas atrás e o tempo desde a
  primeira sessão de todas as rodadas). Teste em `22`.

## Revisão "não conforme" por dúvida do usuário não trava o trabalho (2026-11-15)

* **Bug real (ConnectChat)**: a auditoria ficou pronta (critérios aprovados), mas a revisora marcava "não conforme"
  só porque faltava o usuário confirmar a lista original de títulos; três correções rodaram sem ter como resolver e
  o trabalho parou. Agora a revisora separa **violações** (o que a IA corrige) de **perguntas** (o que só o
  usuário responde, campo `perguntas`, que não impede `conforme: true`). "Não conforme" sem violação nenhuma não
  gera correções à toa: o trabalho para e mostra as perguntas.
* **Aceitar assim mesmo**: trabalho parado pela conferência final mostra o que a revisão apontou e as perguntas
  (também de `out/perguntas-ao-usuario.md`), com o botão "Aceitar assim mesmo" (`POST .../aceitar-revisao`,
  `GET .../revisao`): fica registrado no relatório quem aceitou e o que estava apontado, os critérios são
  conferidos de novo e o trabalho conclui. Teste em `22`.
* **Responder ali mesmo**: caixa "Sua resposta" + "Responder e continuar" (`POST .../responder-revisao`): a
  resposta vai para `out/respostas-do-usuario.md` e para a memória do projeto (ESPECIFICACAO), a IA do trabalho
  aplica numa etapa nova (`resposta-usuario-N`) e a revisão confere de novo.
* **Perguntas com respostas sugeridas**: a revisão grava `perguntas: [{pergunta, opcoes}]` (2 a 4 opções, a mais
  provável primeiro); na tela cada opção é um botão que preenche a resposta.
* **Memória do pedido**: as sessões recebiam só o resumo do objetivo, então a IA perguntava ao usuário o que ele
  já tinha dito na conversa ("as 16 seções"). Agora cada sessão de um trabalho vindo do chat recebe a conversa
  inteira em `contexto/conversa-do-pedido.md` (mensagens do usuário completas), e revisora e correção são
  instruídas a procurar ali, na memória e em `out/respostas-do-usuario.md` antes de perguntar. Testes em `22` e
  tela (`chat-smoke`, foto `7b-perguntas-da-revisao`).

## CLAUDE.md novo criado pelo trabalho (2026-11-15)

* **Bug real (ctrl-leads)**: o plano pedia para *criar* o `CLAUDE.md` num repositório que não tinha um; o sistema
  tratava o arquivo novo como instrução plantada e o apagava ao fim da sessão ("removidos: CLAUDE.md"), e o
  critério "regra-registrada" falhava. Agora qualquer documento de instrução escrito pela IA (editado ou novo,
  fora de pastas de configuração) entra no trabalho; nas etapas seguintes ele fica fora da pasta durante a sessão
  (cópia em `contexto/repositorio/`) e volta depois, como os da `main`. Pastas `.claude/`, `.codex/`… criadas no
  trabalho continuam removidas. Testes em `15` e `11`.
* A correção automática do critério final agora roda **também com aprovação manual pendente** (antes o trabalho
  ficava bloqueado sem tentar corrigir). Teste em `22`.

## CLAUDE.md do repositório atualizável e Gemini sobrecarregado (2026-11-15)

* **Bug real**: trabalho que precisava registrar uma regra no `CLAUDE.md` do repositório falhava no critério
  ("regra-registrada"): por segurança o arquivo fica fora da pasta durante a sessão e volta do git depois, o que
  também desfazia a atualização pedida. Agora os **documentos** de instrução que o repositório já versiona
  (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`…, fora de `.claude/`, `.codex/`, `.gemini/`) podem ser reescritos pela
  IA: a nova versão entra no trabalho (e na conferência das regras). A IA é avisada no prompt de como fazer.
  Pastas de configuração (hooks, permissões, servidores) continuam sempre removidas/restauradas. Teste em `15`.
* **Gemini sobrecarregado**: quando o Google responde 503, o Gemini CLI repete em silêncio até acabar o tempo
  ("timeout após 300000 ms"). Agora isso é dito como "o Google está sobrecarregado (503)" e tratado como IA
  indisponível (a reserva assume, se houver); a resposta do chat tem até 15 min (`NIVOO_PLANNER_TIMEOUT_SEC`,
  antes 5) e o aviso de tempo esgotado explica o que fazer.

## Vídeo completo e escolha do modelo Veo (2026-11-15)

* **Entrega o vídeo inteiro**: o Veo gera de 4 a 8 s por vez, então o plano com duas ou mais cenas ganha sozinho a
  etapa final "Juntar as cenas no vídeo completo" (executor do sistema `juntar-videos`, ffmpeg, sem IA e sem
  custo). Cada cena é padronizada (tamanho da primeira, 24 quadros/s, H.264 + AAC; cena sem som ganha silêncio)
  e emendada na ordem em `videos/<nome>/<nome>-completo.mp4`. Na conversa aparece primeiro o vídeo completo
  (player + baixar); as cenas ficam recolhidas em "Ver as N cenas separadas". O modelo pronto de vídeo (também o
  já instalado, pelo seed, numa versão nova das regras) e a entrega da IA falam do vídeo completo. Instalador
  inclui `ffmpeg`. Teste `26-video-completo` (ffmpeg real: 1280x720 com som + 640x480 sem som → 5 s 1280x720 AAC).
* **Modelo do Veo**: a lista nunca fica vazia — modelos da chave com nome claro e custo por segundo
  (Veo 3.1, 3.1 Fast, 3, 3 Fast, 2); se o Google não responder, os conhecidos, com o motivo escrito embaixo.
  O seletor do topo da conversa é o modelo de texto (quem conversa e planeja); o do Veo fica em Ajustes → Vídeos.

## Marca "Nivoo Dev AI" (2026-11-15)

Nome do sistema na barra lateral, tela de entrada, tela inicial e título da aba; logo = o arquivo original
enviado pelo responsável (`apps/web/public/logo.png`, sem alteração), também como ícone do navegador.

## Revisão antes da atualização do servidor (2026-11-15)

Revisão independente de tudo o que mudou desde as Conexões (4 revisores, por área) e simulação do
`nivoo update` num banco no estado antigo (conexão "Gemini (conta)", trabalho travado no Gemini, trava de
US$ 5, lições de infraestrutura, projeto ligado ao Git sem versionamento). Corrigido:

* **Git**: nome de tag validado (letras, números, `.`, `-`, `_`; nunca nome de branch — `--force` ou `main`
  criavam uma tag `main` que travava a pasta principal); branch e tag vão juntas (`push --atomic`; falhou →
  a tag local sai); a versão é recalculada se outro trabalho pegou o mesmo número; envio e `fetch` fora da
  trava da pasta principal (só o merge fica sob ela); branch protegida não é mais confundida com "repositório
  à frente"; conta do GitLab com endereço público diferente (external_url) continua valendo depois de criar;
  instruções do repositório (CLAUDE.md…) sempre restauradas, mesmo com a `main` à frente; nomes com acento
  na lista de arquivos do trabalho.
* **Arquivos**: `./.`, `././.git` e parecidos eram aceitos e podiam apagar a pasta do trabalho; agora todo
  caminho é normalizado e conferido de novo já resolvido (apagar/mover, vídeo e anexos colocados no projeto).
* **Conversa**: dois cliques em "Fazer" criavam dois trabalhos (o plano agora é reservado antes); Enter duas
  vezes mandava a mensagem duas vezes (tela e servidor); uma resposta por vez em cada conversa (a entrega
  espera a resposta em andamento).
* **IA reserva**: duas reservas sem crédito trocavam uma pela outra sem parar; quem ficou sem crédito/limite
  fica 30 min fora da escolha. Aprovação de ação destrutiva continua valendo quando a IA troca.
* **Vídeo (Veo)**: falha depois do pedido aceito (demora, 503 ao consultar, download) não registrava custo e
  a nova tentativa pagava outra geração; agora o custo conta na tentativa que pediu e a seguinte retoma a
  mesma geração. 429/5xx ao consultar o andamento não derruba a etapa.
* **Sem limites**: sessões que só anotam progresso, sem mexer em nenhum arquivo, param depois de 8 seguidas;
  limites do trabalho aceitam 0 também na edição.
* **Login do Claude**: o token só é lido com a linha completa (um pedaço da saída podia cortar o token);
  cancelar/desconectar durante a conferência não é desfeito por ela; `401` solto no código ou nos logs do
  projeto não marca mais a conta como "login recusado" (só o canal de erro do CLI conta).
* **Entrada**: chave da Cloudflare já conhecida continua valendo se a busca das chaves falhar; busca única;
  JWT com partes `null` dá 401 (não 500). Login feito enquanto um pedido estava no ar não pede o token de novo;
  página de erro HTML (502 da Cloudflare) vira mensagem legível.
* **Telas**: chave de API recusada não cria conexão duplicada; erro ao criar repositório não fecha o
  formulário; miniaturas e vídeos liberam a memória ao sair.
* **Atualização**: API e worker param antes das migrações (o código velho bloqueava trabalhos com a trava 0);
  a limpeza de lições não apaga mais a lição verdadeira de um passo que também tinha uma de infraestrutura;
  ajuste antigo do Gemini pela conta sai do banco. `nivoo dominio status` sem domínio e túnel existente sem
  credencial no servidor tratados. OCR ausente não recusa PDF que tem algum texto.

## Modelo pronto "Vídeo com IA (Veo)" (2026-11-15)

Já vem instalado. Regras: confere o briefing (objetivo, formato 9:16/16:9, duração, cenas, estilo, falas,
marca) e pergunta o que faltar; uma etapa de vídeo por cena (4–8 s, `videos/<nome>/cena-NN.mp4`),
descrição seguindo o guia (sujeito, ação, cenário, câmera, luz, estilo, falas em português, sons), com
continuidade entre cenas e "negativo"; imagem anexada vira o primeiro quadro; roteiro e total de segundos no
plano. Material: `guia-de-cenas.md`. As cenas ficam em arquivos separados (juntar ainda não é feito).
Teste em `17`.

## Correção — sessões cortadas em 1 segundo (2026-11-15)

Com "sem limite de tempo" (0) no trabalho, o tempo da sessão era calculado como "limite − gasto", que dava
0 e era arredondado para 1 s: toda sessão da IA morria em 1 segundo ("timeout após 1000 ms"). Agora, sem
limite, vale o tempo da etapa. "timeout" também não vira mais lição. Teste em `22` (falha com o código
antigo, passa com a correção).

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
