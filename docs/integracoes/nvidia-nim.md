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


## Catálogo por especialidade (revisão de 22/11/2026)

O [catálogo público NVIDIA](https://build.nvidia.com/models?pageSize=96) tinha **94 modelos** no levantamento, sendo **39 marcados Free Endpoint** e **72 disponíveis para download** (grupos sobrepostos). Foram incluídos no mapeamento 94 itens e suas áreas.

- **Programação e agentes:** 12 modelos habilitados para ferramenta de arquivo conforme confirmação da NVIDIA.
- **Conversa e raciocínio:** chat e análise, distinguindo o que também aceita chamadas de ferramentas.
- **Visão e multimodal:** entender imagens/vídeos não significa gerar imagens/vídeos.
- **Imagens e design:** FLUX, Qwen Image, Stable Diffusion, TRELLIS etc.
- **Vídeo e animação:** Wan Animate, Cosmos3 Nano, 3D Body Pose, Relighting, LipSync, upscaling e detecção sintética.
- **Áudio e idiomas:** ASR, Parakeet, Whisper, Magpie, Chatterbox, voz, redução de ruído e tradução.
- **Documentos e privacidade:** OCR, Parse, GLiNER e elementos gráficos.
- **Pesquisa/RAG:** Embed e Rerank, que NÃO são agentes de código.
- **Dados, ciência e segurança:** Kumo, cuOpt, Evo2, RFD, OpenFold, guardrails e outros.

O catálogo aparece em **Conexões → NVIDIA → Explorar modelos por especialidade**, com filtros por área, tipo de oferta e IDs listados pela conta. Cada item mostra o destino previsto no Nivoo.

**Limitação fundamental:** a lista GET /v1/models não substitui o catálogo Build e não comprova o endpoint de áudio/vídeo/imagem; esses modelos aparecem identificados, mas NÃO são enviados por POST /v1/chat/completions. Ao selecionar o modelo de um projeto, o Nivoo oferece somente modelos com chat e uso de ferramentas confirmados. Os executores de geração de mídia serão conectados depois, individualmente, com API específica confirmada.

Os modelos desconhecidos retornados pela API permanecem classificados conservadoramente e NÃO viram agentes automaticamente, mesmo que o nome inclua AI, Llama ou chat. Status de Free Endpoint vem da referência pública e pode variar. O fato de haver acesso para avaliação não autoriza presumir uso comercial/produção sob essa modalidade.

O catálogo combina os IDs da chave do usuário à referência de modelos, mas a classificação detalhada de novas entradas exige confirmação das capacidades na fonte. A base curada corresponde aos 94 itens documentados em 22/11/2026.

**Multimodalidade:** alguns modelos NVIDIA aceitam imagem, vídeo ou áudio de entrada, mas o adaptador de agente do Nivoo nesta etapa envia prompts de texto. Essa parte só ficará operacional quando o transporte de mídia for conectado e validado.
