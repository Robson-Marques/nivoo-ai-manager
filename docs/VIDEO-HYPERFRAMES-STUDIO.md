# HyperFrames no Nivoo Studio — integração inicial

Os dois tipos de edição (produção independente e projeto) expõem o módulo Motion design · HyperFrames.

## Entrega desta branch

- CLI HyperFrames oficial em versão top-level fixa 0.9.80, opcional e instalada fora do checkout Git; browser do usuário nivoo provisionado.
- Três modelos autorados pelo backend: título cinético, neon/LED e pincelada. O navegador não pode enviar HTML nem JavaScript arbitrário.
- Job assíncrono por edição, consulta de estado, cancelamento, lock compartilhado com a exportação e controle de ownership.
- MP4 de 3,2 segundos inspecionado por FFmpeg/FFprobe antes da publicação na pasta de saída. A interface permite reproduzir e inserir na timeline.
- Falha da instalação opcional não impede FFmpeg/Remotion existentes.

## API

Prefixos: /projects/:pid/studio e /studio/projects/:pid/edits

- GET /motion/presets: modelos locais aprovados
- POST /:id/motion: inicia job com preset e title
- GET /:id/motion: acompanha estado
- POST /:id/motion/cancel: solicita cancelamento

A inserção na timeline depende de ação do usuário. Renderização de prévia não altera a edição salva.

## Limites conscientes

Esta integração funcional de prévias não equivale ao catálogo integral do HyperFrames de HeyGen. As skills upstream /hyperframes, /hyperframes-cli, /hyperframes-registry, /media-use, /reverse-any-video, /style-sampling e as opcionais ainda não estão instaladas no ambiente dos agentes nem ligadas ao Studio Workflow. Blocos terceiros exigem revisão de código, comprovação de origem, limites de download e isolamento de execução.

yt-dlp permanece desativado sem isolamento de rede. Whisper/faster-whisper, Kokoro, FFmpeg e o render Remotion atual são fluxos independentes. O exemplo 3D não faz parte desta integração.

## Aceitação após o próximo update

1. Verificar a CLI e o browser na página Ferramentas.
2. Gerar título cinético; verificar MP4 com aproximadamente 3,2 segundos.
3. Reproduzir o MP4 e inserir como videoclipe na timeline.
4. Exportar com FFmpeg, verificar áudio, tempo e imagem.
5. Testar cancelamento, entrada inválida, edição inexistente e job concorrente.
6. Conferir mensagens de erro quando a ferramenta não estiver disponível.

Não homologado enquanto os testes reais no servidor não passarem. Esta branch não deve ser incorporada automaticamente à main.
