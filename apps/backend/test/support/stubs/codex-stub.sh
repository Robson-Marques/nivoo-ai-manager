#!/usr/bin/env bash
# TEST-ONLY: simula a interface do Codex CLI para testar o PARSER do adaptador. Não é integração funcional.
case "$1" in
  --version) echo "codex-cli 0.0.0-stub"; exit 0 ;;
  login) [ "${STUB_LOGGED_IN:-true}" = "true" ] && { echo "Logged in"; exit 0; } || { echo "Not logged in"; exit 1; } ;;
esac
cat > /dev/null
echo '{"type":"thread.started"}'
echo '{"type":"item.completed","item":{"type":"command_execution","command":"ls"}}'
echo '{"type":"item.completed","item":{"type":"agent_message","text":"resposta final"}}'
echo '{"type":"turn.completed","usage":{"input_tokens":7,"output_tokens":3}}'
