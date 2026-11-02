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
if [ "$MODE" = "violar" ]; then
  # Simula um agente que escreve fora do workspace (no diretório de dados do projeto).
  echo invasao > "$NIVOO_DATA_DIR/invasao.txt"
  echo '{"type":"result","subtype":"success","is_error":false,"result":"feito","session_id":"stub-violar","total_cost_usd":0.5,"terminal_reason":"completed"}'
  exit 0
fi
if [ "$MODE" = "lento" ]; then
  # Simula uma sessão que já consumiu tokens e estoura o tempo (o CLI real não emite o custo final).
  echo '{"type":"assistant","message":{"id":"m1","usage":{"input_tokens":1000,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":2000},"content":[{"type":"text","text":"pensando"}]}}'
  sleep 60
  exit 0
fi
if [ "$MODE" = "max_turns" ]; then
  echo '{"type":"result","subtype":"error_max_turns","is_error":true,"terminal_reason":"max_turns","num_turns":3,"session_id":"stub-sessao","total_cost_usd":0.01}'
  exit 1
fi
if [ "$MODE" = "limit" ]; then
  echo '{"type":"result","subtype":"error","is_error":true,"result":"Claude AI usage limit reached","total_cost_usd":0}'
  exit 1
fi
echo '{"type":"result","subtype":"success","is_error":false,"result":"feito","total_cost_usd":0.0123,"usage":{"input_tokens":10,"output_tokens":5}}'
