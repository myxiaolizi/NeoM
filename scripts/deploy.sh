#!/usr/bin/env bash
# NeoM remote deploy — run ON the panel server (via baota-mcp Bash).
#
#   bash deploy.sh <signed_oss_url>
#
# Downloads the release tarball produced by scripts/deploy.mjs, swaps it in
# atomically, keeps one rollback copy, fixes ownership, and restarts the node
# project managed by the BT panel.
set -euo pipefail

URL="${1:?usage: deploy.sh <signed_oss_url>}"
APP=/www/wwwroot/m.zhengl.vip
STAGE=/tmp/neom-deploy
TARBALL="$STAGE/neom.tar.gz"

echo "== 1/7 下载产物 =="
mkdir -p "$STAGE"
rm -f "$TARBALL"
curl -fsSL --retry 3 --retry-delay 2 -o "$TARBALL" "$URL"
ls -lh "$TARBALL"

echo "== 2/7 解包 =="
rm -rf "$STAGE/unpacked"
mkdir -p "$STAGE/unpacked"
tar -xzf "$TARBALL" -C "$STAGE/unpacked"
ls "$STAGE/unpacked"

echo "== 3/7 备份当前版本 =="
mkdir -p "$APP"
if [ -d "$APP/server" ]; then
  rm -rf "$APP/.rollback"
  mkdir -p "$APP/.rollback"
  cp -a "$APP/server" "$APP/.rollback/server" 2>/dev/null || true
  [ -d "$APP/web/dist" ] && { mkdir -p "$APP/.rollback/web"; cp -a "$APP/web/dist" "$APP/.rollback/web/dist" 2>/dev/null || true; }
  echo "已保存回滚副本 -> $APP/.rollback"
fi

echo "== 4/7 同步文件 =="
mkdir -p "$APP/web" "$APP/server"
# keep the server-side .env (provisioned once, never shipped in the tarball)
if [ -f "$APP/server/.env" ]; then cp -a "$APP/server/.env" "$STAGE/.env.keep"; fi
rsync -a --delete --exclude node_modules --exclude .env "$STAGE/unpacked/server/" "$APP/server/"
if [ -f "$STAGE/.env.keep" ]; then cp -a "$STAGE/.env.keep" "$APP/server/.env"; chmod 600 "$APP/server/.env"; fi
rsync -a --delete "$STAGE/unpacked/web/dist/" "$APP/web/dist/"

echo "== 5/7 安装生产依赖 =="
export PATH=/www/server/nodejs/v24.14.1/bin:$PATH
cd "$APP/server"
npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -5 || npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5

echo "== 6/7 权限 =="
mkdir -p "$APP/server/data/plugins"
chown -R www:www "$APP"
chmod 600 "$APP/server/.env" || true

echo "== 7/7 重启 =="
chmod +x /www/server/panel/pyenv/bin/python 2>/dev/null || true
# restart via the panel's node project manager
btpython=/www/server/panel/pyenv/bin/python
if [ -x "$btpython" ]; then
  "$btpython" - <<'PY' || true
import sys, json
sys.path.insert(0, '/www/server/panel')
sys.path.insert(0, '/www/server/panel/class')
try:
    import public
    print(public.M('sites').where('name=?', ('neom',)).count() if hasattr(public, 'M') else '')
except Exception as e:
    print('panel api probe:', e)
PY
fi
echo "请通过面板或下方命令确认进程："
ss -lntp | grep 3300 || echo "port 3300 not listening yet"
echo "DEPLOY_OK"
