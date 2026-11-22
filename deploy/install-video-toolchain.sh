#!/usr/bin/env bash
# Nivoo Video — preflight idempotente do toolchain, chamado pelo instalador/update.
# Não executa npm/npx de pacotes não fixados e não baixa executáveis de terceiros.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Execute como root" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
echo "==> Nivoo Video: preparando dependências locais"
missing=()
for cmd in ffmpeg ffprobe; do
  command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
done
if [ "${#missing[@]}" -gt 0 ]; then
  apt-get update -qq
  apt-get install -y -q --no-install-recommends ffmpeg
fi
command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1 ||
  { echo "ERRO: FFmpeg/FFprobe indisponíveis" >&2; exit 1; }
ffmpeg -hide_banner -version | head -1
ffprobe -hide_banner -version | head -1
# Studio export requires ASS/subtitles and libx264; fail before service restart
# instead of discovering a missing encoder during a user's render.
if ! ffmpeg -hide_banner -encoders 2>/dev/null | grep -qE '[[:space:]]libx264[[:space:]]'; then
  echo 'ERRO: FFmpeg sem encoder libx264' >&2; exit 1
fi
for filter in subtitles blackdetect volumedetect; do
  if ! ffmpeg -hide_banner -filters 2>/dev/null | grep -qE "[[:space:]]${filter}[[:space:]]"; then
    echo "ERRO: FFmpeg sem filtro obrigatório: $filter" >&2; exit 1
  fi
done
echo '  FFmpeg: libx264, subtitles, blackdetect e volumedetect disponíveis'

# Remotion: provisiona a partir do código FIXADO no repositório (versões em
# video/remotion/package.json + package-lock.json) — npm ci e gera o bundle.
# Nada de versão flutuante: usa só o que está travado no git.
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTION_DIR="$APP_DIR/video/remotion"
if [ -f "$REMOTION_DIR/package.json" ] && command -v npm >/dev/null 2>&1; then
  echo "==> Remotion: instalando dependências fixadas e gerando o bundle"
  (
    cd "$REMOTION_DIR"
    if [ ! -f package-lock.json ]; then
      echo "ERRO: package-lock.json obrigatório para instalar Remotion de forma reproduzível" >&2
      exit 1
    fi
    npm ci --no-audit --no-fund --loglevel=error
    npm run bundle >/dev/null
  )
  if [ -f "$REMOTION_DIR/dist/index.html" ]; then
    # Deixa o binário 'remotion' no PATH do sistema (o worker roda como 'nivoo').
    ln -sfn "$REMOTION_DIR/node_modules/.bin/remotion" /usr/local/bin/remotion
    # Registra o caminho do bundle para o backend (diagnóstico e render o leem por esta variável).
    if [ -f /etc/nivoo/nivoo.env ]; then
      sed -i '/^NIVOO_REMOTION_BUNDLE=/d' /etc/nivoo/nivoo.env
      echo "NIVOO_REMOTION_BUNDLE=$REMOTION_DIR/dist" >> /etc/nivoo/nivoo.env
    fi
    echo "  Remotion: bundle gerado e CLI instalada (paridade visual e exportação Studio ainda exigem homologação)"
  else
    echo "ERRO: bundle do Remotion não foi gerado (dist/index.html ausente)" >&2
    exit 1
  fi
else
  echo "  Remotion: código não encontrado em video/remotion; motor de render permanecerá bloqueado"
fi
# HyperFrames: CLI externa opcional (não provisionada automaticamente).
if command -v hyperframes >/dev/null 2>&1; then
  echo "  hyperframes: CLI detectada (opcional; paridade não validada)"
else
  echo "  hyperframes: não provisionado (opcional)"
fi
if [ -f /etc/nivoo/nivoo.env ]; then
  py="$(sed -n 's/^NIVOO_STUDIO_PYTHON=//p' /etc/nivoo/nivoo.env | tail -1)"
  if [ -n "$py" ] && [ -x "$py" ]; then
    if runuser -u nivoo -- "$py" -c 'import faster_whisper' >/dev/null 2>&1; then
      echo "  faster-whisper: disponível no Studio Python"
    else
      echo "ERRO: faster-whisper indisponível após install-studio-python.sh" >&2
      exit 1
    fi
  fi
fi
echo "==> Nivoo Video: preflight concluído"
