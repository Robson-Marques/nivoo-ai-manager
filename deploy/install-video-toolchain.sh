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

# Remotion/HyperFrames exigem versão fixada, bundle confiável e aprovação de
# execução. Não instalar automaticamente uma versão flutuante do npm.
for tool in remotion hyperframes; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "  $tool: binário detectado (renderização ainda exige validação de compatibilidade)"
  else
    echo "  $tool: não provisionado; renderização por este motor permanecerá bloqueada"
  fi
done
if [ -f /etc/nivoo/nivoo.env ]; then
  py="$(sed -n 's/^NIVOO_STUDIO_PYTHON=//p' /etc/nivoo/nivoo.env | tail -1)"
  if [ -n "$py" ] && [ -x "$py" ]; then
    if runuser -u nivoo -- "$py" -c 'import faster_whisper' >/dev/null 2>&1; then
      echo "  faster-whisper: disponível no Studio Python"
    else
      echo "  faster-whisper: ausente (ver install-studio-python.sh)"
    fi
  fi
fi
echo "==> Nivoo Video: preflight concluído"
