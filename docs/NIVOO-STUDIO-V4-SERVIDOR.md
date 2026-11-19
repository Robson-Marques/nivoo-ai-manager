# Nivoo Studio V4 — preparação do servidor

Esta versão contém planejamento visual contextual, regiões temporais protegidas e
edição dinâmica. **O merge não equivale a homologação.**

## Fluxo esperado

1. Abrir um projeto em **Nivoo Studio** e importar cenas e áudios.
2. Editar cortes, adicionar voz e trilha, salvar.
3. Para um único vídeo narrado, usar **Gerar legendas pela narração**.
   Para montagens com vários clipes/áudios, exportar a montagem antes do alinhamento.
4. Em **Proteção**, pedir a detecção de rostos/textos; revisar todas as regiões
   e acrescentar manualmente logos e áreas importantes.
5. Solicitar **Criar design com IA**, conferir propostas na prévia,
   retirar inserções indesejadas e aplicar à timeline.
6. Reposicionar legendas e imagens arrastando na prévia, salvar e exportar MP4.
7. Conferir áudio, sincronismo, overlays, logos e rostos no arquivo final.

## Dependências automáticas

O `nivoo update` passa a criar automaticamente `/opt/nivoo/studio-venv`,
instalando faster-whisper, OpenCV, pytesseract e WhisperX/PyTorch.
O ambiente é isolado e a API recebe `NIVOO_STUDIO_PYTHON` em
`/etc/nivoo/nivoo.env` ao final da instalação.

- A primeira instalação pode exigir vários gigabytes e demorar.
- Falhas nas dependências do Studio são avisadas, sem parar API/worker.
- Verifique os módulos com `nivoo check`.
- Consulte `/var/log/nivoo-studio-python.log` caso haja erro.
- Instalações já funcionais não são reinstaladas.
- Modelos podem ser baixados no primeiro uso, com internet.
- Para ignorar a instalação: `NIVOO_STUDIO_INSTALL=0 nivoo update`.
- Para ignorar apenas WhisperX: `NIVOO_STUDIO_INSTALL_WHISPERX=0 nivoo update`.

WhisperX exige recursos de CPU/memória e modelos de alinhamento;
o resultado real deve ser conferido com narração em português.

## Limitações conhecidas antes da homologação

- O detector OpenCV é **amostrado** e não garante detectar toda pessoa,
  rosto de perfil, logo ou texto. Proteção manual permanece obrigatória.
- Os efeitos visuais são componentes reutilizáveis. Não é um editor VFX
  completo nem usa geração externa de imagens contextualizadas automaticamente.
- Os jobs Studio em memória não retomam automaticamente após reiniciar a API.
- Não foram executados testes ou homologação nesta etapa por solicitação.
- A licença, termos e direitos de imagens/áudio de terceiros são responsabilidade
  do proprietário dos respectivos materiais.
