#!/usr/bin/env bash
# HyperFrames CLI owned by Nivoo; fixed top-level version, no automatic upgrades.
# Optional capability. Failure is surfaced but does not stop normal video editing.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Execute como root" >&2; exit 1; }
VERSION=0.9.80
GSAP_VERSION=3.14.2
PREFIX=/opt/nivoo/hyperframes
id nivoo >/dev/null 2>&1 || { echo "Usuário nivoo ausente" >&2; exit 1; }
install -d -o nivoo -g nivoo -m 750 "$PREFIX"
command -v npm >/dev/null 2>&1 || { echo "npm ausente" >&2; exit 1; }
if [ ! -f "$PREFIX/package.json" ] || ! grep -Fq "\"hyperframes\":\"$VERSION\"" "$PREFIX/package.json" || ! grep -Fq "\"gsap\":\"$GSAP_VERSION\"" "$PREFIX/package.json"; then
  printf '{"name":"nivoo-hyperframes-runtime","private":true,"version":"1.0.0","dependencies":{"hyperframes":"%s","gsap":"%s"}}\n' "$VERSION" "$GSAP_VERSION" > "$PREFIX/package.json"
  rm -f "$PREFIX/package-lock.json"
fi
# Never run package lifecycle hooks with root privileges.
chown -R nivoo:nivoo "$PREFIX"
(
  cd "$PREFIX"
  [ -f package-lock.json ] || runuser -u nivoo -- env -i HOME=/var/lib/nivoo PATH="$PATH" LANG="${LANG:-C.UTF-8}" npm install --package-lock-only --ignore-scripts --no-audit --no-fund --loglevel=error
  { [ -x node_modules/.bin/hyperframes ] && [ -s node_modules/gsap/dist/gsap.min.js ]; } || runuser -u nivoo -- env -i HOME=/var/lib/nivoo PATH="$PATH" LANG="${LANG:-C.UTF-8}" npm ci --no-audit --no-fund --loglevel=error
)
[ -x "$PREFIX/node_modules/.bin/hyperframes" ] || { echo "CLI HyperFrames ausente" >&2; exit 1; }
[ -s "$PREFIX/node_modules/gsap/dist/gsap.min.js" ] || { echo "Runtime GSAP ausente" >&2; exit 1; }
ln -sfn "$PREFIX/node_modules/.bin/hyperframes" /usr/local/bin/hyperframes
runuser -u nivoo -- env -i HOME=/var/lib/nivoo PATH="$PATH" LANG="${LANG:-C.UTF-8}" HYPERFRAMES_NO_UPDATE_CHECK=1 HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_TELEMETRY=1 hyperframes browser ensure
echo "HyperFrames $VERSION instalado; modelos externos continuam bloqueados até revisão"
