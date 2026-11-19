#!/usr/bin/env bash
# Prepara a análise local do Nivoo Studio; nunca altera o Python global.
set -euo pipefail
umask 022
VENV="/opt/nivoo/studio-venv"
ENV_FILE="/etc/nivoo/nivoo.env"
LOG="/var/log/nivoo-studio-python.log"
note() { printf "    [Studio] %s\n" "$*"; }
warn() { note "AVISO: $*"; }
[ "$(id -u)" = 0 ] || { echo "execute como root" >&2; exit 1; }
mkdir -p "$(dirname "$VENV")" "$(dirname "$LOG")"
touch "$LOG"
chmod 640 "$LOG"
if [ ! -x "$VENV/bin/python" ]; then
  note "Criando Python isolado em $VENV"
  python3 -m venv "$VENV" || { warn "falha ao criar o venv"; exit 0; }
fi
PY="$VENV/bin/python"
PIP="$VENV/bin/pip"
core_ready() { "$PY" -c "import cv2, pytesseract; from faster_whisper import WhisperModel" >>"$LOG" 2>&1; }
whisperx_ready() { "$PY" -c "import whisperx; import torch" >>"$LOG" 2>&1; }
if core_ready; then
  note "faster-whisper, OpenCV e OCR já instalados"
else
  note "Instalando faster-whisper, OpenCV e OCR (primeira execução pode demorar)..."
  if timeout 900 "$PIP" install --no-input --disable-pip-version-check --prefer-binary "faster-whisper>=1.2,<2" "opencv-python-headless>=4.10,<5" "pytesseract>=0.3.10,<1" >>"$LOG" 2>&1 && core_ready; then
    note "Transcrição, rostos e OCR disponíveis"
  else
    warn "dependências essenciais incompletas: $LOG"
    tail -n 5 "$LOG" | sed "s/^/      /"
  fi
fi
if [ "${NIVOO_STUDIO_INSTALL_WHISPERX:-1}" = 1 ]; then
  if whisperx_ready; then
    note "WhisperX já instalado"
  else
    FREE_KB="$(df -Pk "$VENV" | awk 'END {print $4}')"
    if [ "$FREE_KB" -lt 5242880 ]; then
      warn "WhisperX requer ao menos 5 GiB livres para instalação; transcrição comum continua disponível"
    else
      note "Instalando WhisperX/PyTorch (download grande, apenas na primeira instalação)..."
      if timeout 1800 "$PIP" install --no-input --disable-pip-version-check --prefer-binary "whisperx>=3.7,<4" >>"$LOG" 2>&1 && whisperx_ready; then
        note "WhisperX disponível"
      else
        warn "WhisperX indisponível; transcrição sem roteiro continua disponível. Veja $LOG"
        tail -n 5 "$LOG" | sed "s/^/      /"
      fi
    fi
  fi
else
  note "WhisperX desativado por NIVOO_STUDIO_INSTALL_WHISPERX=0"
fi
if core_ready; then
  chmod -R a+rX "$VENV"
  if grep -q "^NIVOO_STUDIO_PYTHON=" "$ENV_FILE"; then
    sed -i "s#^NIVOO_STUDIO_PYTHON=.*#NIVOO_STUDIO_PYTHON=$PY#" "$ENV_FILE"
  else
    printf "\nNIVOO_STUDIO_PYTHON=%s\n" "$PY" >> "$ENV_FILE"
  fi
  chmod 640 "$ENV_FILE"
  note "Python local ativado para a API: $PY"
else
  warn "Studio Python não ativado. API e worker permanecem operacionais."
fi
