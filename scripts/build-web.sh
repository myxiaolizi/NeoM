#!/usr/bin/env bash
# build-web.sh — build the NeoM web bundle (web/dist) and verify the output.
#
#   ./scripts/build-web.sh
#   VITE_API_BASE=http://127.0.0.1:3300 ./scripts/build-web.sh --clean
#
# Exit code is non-zero on any failure so CI / package-all can stop early.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT/web"
DIST_DIR="$WEB_DIR/dist"
API_BASE="${VITE_API_BASE:-https://m.zhengl.vip}"
SKIP_INSTALL=0
CLEAN=0

for arg in "$@"; do
  case "$arg" in
    --skip-install) SKIP_INSTALL=1 ;;
    --clean) CLEAN=1 ;;
    -h|--help)
      sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$1"; }
ok()   { printf '  OK  %s\n' "$1"; }
warn() { printf '  !!  %s\n' "$1"; }

command -v node >/dev/null 2>&1 || { echo "node not found (need Node 20+)" >&2; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "npm not found" >&2; exit 1; }
echo "node: $(node -v)  npm: $(npm -v)"

if [ "$CLEAN" = "1" ] && [ -d "$DIST_DIR" ]; then
  step "Cleaning $DIST_DIR"
  rm -rf "$DIST_DIR"
  ok "dist removed"
fi

if [ "$SKIP_INSTALL" = "0" ]; then
  step "Installing web dependencies"
  ( cd "$WEB_DIR" && npm install --no-audit --no-fund )
  ok "dependencies installed"
fi

step "Building web bundle (VITE_API_BASE=$API_BASE)"
export VITE_API_BASE="$API_BASE"
( cd "$WEB_DIR" && npm run build )

step "Verifying build output"
[ -f "$DIST_DIR/index.html" ] || { echo "web/dist/index.html missing" >&2; exit 1; }
ok "web/dist/index.html present"

if [ -d "$DIST_DIR/assets" ]; then
  js_count=$(find "$DIST_DIR/assets" -maxdepth 1 -name '*.js' -type f | wc -l | tr -d ' ')
  css_count=$(find "$DIST_DIR/assets" -maxdepth 1 -name '*.css' -type f | wc -l | tr -d ' ')
  ok "assets: ${js_count} js, ${css_count} css"
  [ "$js_count" -gt 0 ] || warn "no JS chunks found — did the build really succeed?"
fi

size_bytes=$(du -sk "$DIST_DIR" | awk '{print $1 * 1024}')
ok "bundle size: $(awk "BEGIN{printf \"%.2f\", $size_bytes/1048576}") MB"

step "Writing build stamp"
cat > "$DIST_DIR/neom-build.json" <<JSON
{
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "apiBase": "$API_BASE",
  "bytes": $size_bytes,
  "node": "$(node -v)"
}
JSON
ok "build stamp: $DIST_DIR/neom-build.json"

printf '\nWeb build succeeded -> %s\n' "$DIST_DIR"
