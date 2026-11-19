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

## Dependências opcionais

O Nivoo **não instala automaticamente** faster-whisper, WhisperX ou
opencv-python-headless. Sem esses pacotes, os respectivos recursos informam erro.
OCR usa pytesseract como módulo opcional e o binário Tesseract já é instalado
pelo instalador padrão.

Use um ambiente virtual isolado com as bibliotecas necessárias e aponte a API
para seu executável Python. Por exemplo, em Debian:

```bash
sudo apt-get install -y python3-venv
sudo python3 -m venv /opt/nivoo-studio-venv
sudo /opt/nivoo-studio-venv/bin/python -m pip install faster-whisper opencv-python-headless pytesseract
```

Adicionar ao arquivo `/etc/nivoo/nivoo.env`:

```bash
NIVOO_STUDIO_PYTHON=/opt/nivoo-studio-venv/bin/python
```

Depois reiniciar a API para ler a variável (ou executar `nivoo update`
quando estiver pronto para atualizar o código).

**WhisperX** deve ser avaliado separadamente: pode exigir PyTorch e modelos
de alinhamento, downloads volumosos e ajustes conforme CPU/GPU e versão Python.
Para usar roteiro escrito com alinhamento forçado, instalar e validar o WhisperX
no mesmo venv. A geração de áudio com Kokoro no Nivoo é uma etapa separada.

## Limitações conhecidas antes da homologação

- O detector OpenCV é **amostrado** e não garante detectar toda pessoa,
  rosto de perfil, logo ou texto. Proteção manual permanece obrigatória.
- Os efeitos visuais são componentes reutilizáveis. Não é um editor VFX
  completo nem usa geração externa de imagens contextualizadas automaticamente.
- Os jobs Studio em memória não retomam automaticamente após reiniciar a API.
- Não foram executados testes ou homologação nesta etapa por solicitação.
- A licença, termos e direitos de imagens/áudio de terceiros são responsabilidade
  do proprietário dos respectivos materiais.
