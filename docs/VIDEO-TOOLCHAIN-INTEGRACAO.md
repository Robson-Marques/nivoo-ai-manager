# Integração dos motores de vídeo — implementação incremental

Status: **integração parcial implementada**. FFmpeg, Remotion e Whisper têm caminhos próprios. HyperFrames ganha geração de prévia em modelos locais nesta branch (ver VIDEO-HYPERFRAMES-STUDIO.md). A importação remota por yt-dlp continua bloqueada.

## Contrato
- Preservar a timeline, mídia, Kokoro, Gemini e renderização existentes.
- Não iniciar o mesmo trabalho duas vezes. Cada operação terá chave de idempotência por projeto, mídia, parâmetros e versão.
- Execuções longas passam pelo worker persistente; API apenas agenda e consulta.
- Ferramentas são processos isolados, com timeout, limites de CPU/memória, diretório temporário exclusivo e logs sanitizados.
- Preview é separado do render final. Não pedir segunda aprovação para a mesma versão aprovada.
- Disponibilidade verificada no servidor, não inferida pela presença de configuração.

## Motores
| Motor | Uso | Estratégia |
|---|---|---|
| Remotion | composição, montagem e render | reutilizar pipeline atual, detectar dependência e versão |
| HyperFrames | motion graphics, tipografia e keyframes | adapter próprio com projeto editável e preview; não converter em MP4 antes da aprovação |
| Whisper | transcrição e alinhamento | reutilizar instalação existente de faster-whisper/WhisperX quando presente; SRT/VTT e palavras temporizadas |
| yt-dlp | importação de mídia autorizada | download por URL validada, sem execução de shell, proteção SSRF, tamanho/duração máximos e proveniência |

## Fluxo
1. Importar ou selecionar mídia existente.
2. Planejar animações/legendas e salvar composição editável.
3. Gerar prévia de baixa resolução e cacheá-la.
4. Aprovar a versão da composição uma única vez.
5. Renderizar via worker e publicar artefatos na pasta de mídia do projeto.
6. Permitir reedição sem perder fontes, projeto e checkpoints.

## Interface proposta
Painel único **Vídeo** com abas compactas: Mídia, Animações, Áudio/Legendas e Exportar. Timeline e preview sempre visíveis. Lista de efeitos com mini-preview, nomes de mídia, remover item, controle de áudio e indicador de progresso real.

## Critérios de aceitação
- Diagnóstico mostra disponibilidade e versões dos quatro motores.
- Falta de uma ferramenta não quebra os recursos existentes.
- Importação não aceita URLs privadas, loopback, redirecionamentos internos nem caminhos fora do workspace.
- Preview pode ser reproduzido antes da renderização definitiva.
- A mesma aprovação/solicitação não dispara processamento duplicado.
- Falha é exibida com causa e ação de recuperação, sem loop infinito.
- Exportação de MP4 com áudio sincronizado e legenda quando solicitada.

## Pendências reais
- Conectar os blocos do catálogo externo HyperFrames com origem comprovada, isolamento e regras de preview antes de publicar. As skills externas não são instaladas automaticamente no ambiente do agente.
- Resolver importação autorizada via yt-dlp sem SSRF; nunca habilitar download de URLs arbitrárias.
- Homologar renderizações reais pós-update e revisar a integração de mídia e o fluxo de aprovações.
- Integrar progressivamente formatos de animação avançados (incluindo 3D), sem substituir os modelos locais por código arbitrário. Nenhum deploy automático.
