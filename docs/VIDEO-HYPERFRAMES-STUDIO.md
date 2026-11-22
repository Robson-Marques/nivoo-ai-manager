# HyperFrames no Nivoo Studio — integração inicial

Os dois tipos de edição (produção independente e projeto) expõem o módulo Motion design · HyperFrames.

## Entrega desta branch

- CLI HyperFrames oficial em versão top-level fixa 0.9.80, opcional e instalada fora do checkout Git; browser do usuário nivoo provisionado.
- Seis modelos autorados pelo backend: título cinético, neon/LED, pincelada, zoom de impacto, revelação lateral e fade elegante. Catálogo com categoria, origem local revisada e versão. O navegador não pode enviar HTML nem JavaScript arbitrário.
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

## Continuidade, idempotência e integração com a IA

O estado de cada job de motion é salvo no projeto. Ao reabrir o editor após reiniciar a API, um MP4 concluído e ainda presente é recuperado; um processo interrompido é sinalizado como falha recuperável. O mesmo template de efeito e texto devolve a prévia existente em vez de executar de novo. O cache exige fingerprint SHA-256 do HTML gerado, portanto uma atualização da animação invalida a prévia anterior. O cancelamento também atualiza o estado persistido.

O assistente de planejamento recebe somente os seis IDs de efeito revisados. Ele pode retornar até 3 sugestões de motion no mesmo JSON da edição. A interface permite selecionar uma sugestão e preencher o criador; ela NÃO renderiza nem aplica automaticamente o efeito e não reexecuta a IA. Blocos externos do catálogo oficial ficam acessíveis apenas para descoberta e curadoria.

Buscas do registro oficial são feitas por GET /motion/catalog?query=... com o comando catalog --query --json. Não há add automático. Veja VIDEO-HYPERFRAMES-CATALOGO.md.

## Renderização determinística (corrigida após confrontar o formato oficial)

Os seis modelos são composições HTML autoradas pelo Nivoo. Cada uma registra um `gsap.timeline({paused:true})` sob a chave `window.__timelines["nivoo-motion"]`, e o relógio de 3,2 segundos é comandado pela CLI. Não dependem de animação CSS que avança com tempo real. O runtime GSAP 3.14.2 é instalado no diretório isolado do usuário nivoo e copiado para a pasta temporária do job, sem necessidade de CDN e sem carregar código de terceiros na página além desse runtime fixado.

O instalador só reconstrói dependências se a CLI, o GSAP local ou os arquivos travados estiverem ausentes; a atualização da ferramenta continua independente do fluxo FFmpeg/Remotion.
