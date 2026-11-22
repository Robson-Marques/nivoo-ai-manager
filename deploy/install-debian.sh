#!/usr/bin/env bash
# =============================================================================
# Nivoo AI Manager — instalador para Debian 12/13, executado como ROOT.
#
#   bash deploy/install-debian.sh
#
# Pode ser executado de novo a qualquer momento (idempotente): reaproveita a
# senha do banco e o arquivo de configuração já existentes.
#
# O que faz:
#   1. instala pacotes do sistema (git, python3, PostgreSQL, curl...)
#   2. instala Node.js em /opt/nivoo/node (binário oficial, sha256 conferido)
#   3. cria o usuário de sistema "nivoo" (os serviços NÃO rodam como root)
#   4. cria banco e usuário no PostgreSQL local
#   5. gera /etc/nivoo/nivoo.env (configuração e segredos, fora do git)
#   6. instala dependências e compila backend + interface
#   7. aplica migrações e garante o modelo padrão (Geral)
#   8. instala Claude Code, Codex e Gemini CLI (oficiais, via npm)
#   9. cria e inicia os serviços systemd nivoo-api e nivoo-worker
#
# Variáveis opcionais (prefixe o comando, ex.: NIVOO_PORT=8080 bash ...):
#   NIVOO_HOST=127.0.0.1   endereço de escuta (padrão: só local; acesse por túnel SSH)
#                          use 0.0.0.0 para expor na rede — um token de API é gerado
#   NIVOO_PORT=3000        porta da API/interface
#   NIVOO_INSTALL_CLIS=1   0 para não instalar Claude Code/Codex
#   NODE_VERSION=22.22.0   versão do Node.js
# =============================================================================
set -euo pipefail
# Código, dependências e interface precisam ser legíveis pelo usuário 'nivoo' (os serviços não rodam
# como root). Quem chama (ex.: 'nivoo update', que usa umask 077 para backups) não pode impor outra.
umask 022

NODE_VERSION="${NODE_VERSION:-22.22.0}"
NIVOO_HOST="${NIVOO_HOST:-127.0.0.1}"
NIVOO_PORT="${NIVOO_PORT:-3000}"
NIVOO_INSTALL_CLIS="${NIVOO_INSTALL_CLIS:-1}"
NIVOO_SKIP_SYSTEMD="${NIVOO_SKIP_SYSTEMD:-0}"   # apenas para testes em contêiner

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_DIR=/opt/nivoo/node
NIVOO_USER=nivoo
NIVOO_HOME=/var/lib/nivoo
ETC_DIR=/etc/nivoo
ENV_FILE="$ETC_DIR/nivoo.env"
DB_NAME=nivoo
DB_USER=nivoo

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_b=$'\e[1m'; c_0=$'\e[0m'
step() { echo; echo "${c_b}==> $*${c_0}"; }
ok()   { echo "${c_ok}    ok${c_0} $*"; }
warn() { echo "${c_warn}    aviso:${c_0} $*"; }
die()  { echo "${c_err}ERRO:${c_0} $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "execute como root."
[ -f "$APP_DIR/package.json" ] && [ -d "$APP_DIR/apps/backend" ] || die "rode o script de dentro do código do Nivoo (deploy/install-debian.sh)."
. /etc/os-release
[ "${ID:-}" = debian ] || warn "sistema detectado: ${PRETTY_NAME:-desconhecido}. Testado em Debian 12 e 13."
has_systemd() { [ "$NIVOO_SKIP_SYSTEMD" != 1 ] && [ -d /run/systemd/system ]; }

# -----------------------------------------------------------------------------
step "1/9 Pacotes do sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -q --no-install-recommends \
  ca-certificates curl xz-utils git python3 python3-venv python3-pip openssl procps postgresql postgresql-client util-linux poppler-utils tesseract-ocr tesseract-ocr-por ripgrep ffmpeg fonts-dejavu-core openssh-client >/dev/null 2>&1
ok "git $(git --version | awk '{print $3}'), python $(python3 -V | awk '{print $2}'), $(psql -V)"

# -----------------------------------------------------------------------------
step "2/9 Node.js $NODE_VERSION em $NODE_DIR"
if [ -x "$NODE_DIR/bin/node" ] && [ "$("$NODE_DIR/bin/node" -v)" = "v$NODE_VERSION" ]; then
  ok "já instalado"
else
  case "$(dpkg --print-architecture)" in
    amd64) NARCH=x64 ;;
    arm64) NARCH=arm64 ;;
    *) die "arquitetura $(dpkg --print-architecture) não suportada" ;;
  esac
  TMP="$(mktemp -d)"
  TARBALL="node-v$NODE_VERSION-linux-$NARCH.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$TARBALL" -o "$TMP/$TARBALL"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  (cd "$TMP" && grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c - >/dev/null) || die "sha256 do Node.js não confere"
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xJf "$TMP/$TARBALL" -C "$NODE_DIR" --strip-components=1
  rm -rf "$TMP"
  ok "node $("$NODE_DIR/bin/node" -v), npm $(PATH="$NODE_DIR/bin:$PATH" "$NODE_DIR/bin/npm" -v) (sha256 conferido)"
