# NVIDIA NIM — primeiro provedor do pacote de APIs gratuitas

## Conectar no Nivoo

1. Acesse https://build.nvidia.com e entre na sua conta NVIDIA.
2. Abra um modelo de chat disponível e escolha **Get API Key**.
3. No Nivoo, vá a **Conexões → Nova → NVIDIA — chave de API**.
4. Cole a chave no campo protegido. Ela fica no cofre do Nivoo (arquivo do servidor, permissão 0600), nunca no Git.
5. No projeto, selecione **NVIDIA NIM (API)** e escolha o modelo em **Modelos**. O catálogo vem de GET /v1/models; é possível digitar outro ID exato.
6. Para usar como reserva, inclua a conexão NVIDIA nas IAs de reserva do projeto.

## Suporte da primeira integração

- API hospedada: https://integrate.api.nvidia.com/v1/chat/completions (sem GPU NVIDIA no servidor).
- Conversa, planejamento JSON, leitura e edição de textos/código: ferramentas seguras listar_arquivos, ler_arquivo (paginada), escrever_arquivo e substituir_texto.
- Isolamento pelo worktree com bloqueio de caminhos absolutos, symlinks externos, segredo, contexto e .git.
- Modelos e API key por conexão, múltiplas chaves independentes, detecção de 401/429, timeout, cancelamento e contabilização de tokens quando fornecida.
- Comandos bash, MCP, criação de vídeo por IA, imagem e áudio NÃO habilitados neste provedor inicial. O Nivoo continua rodando as conferências das etapas separadamente.

## Limites e segurança

NVIDIA Build oferece endpoints de avaliação sem cobrança inicial conforme elegibilidade e limites da conta. **Gratuito não significa ilimitado nem SLA de produção**; os limites/modelos podem mudar. A API é externa: os trechos do trabalho necessários ao modelo são enviados à NVIDIA. Não inclua dados confidenciais de terceiros sem autorização.

O teste real da chave e de um modelo exige conexão ativa com a NVIDIA. Os testes unitários cobrem o formato de chamadas, os limites e o isolamento sem utilizar a chave do usuário.
