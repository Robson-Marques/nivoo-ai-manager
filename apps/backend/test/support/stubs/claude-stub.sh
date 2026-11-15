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
# Ferramentas MCP desta sessão: guarda a configuração recebida (o arquivo some quando a sessão acaba).
rm -f "$CTL/mcp.json"
prev=""; for a in "$@"; do [ "$prev" = "--mcp-config" ] && cp "$a" "$CTL/mcp.json"; prev="$a"; done
# Qual credencial/pasta chegou a esta sessão (conexões múltiplas não podem se misturar).
echo "${ANTHROPIC_API_KEY:-}|${CLAUDE_CONFIG_DIR:-}|${CLAUDE_CODE_OAUTH_TOKEN:-}" > "$CTL/env.txt"
# Anexos do chat que chegaram à sessão (com o tamanho de cada um).
[ -d contexto/anexos ] && (cd contexto/anexos && find . -type f -printf '%p %s\n' | sort) > "$CTL/anexos.txt"
if printf '%s' "$prompt" | grep -q "Você é um REVISOR independente"; then
  # Conferência das regras: guarda o prompt do revisor e grava o relatório pedido.
  echo "$prompt" > "$CTL/prompt-revisor.txt"
  CONFORME=$(cat "$CTL/conforme" 2>/dev/null || echo true)
  mkdir -p out
  if [ "$CONFORME" = duvida ]; then
    # "Não conforme" só por uma dúvida que só o usuário responde (o caso real do ConnectChat).
    echo '{"conforme": false, "violacoes": [], "perguntas": [{"pergunta": "Qual é a lista original dos títulos das 16 seções?", "opcoes": ["Os títulos do documento X", "Os títulos atuais do relatório"]}], "corrigido": []}' > out/conferencia-regras.json
  elif [ "$CONFORME" = true ]; then
    echo '{"conforme": true, "violacoes": [], "corrigido": [], "observacoes": "stub"}' > out/conferencia-regras.json
  else
    echo '{"conforme": false, "violacoes": ["regra X descumprida (stub)"], "corrigido": []}' > out/conferencia-regras.json
  fi
  echo '{"type":"result","subtype":"success","is_error":false,"result":"conferido","session_id":"stub-revisor","total_cost_usd":0.01,"terminal_reason":"completed"}'
  exit 0
fi
if [ "$MODE" = "texto" ] || { [ -f "$CTL/resposta.txt" ] && printf '%s' "$prompt" | grep -q "apresente a ENTREGA"; }; then
  # Devolve como resposta final o conteúdo de $CTL/resposta.txt (usado para simular a IA da conversa).
  python3 -c 'import json,sys; print(json.dumps({"type":"result","subtype":"success","is_error":False,"terminal_reason":"completed","session_id":"stub-conversa","total_cost_usd":0.02,"result":open(sys.argv[1]).read()}))' "$CTL/resposta.txt"
  exit 0
fi
if [ -f "$CTL/correcao.sh" ] && printf '%s' "$prompt" | grep -q "conferência final do sistema NÃO passou"; then
  # Correção pedida pela conferência final: executa o script de correção do teste.
  echo "$prompt" > "$CTL/prompt-correcao.txt"
  bash "$CTL/correcao.sh" > /dev/null 2>&1
  echo '{"type":"result","subtype":"success","is_error":false,"result":"corrigido","session_id":"stub-correcao","total_cost_usd":0.01,"terminal_reason":"completed"}'
  exit 0
fi
if [ "$MODE" = "bash" ]; then
  # Executa como comando bash o texto da "Tarefa desta etapa" (usado pelo teste de tela do chat).
  tarefa=$(printf '%s' "$prompt" | sed -n '/^## Tarefa desta etapa/,$p' | tail -n +2)
  bash -c "$tarefa" > /dev/null 2>&1
  echo '{"type":"result","subtype":"success","is_error":false,"result":"feito","session_id":"stub-bash","total_cost_usd":0.01,"terminal_reason":"completed"}'
  exit 0
fi
if [ "$MODE" = "violar" ]; then
  # Simula um agente que escreve fora do workspace: no conhecimento original do projeto
  # (o worktree fica em <projeto>/worktrees/<job>; o conhecimento em <projeto>/conhecimento).
  echo invasao > "$PWD/../../conhecimento/invasao.txt"
  echo '{"type":"result","subtype":"success","is_error":false,"result":"feito","session_id":"stub-violar","total_cost_usd":0.5,"terminal_reason":"completed"}'
  exit 0
fi
if [ "$MODE" = "lento" ]; then
  # Simula uma sessão que já consumiu tokens e estoura o tempo (o CLI real não emite o custo final).
  echo '{"type":"assistant","message":{"id":"m1","usage":{"input_tokens":1000,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":2000},"content":[{"type":"text","text":"pensando"}]}}'
  sleep 60
  exit 0
fi
if [ "$MODE" = "leitura_longa" ]; then
  # Tarefa longa: as 2 primeiras sessões só leem e anotam progresso (nenhum arquivo do trabalho muda);
  # a terceira grava o relatório.
  n=$(( $(cat "$CTL/sessoes" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$CTL/sessoes"
  mkdir -p .nivoo
  if [ "$n" -lt 3 ]; then
    echo "{\"tipo\": \"PROGRESSO\", \"titulo\": \"leitura parte $n\", \"conteudo\": \"li a parte $n de 3\"}" >> .nivoo/notas.jsonl
    echo '{"type":"result","subtype":"error_max_turns","is_error":true,"terminal_reason":"max_turns","num_turns":30,"session_id":"stub-longa","total_cost_usd":0.01}'
    exit 1
  fi
  echo "# Auditoria" > relatorio.md
  echo '{"type":"result","subtype":"success","is_error":false,"result":"feito","session_id":"stub-longa","total_cost_usd":0.01,"terminal_reason":"completed"}'
  exit 0
fi
if [ "$MODE" = "max_turns" ]; then
  echo '{"type":"result","subtype":"error_max_turns","is_error":true,"terminal_reason":"max_turns","num_turns":3,"session_id":"stub-sessao","total_cost_usd":0.01}'
  exit 1
fi
if [ "$MODE" = "limit_conta" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  # Só a conta (assinatura) está sem limite; a variante por chave de API funciona normalmente.
  echo '{"type":"result","subtype":"error","is_error":true,"result":"Claude AI usage limit reached","total_cost_usd":0}'
  exit 1
fi
if [ "$MODE" = "401" ]; then
  # Token da conta recusado pelo provedor (expirado/revogado).
  echo '{"type":"result","subtype":"success","is_error":true,"result":"Failed to authenticate. API Error: 401 OAuth access token is invalid","total_cost_usd":0}'
  exit 1
fi
if [ "$MODE" = "limit" ]; then
  echo '{"type":"result","subtype":"error","is_error":true,"result":"Claude AI usage limit reached","total_cost_usd":0}'
  exit 1
fi
echo '{"type":"result","subtype":"success","is_error":false,"result":"feito","total_cost_usd":0.0123,"usage":{"input_tokens":10,"output_tokens":5}}'
