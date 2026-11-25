# Prévia por caminho no domínio do Nivoo

Ative em uma instalação atualizada com `nivoo previa`. O comando grava `NIVOO_PREVIA_URL=/previa` e reinicia somente a API. Não muda DNS, Cloudflare, nginx nem portas públicas. O proxy HTTP que já entrega o Nivoo precisa encaminhar /previa e WebSockets à mesma API.

Cada execução recebe uma URL temporária /previa/<sessão>/, revogada ao desligar ou reiniciar. O link não deve ser compartilhado: concede acesso à prévia enquanto ela estiver ativa.

## Compatibilidade
- Sites estáticos com arquivos e rotas relativos.
- Vite detectado automaticamente recebe --base com a base da sessão.
- Servidores próprios recebem NIVOO_PREVIA_BASE_PATH. Use rotas/arquivos relativos ou respeite essa base. Se o servidor precisa receber o prefixo, declare "manterPrefixo": true em nivoo-previa.json.
- Aplicações que exigem cookies de login, localStorage, service workers, URLs absolutas de raiz ou recursos de origem externa podem não funcionar nesse modo. A política é intencional: não afrouxe o sandbox para fazer um software funcionar.
- O modo de subdomínio separado permanece disponível para aplicações que necessitem de uma origem própria.

## Segurança
O modo por caminho usa sandbox de origem opaca tanto no iframe quanto no cabeçalho CSP de todas as respostas da sessão; não encaminha cookies, Authorization ou cabeçalhos do acesso administrativo, filtra cabeçalhos retornados pelo software e limita recursos e redirecionamentos à sessão. A API administrativa rejeita solicitações de origem opaca e solicitações de navegador cross-site sem bearer. Não é substituto de isolamento de origem para aplicações arbitrárias: mantenha a prévia por domínio separado para esse uso.

## Verificação inicial
Depois de `nivoo update` e `nivoo previa`, execute `curl -i http://127.0.0.1:3001/previa`. O retorno esperado sem sessão é 404 com a orientação da prévia, não o HTML da interface principal. Abra o projeto, desligue a prévia antiga e ligue novamente. Não copie a URL temporária nem os tokens em diagnósticos públicos.

- Builds Vite reconhecidos (`vite build` ou `tsc ... && vite build`, chamados ao final do comando de instalação) recebem `--base` automaticamente na cópia da prévia. Isso não reescreve chamadas de API, configurações de roteador nem dependências de armazenamento; esses recursos precisam respeitar a base e o sandbox.
