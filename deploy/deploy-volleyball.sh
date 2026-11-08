#!/usr/bin/env bash
set -euo pipefail
REPO=/home/deploy/apps/volleyball/repo
WEB=/home/deploy/apps/volleyball/web
API=/home/deploy/apps/volleyball/api

cd "$REPO"
git fetch origin main --depth 50
git reset --hard origin/main
echo "deploy at $(git log --oneline -1)"

# 前端静态
mkdir -p "$WEB"
cp -f index.html style.css manifest.webmanifest *.js "$WEB/"
[ -d assets ] && cp -rf assets/. "$WEB/assets/"

# 后端：源码进 api 目录，装依赖编译，.env/数据库都不动
mkdir -p "$API"
cp -f server/package.json server/package-lock.json server/tsconfig.json "$API/" 2>/dev/null || true
rm -rf "$API/src"
cp -r server/src "$API/src"
mkdir -p "$API/public" && cp -f server/public/* "$API/public/"
cp -r server/scripts "$API/scripts"
cd "$API"
if [ ! -d node_modules ] || [ ! -x node_modules/.bin/tsc ] || ! cmp -s "$REPO/server/package-lock.json" "$API/package-lock.json"; then
  npm ci --no-audit --no-fund 2>&1 | tail -2
fi
npm run build 2>&1 | tail -2

pm2 restart volleyball-api 2>/dev/null || pm2 start ecosystem.config.cjs
sleep 2
curl -sf localhost:8787/api/health >/dev/null && echo "health OK"
pm2 status volleyball-api | tail -2
