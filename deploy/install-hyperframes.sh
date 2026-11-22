#!/usr/bin/env bash
# HyperFrames CLI owned by Nivoo; fixed top-level version, no automatic upgrades.
# Optional capability. Failure is surfaced but does not stop normal video editing.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Execute como root" >&2; exit 1; }
VERSION=0.9.80
PREFIX=/opt/nivoo/hyperframes
id nivoo >/dev/null 2>&1 || { echo "Usuário nivoo ausente" >&2; exit 1; }
install -d -o nivoo -g nivoo -m 750 "$PREFIX"
command -v npm >/dev/null 2>&1 || { echo "npm ausente" >&2; exit 1; }
if [ ! -f "$PREFIX/package.json" ] || ! grep -Fq "\"hyperframes\":\"$VERSION\"" "$PREFIX/package.json"; then
  printf '{"name":"nivoo-hyperframes-runtime","private":true,"version":"1.0.0","dependencies":{"hyperframes":"%s"}}\n' "$VERSION" > "$PREFIX/package.json"
  rm -f "$PREFIX/package-lock.json"
fi
# Never run package lifecycle hooks with root privileges.
chown -R nivoo:nivoo "$PREFIX"
(
  cd "$PREFIX"
  [ -f package-lock.json ] || runuser -u nivoo -- env HOME=/var/lib/nivoo PATH="$PATH" npm install --package-lock-only --ignore-scripts --no-audit --no-fund --loglevel=error
  [ -x node_modules/.bin/hyperframes ] || runuser -u nivoo -- env HOME=/var/lib/nivoo PATH="$PATH" npm ci --no-audit --no-fund --loglevel=error
)
[ -x "$PREFIX/node_modules/.bin/hyperframes" ] || { echo "CLI HyperFrames ausente" >&2; exit 1; }
ln -sfn "$PREFIX/node_modules/.bin/hyperframes" /usr/local/bin/hyperframes
runuser -u nivoo -- env HOME=/var/lib/nivoo PATH="$PATH" HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_TELEMETRY=1 hyperframes browser ensure
echo "HyperFrames $VERSION instalado; modelos externos continuam bloqueados até revisão"
