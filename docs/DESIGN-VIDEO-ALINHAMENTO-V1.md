# Nivoo Studio — Editor de vídeo e pós-produção assistida

## Situação
Implementação experimental na branch `feature/video-design-timeline-v1`. O código está
isolado da `main`. **Não mesclar ou executar `nivoo update` antes de validar o PR.**

## Interface
Rota `/p/:pid/studio` no React, vinculada ao projeto atual:
- Upload e listagem de vídeos, áudios e imagens já suportados pelo Nivoo.
- Linha do tempo com clipes, legendas, imagens, narração, música e áreas protegidas.
- Cortar o início/fim, dividir no cursor, ordenar clipes por drag and drop.
- Editar texto, tamanho, cor, posição e animações de entrada.
- Áudios independentes com deslocamento, recorte e volume; trilha de fundo.
- Salvar projetos de forma não destrutiva, desfazer/refazer alterações.
- Exportar MP4 por FFmpeg, preservando os arquivos originais.

## Sincronização de narração
- **Vídeo pronto com uma cena e áudio incorporado:** transcrever diretamente
  com faster-whisper; quando houver texto oficial, alinhar com WhisperX.
- **Montagem com múltiplas cenas e faixas:** exportar primeiro para alinhar
  contra o áudio efetivo da montagem.
- Saída temporizada por palavra, agrupada em legendas editáveis.
- Dependências opcionais: `faster-whisper` e `whisperx` em venv separado,
  com modelos pt-BR apropriados. Não são instalados por esta branch.

## Direção criativa com IA
- Botão `Criar design com IA` exige um plano com legendas/roteiro temporizados.
- Envia ao provedor de IA escolhido no projeto: falas e tempos,
  biblioteca de imagens disponíveis, regiões protegidas, instrução do usuário.
- Codex recebe também até três quadros amostrados da cena.
- A IA devolve **apenas JSON**, sem escrever React ou FFmpeg por vídeo.
- Resposta é validada e fica como rascunho; usuário aceita ou rejeita.
- Pode propor:
  - Novas legendas tipográficas dinâmicas em horários definidos.
  - Imagens já presentes na biblioteca.
  - Cartões gráficos originais gerados com Playwright local sem API paga.
- **A IA não baixa imagens de terceiros nem gera fotografias com modelos locais nesta versão.**
  O resultado depende da narração e dos assets disponíveis.

## Áreas protegidas
- A proteção manual já permite informar logos/rostos/textos com posição e duração.
- Detecção opcional de rosto frontal por OpenCV (modelo Haar, amostragem de frames):
  cria **proposta** revisável antes de salvar.
- Instalação separada de `opencv-python-headless` no venv do servidor,
  de preferência sob controle do administrador.
- O detector pode ignorar perfis, faces em movimento, logos e textos: NÃO
  garante ausência de colisões. Revise a proposta visual antes de exportar.

## Dependências de execução
- Node.js e Playwright Core com Chromium, usados no Nivoo para motion.
- FFmpeg com filtros `overlay` e `subtitles` (libass), além de ffprobe.
- Fontes DejaVu ou outras instaladas no host.
- Python 3 + opcional: faster-whisper, WhisperX, OpenCV headless.
- Sem necessidade de Remotion e sem uso obrigatório de API paga de imagem.
- Respeitar as licenças de modelos, fontes e assets importados.

## Pontos ainda não prontos para produção
- Testes completos E2E da interface com usuário real.
- Persistência na fila padrão dos jobs de renderização e de IA: o estado
  atual dos processos está em memória, sujeito a reinícios do serviço.
- Controle de recursos/concorrência e recuperação após reinício.
- Detecção temporal robusta de logos, textos e rostos em movimento.
- Geração fotográfica de imagens sob demanda e integração com fontes de imagens licenciadas.
- Timeline com waveform, transições avançadas, snapping e keyframes.
- Validação da duração e legibilidade de cada legenda em todos os formatos.
- Segurança operacional e limites de processamento em vídeos grandes.

## Atualização em produção
O comando `nivoo update` executa `git pull --ff-only` da branch instalada,
seguido do instalador do sistema. Não rodar sobre uma branch de teste e
não fazer merge do PR sem CI aprovada e revisão de integração.

## Testes no GitHub
Fluxo de verificação rápida em `.github/workflows/studio-fast.yml`:
- Compilação TypeScript do backend.
- Compilação do frontend React.
- Smoke de exportação FFmpeg com áudio, legendas e imagem.
- Criação local de asset com Playwright/Chromium.

Resultados dependem do commit mais recente; consultar o status da action.

## Arquivos centrais
- `apps/web/src/pages/VideoStudio.tsx`
- `apps/web/src/pages/VideoStudio.css`
- `apps/backend/src/video-studio/video-studio.service.ts`
- `apps/backend/src/video-studio/video-studio.controller.ts`
- `apps/backend/bin/nivoo-alinhar-narracao`
- `apps/backend/bin/nivoo-detectar-zonas`
- `apps/backend/bin/nivoo-gerar-asset`
- `apps/backend/bin/nivoo-planejar-design`
- `apps/backend/bin/nivoo-design-video`
