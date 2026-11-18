#!/usr/bin/env bash
# TEST-ONLY: simula o Gemini CLI oficial o suficiente para os testes, SEM nunca chamar o Google.
# - "--version": faz a conexão "Gemini — chave de API" aparecer como CONECTADA (checkAvailability roda --version).
# - "-p" (headless, --output-format stream-json): devolve um resultado final válido que o parser entende.
# Sem isto, uma máquina sem o `gemini` instalado (ex.: o CI) marcaria a conexão como não conectada.
case "$1" in
  --version) echo "0.0.0 (Gemini CLI STUB)"; exit 0 ;;
esac
cat > /dev/null 2>&1 # consome o prompt do stdin
printf '%s\n' '{"type":"init","session_id":"stub-gemini"}'
printf '%s\n' '{"type":"message","role":"assistant","content":"feito (stub)"}'
printf '%s\n' '{"type":"result","status":"success","stats":{"input_tokens":10,"output_tokens":5}}'
exit 0
