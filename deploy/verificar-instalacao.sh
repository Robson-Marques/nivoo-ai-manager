#!/usr/bin/env bash
# Verificação de ponta a ponta de uma instalação do Nivoo (sem IA: executor local).
# Cria um projeto de teste, roda um job com 3 critérios e confere que o verificador o concluiu.
# Uso: nivoo verificar   (ou: bash deploy/verificar-instalacao.sh [URL_DA_API])
set -euo pipefail
A="${1:-http://127.0.0.1:3000/api}"
N="${NODE_BIN:-$( [ -x /opt/nivoo/node/bin/node ] && echo /opt/nivoo/node/bin/node || echo node )}"
TOKEN="$(sed -n 's/^NIVOO_API_TOKEN=//p' /etc/nivoo/nivoo.env 2>/dev/null || true)"
H=(-H 'content-type: application/json'); [ -n "$TOKEN" ] && H+=(-H "Authorization: Bearer $TOKEN")
j() { "$N" -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log($1)})"; }
falha() { echo "FALHOU: $*" >&2; exit 1; }

curl -fsS "${H[@]}" "$A/health" >/dev/null || falha "API não responde em $A"
P=$(curl -fsS "${H[@]}" -XPOST "$A/projects" -d "{\"name\":\"Verificacao da instalacao $(date +%Y%m%d-%H%M%S)\"}" | j o.id)
J=$(curl -fsS "${H[@]}" -XPOST "$A/projects/$P/jobs" -d @- <<'JSON' | j o.id
{"title":"verificacao","objective":"gerar métricas, relatório e código verificáveis",
 "steps":[{"key":"a","instructions":"python3 -c \"import json; json.dump({'x': 2}, open('out/metrics.json','w'))\" && echo '# ok' > out/relatorio.md && mkdir -p src && echo 'print(1)' > src/exp.py"}],
 "criteria":[{"key":"m","description":"x>=1","kind":"METRIC_THRESHOLD","config":{"path":"x","op":">=","value":1}},
             {"key":"r","description":"relatório","kind":"ARTIFACT_PRESENT","config":{"name":"relatorio.md"}},
             {"key":"c","description":"código executa","kind":"COMMAND","config":{"command":"python3 src/exp.py"}}]}
JSON
)
curl -fsS "${H[@]}" -XPOST "$A/projects/$P/jobs/$J/start" >/dev/null
S=""
for _ in $(seq 1 60); do
  S=$(curl -fsS "${H[@]}" "$A/projects/$P/jobs/$J/report" | j o.status)
  case "$S" in CONCLUIDO|BLOQUEADO|FALHOU) break ;; esac
  sleep 1
done
[ "$S" = CONCLUIDO ] || { curl -fsS "${H[@]}" "$A/projects/$P/jobs/$J/report"; echo; echo "   projeto de teste mantido para análise: $P"; falha "job terminou em '$S' (o worker está rodando? veja: nivoo logs worker)"; }
N_ART=$(curl -fsS "${H[@]}" "$A/projects/$P/jobs/$J" | j 'o.artifacts.length + " artefatos, " + o.checkpoints.length + " checkpoint(s), critérios: " + o.criteria.map(c=>c.key+"="+c.status).join(" ")')
echo "OK: job de verificação CONCLUIDO pelo verificador ($N_ART)"
# O projeto de teste é excluído: não fica na lista de projetos do usuário.
curl -fsS "${H[@]}" -XDELETE "$A/projects/$P" >/dev/null && echo "   (projeto de teste excluído)"
