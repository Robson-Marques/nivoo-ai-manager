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


## APIs de especialidade integradas (pacote único)

O conector NVIDIA do Nivoo AI Manager agora possui **rotas próprias** para modelos de especialidades, além do Chat Completions usado pelo Studio Workflow:

| Uso | Endpoint da NVIDIA | Implementação |
| --- | --- | --- |
| Chat de texto sem ferramentas | `POST https://integrate.api.nvidia.com/v1/chat/completions` | Nivoo: `POST /accounts/:id/nvidia/conversa` |
| Embeddings para pesquisa/RAG | `POST https://integrate.api.nvidia.com/v1/embeddings` | Nivoo: `POST /accounts/:id/nvidia/embedding`, suporte inicial Nemotron 3.5 Embed 1B/8B e 3 Embed 1B |
| Reranking de documentos | `POST https://ai.api.nvidia.com/v1/retrieval/nvidia/nemotron-3.5-rerank-8b/reranking` | Nivoo: `POST /accounts/:id/nvidia/rerank` |
| Geração de imagem FLUX.1 Schnell | `POST https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell` | Nivoo: `POST /accounts/:id/nvidia/imagem` |

A tela **Conexões > NVIDIA > Catálogo** mostra um painel para executar essas operações com a chave que já está salva. No **Nivoo Studio de Vídeo**, quando a conexão NVIDIA estiver ativa, aparece a ação **Gerar imagem com NVIDIA**, que salva o JPEG diretamente na biblioteca de mídia do projeto, sem baixar e reenviar.

**Atenção:** a NVIDIA atualmente marca FLUX.1 Schnell como Downloadable; a API de referência existe, mas a conta pode recusar a chamada por créditos, autorização, termos ou cotas. Não se afirma que a geração de imagem é gratuita.

**Não há integração automática dos embeddings ao mecanismo de busca de projetos** nesta etapa; a rota e o painel estão disponíveis para uso programático e avaliação. As rotas de rerank também estão operacionais como serviço, mas ainda não são acionadas automaticamente pela pesquisa dos projetos.

**Não instalamos infraestrutura adicional de GPU no POCOU.** Modelos como Wan Animate, relighting, upscaling, FLUX 3 Klein e outras opções apenas para download continuam exigindo implantação própria. O catálogo os apresenta como não executáveis pela API de chat.

Proteções: URL oficial fixa por especialidade, chave guardada no cofre da conexão, limites de tamanho para entrada/saída, timeouts, status de erros HTTP, não logar a chave, validação de IDs e sem comandos arbitrários pelo executor.

Referências:
- https://build.nvidia.com/nvidia/nemotron-3_5-embed-1b/apireference
- https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3_5-rerank-8b-infer
- https://docs.api.nvidia.com/nim/reference/black-forest-labs-flux_1-schnell-infer