fi
export PATH="$NODE_DIR/bin:$PATH"

# -----------------------------------------------------------------------------
step "3/9 Usuário de sistema '$NIVOO_USER' (serviços sem privilégios de root)"
if id "$NIVOO_USER" >/dev/null 2>&1; then
  ok "já existe"
else
  useradd --system --home-dir "$NIVOO_HOME" --create-home --shell /bin/bash "$NIVOO_USER"
  ok "criado (home $NIVOO_HOME)"
fi
install -d -o "$NIVOO_USER" -g "$NIVOO_USER" -m 750 "$NIVOO_HOME" "$NIVOO_HOME/data" "$NIVOO_HOME/data/workspaces" "$NIVOO_HOME/data/artifacts"

# -----------------------------------------------------------------------------
step "4/9 PostgreSQL"
if has_systemd; then
  systemctl enable --now postgresql >/dev/null 2>&1 || true
else
  service postgresql start >/dev/null 2>&1 || pg_ctlcluster "$(ls /etc/postgresql | sort -V | tail -1)" main start || true
fi
for _ in $(seq 1 30); do runuser -u postgres -- pg_isready -q && break; sleep 1; done
runuser -u postgres -- pg_isready -q || die "PostgreSQL não respondeu"

DB_PASS=""
if [ -f "$ENV_FILE" ]; then
  DB_PASS="$(sed -n 's#^DATABASE_URL=postgresql://[^:]*:\([^@]*\)@.*#\1#p' "$ENV_FILE" | head -1)"
