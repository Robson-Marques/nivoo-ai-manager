#!/usr/bin/env bash
# TEST-ONLY: simula a interface de linha de comando do Claude Code para testar o PARSER do adaptador.
# NÃO é uma integração funcional e nunca é usado fora de test/unit.
# O adaptador repassa ambiente mínimo; o controle do stub é por arquivos em $CTL.
CTL="${TMPDIR:-/tmp}/nivoo-cli-stub"
mkdir -p "$CTL"
LOGGED_IN=$(cat "$CTL/logged_in" 2>/dev/null || echo true)
MODE=$(cat "$CTL/mode" 2>/dev/null || echo ok)
case "$1" in
  --version) echo "9.9.9 (Claude Code STUB)"; exit 0 ;;
  auth) echo '{"loggedIn": '"$LOGGED_IN"', "authMethod": "stub"}'; exit 0 ;;
esac
prompt=$(cat)
echo "$prompt" > "$CTL/prompt.txt"
echo "$@" > "$CTL/args.txt"
if [ "$MODE" = "limit" ]; then
  echo '{"type":"result","subtype":"error","is_error":true,"result":"Claude AI usage limit reached","total_cost_usd":0}'
  exit 1
fi
echo '{"type":"result","subtype":"success","is_error":false,"result":"feito","total_cost_usd":0.0123,"usage":{"input_tokens":10,"output_tokens":5}}'
