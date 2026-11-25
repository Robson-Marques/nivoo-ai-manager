
# Prévia no domínio do Nivoo, sem reescrever o software

Em `NIVOO_PREVIA_URL=/previa` (comando `nivoo previa`), a interface do Nivoo exibe um navegador Chromium do servidor por meio da API autenticada. A página `/previa/<id do projeto>` contém somente o visualizador Nivoo. O software roda na raiz de seu próprio endereço loopback e preserva navegação, API, cookies, localStorage e build de produção. Não há HTML ou scripts do software na origem administrativa, nem adaptação de caminhos no projeto.

## Uso e limites

- Clique, rolagem, teclado, texto e navegação de volta; computador 1366×900 e celular 390×844.
- Abra a prévia na conversa ou em nova aba; cada visualizador tem contexto independente.
- O navegador só é iniciado quando solicitado. Capturas JPEG são pedidas no máximo a cada 500 ms enquanto a página estiver visível; quatro sessões simultâneas, fechamento ao sair e expiração após inatividade. O processo do software e banco de teste seguem a política existente.
- O proxy local limita tráfego HTTP/WebSocket ao endereço do software. Chromium usa sandbox (sem fallback para --no-sandbox); o instalador permite namespaces na API para esse fim e mantém as outras restrições systemd. O ambiente do navegador não recebe credenciais do Nivoo. Isso não é isolamento completo de código de projeto no sistema operacional: o servidor do software continua executando com o modelo de confiança existente.
- URLs externas, pop-ups, downloads, diálogos nativos e service workers não são suportados nesse visualizador. A imagem interativa não substitui um navegador local para acessibilidade ou ferramentas de desenvolvimento.
- O modo antigo de subdomínio de origem separada continua disponível.
- Nenhuma alteração de DNS, nginx ou Cloudflare necessária. `nivoo update` instala a versão, `nivoo previa` ativa o modo caso ainda não esteja ativado.

## Aceitação

Abrir o projeto e verificar Dashboard, Clientes, CRUD com dados de teste, navegação e recarga. Uma resposta HTTP do processo só indica servidor iniciado; não é evidência de funcionamento do software. O workflow de desenvolvimento e a qualidade do design são responsabilidades distintas desta correção.

## Avaliação antes da incorporação

O painel permite selecionar a versão principal ou um trabalho do próprio projeto que aguarda aprovação subjetiva e tem todas as etapas concluídas. O servidor resolve o commit Git da versão selecionada, faz checkout em cópia descartável e informa a identificação do trabalho e do commit. Não troca a main, não executa no worktree da IA e não aceita trabalho de outro projeto. O banco da prévia é distinto do banco de teste do trabalho; operações na prévia não comprovam nem alteram os dados dos testes automatizados. A sessão é um snapshot: se o trabalho mudar, selecione a versão novamente. A visualização não aprova o trabalho. O critério e a decisão continuam pelo mecanismo existente. A presença da prévia não comprova completude funcional. A versão pendente só pode ser testada se tiver configuração de execução válida.