fi
[ -n "$DB_PASS" ] || DB_PASS="$(openssl rand -hex 24)"
psql_root() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -qtA "$@"; }
if [ "$(psql_root -c "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'")" = 1 ]; then
  psql_root -c "ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'" >/dev/null
else
  psql_root -c "CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS'" >/dev/null
fi
if [ "$(psql_root -c "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")" != 1 ]; then
  psql_root -c "CREATE DATABASE $DB_NAME OWNER $DB_USER" >/dev/null
fi
ok "banco '$DB_NAME' e usuário '$DB_USER' prontos (somente localhost)"

# Bancos de teste descartáveis (um por trabalho, apagado no fim): usuário próprio que só cria bancos — não é
# superusuário e não entra no banco do Nivoo.
TESTES_USER=nivoo_testes
TESTES_PASS=""
if [ -f "$ENV_FILE" ]; then
  TESTES_PASS="$(sed -n 's#^NIVOO_TESTES_PG_URL=postgresql://[^:]*:\([^@]*\)@.*#\1#p' "$ENV_FILE" | head -1)"
fi
[ -n "$TESTES_PASS" ] || TESTES_PASS="$(openssl rand -hex 24)"
if [ "$(psql_root -c "SELECT 1 FROM pg_roles WHERE rolname='$TESTES_USER'")" = 1 ]; then
  psql_root -c "ALTER ROLE $TESTES_USER WITH LOGIN CREATEDB NOSUPERUSER NOCREATEROLE PASSWORD '$TESTES_PASS'" >/dev/null
else
  psql_root -c "CREATE ROLE $TESTES_USER WITH LOGIN CREATEDB NOSUPERUSER NOCREATEROLE PASSWORD '$TESTES_PASS'" >/dev/null
fi
psql_root -c "REVOKE CONNECT ON DATABASE $DB_NAME FROM PUBLIC" >/dev/null
psql_root -c "GRANT CONNECT ON DATABASE $DB_NAME TO $DB_USER" >/dev/null
TESTES_URL="postgresql://$TESTES_USER:$TESTES_PASS@127.0.0.1:5432/postgres"
ok "bancos de teste descartáveis: usuário '$TESTES_USER' (só cria bancos; sem acesso ao banco do Nivoo)"

# -----------------------------------------------------------------------------
step "5/9 Configuração $ENV_FILE"
install -d -m 750 -o root -g "$NIVOO_USER" "$ETC_DIR"
if [ -f "$ENV_FILE" ]; then
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME#" "$ENV_FILE"
  if grep -q '^NIVOO_TESTES_PG_URL=' "$ENV_FILE"; then
    sed -i "s#^NIVOO_TESTES_PG_URL=.*#NIVOO_TESTES_PG_URL=$TESTES_URL#" "$ENV_FILE"
  else
    echo "NIVOO_TESTES_PG_URL=$TESTES_URL" >> "$ENV_FILE"
  fi
  ok "mantida (já existia); para mudar porta/endereço edite o arquivo e rode: nivoo restart"
else
  API_TOKEN_LINE="# NIVOO_API_TOKEN=   (opcional; obrigatório se HOST=0.0.0.0)"
  if [ "$NIVOO_HOST" != 127.0.0.1 ] && [ "$NIVOO_HOST" != localhost ]; then
    API_TOKEN_LINE="NIVOO_API_TOKEN=$(openssl rand -hex 24)"
  fi
  umask 027
  cat > "$ENV_FILE" <<EOF
# Nivoo AI Manager — configuração do servidor (NUNCA versionar)
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME
NIVOO_TESTES_PG_URL=$TESTES_URL
HOST=$NIVOO_HOST
PORT=$NIVOO_PORT
NIVOO_WORKSPACES_ROOT=$NIVOO_HOME/data/workspaces
NIVOO_ARTIFACTS_ROOT=$NIVOO_HOME/data/artifacts
NIVOO_WORKER_ID=$(hostname)-worker
$API_TOKEN_LINE
# Contas de IA: conecte pela tela "Contas de IA" (recomendado). Os valores abaixo, se definidos,
# têm prioridade sobre os da tela e só podem ser removidos aqui.
# CLAUDE_CODE_OAUTH_TOKEN=   (token oficial gerado por 'claude setup-token')
# ANTHROPIC_API_KEY=         (alternativa paga ao login do Claude)
# GEMINI_API_KEY=            (alternativa ao login com conta Google)
EOF
  umask 022
  ok "criada"
fi
chown root:"$NIVOO_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"
# O backend e o Prisma leem apps/backend/.env: aponta para a configuração do servidor.
if [ -e "$APP_DIR/apps/backend/.env" ] && [ ! -L "$APP_DIR/apps/backend/.env" ]; then
  mv "$APP_DIR/apps/backend/.env" "$APP_DIR/apps/backend/.env.bak.$(date +%s)"
fi
ln -sfn "$ENV_FILE" "$APP_DIR/apps/backend/.env"

# -----------------------------------------------------------------------------
step "6/9 Dependências e compilação (pode levar alguns minutos)"
cd "$APP_DIR"
npm ci --no-audit --no-fund --loglevel=error
npm run build --silent >/dev/null
# Repara instalações atualizadas com umask restritiva (bug do 'nivoo update' até 2026-11-14): tudo do
# código precisa ser legível pelo serviço; segredos (.env*) e links ficam como estão.
find "$APP_DIR" \( -name '.env*' -o -type l \) -prune -o -exec chmod u+rwX,go+rX {} +
ok "backend e interface compilados"

# Bibliotecas Python do Nivoo Studio; instaladas uma vez e reutilizadas.
step "Nivoo Studio — transcrição, alinhamento e proteção visual"
if [ "${NIVOO_STUDIO_INSTALL:-1}" = 0 ]; then
  warn "Studio Python desativado por NIVOO_STUDIO_INSTALL=0"
else
  bash "$APP_DIR/deploy/install-studio-python.sh" || warn "instalação Python incompleta; consulte /var/log/nivoo-studio-python.log"
fi

# Provisionamento e diagnóstico do toolchain de vídeo no mesmo fluxo de nivoo update.
# O script é idempotente e não baixa CLIs de renderização sem versões fixadas.
step "Nivoo Video — dependências e capacidades"
bash "$APP_DIR/deploy/install-video-toolchain.sh"
# HyperFrames is optional. A registry outage must not abort the existing Studio update.
bash "$APP_DIR/deploy/install-hyperframes.sh" || warn "HyperFrames indisponível. FFmpeg e Remotion continuam operacionais; consulte o preflight acima."

# Navegador sem tela para as FOTOS DAS TELAS nas conferências (nivoo-fotos). A IA não navega: o sistema tira as fotos.
NAVEGADORES=/opt/nivoo/navegadores
install -d -m 755 "$NAVEGADORES"
if PLAYWRIGHT_BROWSERS_PATH="$NAVEGADORES" node node_modules/playwright-core/cli.js install --with-deps chromium >/dev/null 2>&1 \
  || PLAYWRIGHT_BROWSERS_PATH="$NAVEGADORES" node node_modules/playwright-core/cli.js install chromium >/dev/null 2>&1; then
  chmod -R go+rX "$NAVEGADORES"
  ok "navegador sem tela para as fotos das telas ($NAVEGADORES)"
else
  warn "não consegui instalar o navegador sem tela: as fotos das telas ficam indisponíveis (o resto funciona)"
fi
if [ -f "$ENV_FILE" ]; then
  sed -i '/^PLAYWRIGHT_BROWSERS_PATH=/d' "$ENV_FILE"
  echo "PLAYWRIGHT_BROWSERS_PATH=$NAVEGADORES" >> "$ENV_FILE"
fi

# -----------------------------------------------------------------------------
step "7/9 Migrações do banco e modelo padrão"
set -a; . "$ENV_FILE"; set +a
# Serviço antigo parado antes de mudar o banco: o código velho não entende os dados novos (ex.: 0 = sem
# limite de gasto) e bloquearia trabalhos no meio da atualização. Voltam no passo 9; o que estava rodando
# continua de onde parou.
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files nivoo-worker.service >/dev/null 2>&1; then
  systemctl stop nivoo-worker nivoo-api >/dev/null 2>&1 || true
fi
(cd apps/backend && npx prisma migrate deploy >/dev/null)
# O seed mexe nas pastas (git) de data/: roda como o usuário do serviço, dono de tudo em data/, nunca root.
chown -R "$NIVOO_USER:$NIVOO_USER" "$NIVOO_HOME/data"
(cd apps/backend && runuser -u "$NIVOO_USER" -- env HOME="$NIVOO_HOME" node dist/seed.js)
chown -R "$NIVOO_USER:$NIVOO_USER" "$NIVOO_HOME/data"
ok "banco atualizado"

# -----------------------------------------------------------------------------
step "8/9 Claude Code, Codex e Gemini CLI (oficiais)"
if [ "$NIVOO_INSTALL_CLIS" = 1 ]; then
  npm i -g --no-audit --no-fund --loglevel=error @anthropic-ai/claude-code @openai/codex @google/gemini-cli
  find "$NODE_DIR" -type l -prune -o -exec chmod go+rX {} +
  ok "claude $(claude --version 2>/dev/null | awk '{print $1}'), $(codex --version 2>/dev/null), gemini $(gemini --version 2>/dev/null)"
else
  warn "pulado (NIVOO_INSTALL_CLIS=0)"
fi

# Ferramentas que as conferências usam para instalar, testar e compilar os projetos (o pnpm e o yarn não vêm com o
# Node). O cache do corepack é refeito do zero: um download interrompido deixava o pnpm quebrado ("pnpm.cjs" ausente).
step "Ferramentas de projeto (pnpm, yarn)"
npm i -g --no-audit --no-fund --loglevel=error pnpm@10 yarn@1
find "$NODE_DIR" -type l -prune -o -exec chmod go+rX {} +
rm -rf "$NIVOO_HOME/.cache/node/corepack"
ok "pnpm $(pnpm --version 2>/dev/null), yarn $(yarn --version 2>/dev/null)"

# Comando de administração
install -m 755 "$APP_DIR/deploy/nivoo" /usr/local/bin/nivoo

# Prévia dos projetos: com domínio da Cloudflare já configurado, cria o endereço previa-<endereço> no mesmo túnel.
if [ -f /etc/cloudflared/config.yml ] && ! grep -q 'hostname: previa-' /etc/cloudflared/config.yml && [ -x /usr/local/bin/nivoo ]; then
  step "Endereço da prévia dos projetos (Cloudflare)"
  /usr/local/bin/nivoo dominio previa || warn "não consegui criar agora; rode depois: nivoo dominio previa"
fi
sed -i "s#^APP_DIR=.*#APP_DIR=$APP_DIR#" /usr/local/bin/nivoo

# -----------------------------------------------------------------------------
step "9/9 Serviços systemd"
if has_systemd; then
  for svc in api worker; do
    if [ "$svc" = api ]; then CMD="dist/main.js"; DESC="API e interface"; else CMD="dist/worker.js"; DESC="worker (execuções duráveis)"; fi
    # O worker roda as IAs: o ChatGPT (Codex) isola cada comando com namespaces do Linux (bubblewrap); sem eles,
    # nenhum comando dele funciona ("não tenho terminal"). A API continua sem namespaces.
    if [ "$svc" = worker ]; then NAMESPACES="RestrictNamespaces=false"; else NAMESPACES="RestrictNamespaces=true"; fi
    cat > "/etc/systemd/system/nivoo-$svc.service" <<EOF
[Unit]
Description=Nivoo AI Manager — $DESC
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service

[Service]
Type=simple
User=$NIVOO_USER
Group=$NIVOO_USER
WorkingDirectory=$APP_DIR/apps/backend
EnvironmentFile=$ENV_FILE
Environment=HOME=$NIVOO_HOME
Environment=PATH=$NODE_DIR/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE_DIR/bin/node $CMD
Restart=always
RestartSec=3
# Isolamento em nível de sistema operacional
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$NIVOO_HOME
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictRealtime=true
$NAMESPACES
LockPersonality=true
SystemCallArchitectures=native
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
UMask=0027

[Install]
WantedBy=multi-user.target
EOF
  done
  systemctl daemon-reload
  systemctl enable nivoo-api nivoo-worker >/dev/null 2>&1
  systemctl restart nivoo-api nivoo-worker
  for _ in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    ok "nivoo-api e nivoo-worker ativos"
  else
    die "a API não respondeu. Veja: journalctl -u nivoo-api -n 50"
  fi
else
  warn "systemd ausente: serviços não criados (inicie manualmente; ver docs/INSTALACAO-DEBIAN.md)"
fi

# -----------------------------------------------------------------------------
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "${c_b}Instalação concluída.${c_0}"
echo
LOGIN_USR="$(sed -n 's/^NIVOO_LOGIN_USUARIO=//p' "$ENV_FILE" 2>/dev/null)"
if [ -n "$LOGIN_USR" ]; then
  echo "  Interface: acesse pelo seu domínio e entre com usuário (\"$LOGIN_USR\") e senha."
elif [ "${HOST}" = 127.0.0.1 ]; then
  echo "  Interface (só local). No SEU computador, abra um túnel SSH:"
  echo "      ssh -N -L $PORT:127.0.0.1:$PORT root@${IP:-SEU_SERVIDOR}"
  echo "  e acesse: http://localhost:$PORT"
else
  echo "  Interface: http://${IP:-SEU_SERVIDOR}:$PORT"
  echo "  Token de API (cole em 'Conectores e configurações'): $(sed -n 's/^NIVOO_API_TOKEN=//p' "$ENV_FILE")"
fi
echo
echo "  Próximos passos:"
echo "    nivoo login-claude     # login oficial do Claude Code para o worker"
echo "    nivoo login-codex      # login oficial do Codex (código de dispositivo)"
echo "    nivoo check            # confere conectores e serviços"
echo "    nivoo help             # todos os comandos"
