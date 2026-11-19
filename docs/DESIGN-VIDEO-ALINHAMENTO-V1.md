# Design de vídeo — base experimental de sincronização

Esta branch contém apenas uma primeira base **não integrada à interface**. Não é o editor completo e não foi testada em execução.

## Dois tipos de narração

**1. Vídeo com narração existente:** extrair áudio do próprio arquivo, usar faster-whisper local para transcrever e obter timestamps por palavra. Quando houver trilha forte no vídeo, preferir a voz separada original quando possível.

**2. Narração escrita:** gerar ou localizar o áudio real (Kokoro já existe no backend), e usar WhisperX para alinhar o texto oficial com o áudio. Nunca inventar timestamps com base no tamanho dos textos.

## Ferramentas acrescentadas

- apps/backend/bin/nivoo-alinhar-narracao — transcrição local ou alinhamento forçado.
- apps/backend/bin/nivoo-planejar-design — gera um rascunho JSON de legendas usando timestamps reais.
- apps/backend/bin/nivoo-design-video — render experimental de legendas e imagens, com FFmpeg/libass, preservando áudio.

Instalar faster-whisper e/ou WhisperX em ambiente Python isolado antes de rodar. Requer FFmpeg/FFprobe. Nenhuma instalação foi feita no servidor.

### Transcrever fala do vídeo

~~~bash
python3 apps/backend/bin/nivoo-alinhar-narracao --video video.mp4 --saida alinhamento.json
~~~

### Alinhar roteiro escrito ao áudio

~~~bash
python3 apps/backend/bin/nivoo-alinhar-narracao --video video.mp4 --roteiro narracao.txt --saida alinhamento.json
~~~

### Planejar legendas

~~~bash
node apps/backend/bin/nivoo-planejar-design --alinhamento alinhamento.json --protecao protecoes.json --saida design-plan.json
~~~

Exemplo de protecoes.json:

~~~json
[{"id":"logo","start":0,"end":53,"box":{"x":0.72,"y":0.02,"w":0.24,"h":0.12}}]
~~~

### Validar e renderizar

~~~bash
node apps/backend/bin/nivoo-design-video --plano design-plan.json --video video.mp4 --validar
node apps/backend/bin/nivoo-design-video --plano design-plan.json --video video.mp4 --saida resultado.mp4
~~~

## Limites da base atual

- Proteção depende de regiões previamente informadas, não há detecção automática de rostos e logos.
- Planejador é heurístico, ainda não inclui interpretação por IA nem geração de imagens.
- A timeline não está exposta no frontend ou registrada como provedor na fila.
- Não há medição automática de texto excedendo as caixas das legendas.
- Sem testes de runtime, integração ou render executados nesta branch.

## Próximas entregas para tornar o editor real

1. Editor React integrado ao projeto, com timeline multifaixas, cortes, áudio e salvamento não destrutivo.
2. Serviço de execução associado à fila existente e aos caminhos seguros de mídia.
3. Composição semântica via agente do projeto (legendas cinéticas, imagens, gráficos).
4. Análise temporal de rosto, logo, OCR e segurança de posicionamento.
5. Prévia, revisão visual, histórico e renderização verificável.
6. Testes ponta a ponta, licenciamento e benchmarks de 1080p.

A interface e os agentes existentes do Nivoo devem ser reutilizados, sem criar aplicativo paralelo.
