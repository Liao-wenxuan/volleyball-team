#!/usr/bin/env bash
# 生产服务器运维脚本（在服务器上由 server-ops.yml 通过 SSH 通道执行）
#
# 为什么需要它：本机到服务器 22 端口被跨境链路重置，直连不通；GitHub Actions
# runner 在境外可以 SSH。所有生产配置变更走这个脚本，做到「可审计 + 可回滚」。
#
# 用法：bash ~/server-ops.sh probe | fix
#   probe  只读体检，打印 Caddyfile / web 目录 / 响应头 / 健康状态
#   fix    备份 → 三处幂等修改 → caddy validate（失败自动回滚）→ reload → 自检
#
# 三处修改：
#   1. 全局 servers { protocols h1 h2 } 关掉 HTTP/3，Caddy 不再下发 Alt-Svc: h3
#   2. handle /m* 拆成 /m + /m/*，修 /manifest.webmanifest 被前缀匹配吞掉
#   3. vb 站点下发 Alt-Svc: clear，让已缓存 h3 记录的浏览器立刻丢弃
set -euo pipefail

ACTION="${1:-probe}"
CF=/etc/caddy/Caddyfile
WEB="$HOME/apps/volleyball/web"
REPO="$HOME/apps/volleyball/repo"
CADDY_BIN="$(command -v caddy || echo /usr/bin/caddy)"

probe() {
  echo "=== connection ==="
  echo "user=$(whoami) host=$(hostname) date=$(date -Is)"
  echo "=== caddy ==="
  "$CADDY_BIN" version 2>&1 | head -1
  systemctl is-active caddy 2>&1 || true
  if sudo -n true 2>/dev/null; then echo "sudo: nopasswd OK"; else echo "sudo: FAILED"; fi
  echo "=== /etc/caddy/Caddyfile 全文 ==="
  sudo -n cat "$CF"
  echo "=== 已有备份 ==="
  sudo -n ls -la /etc/caddy/Caddyfile* 2>&1 || true
  echo "=== web 目录关键文件 ==="
  ls -la "$WEB" | grep -E "manifest|index.html|sw.js|total" || true
  echo "=== repo 中 manifest ==="
  ls -la "$REPO/manifest.webmanifest" 2>&1 || true
  echo "=== 服务器部署脚本 cp 行 ==="
  grep -nE "cp |WEB=" "$HOME/deploy-volleyball.sh" || true
  echo "=== 本机 TLS 响应头（看 Alt-Svc）==="
  curl -sk -o /dev/null -D - --resolve vb.bscjs.top:443:127.0.0.1 https://vb.bscjs.top/ 2>&1 \
    | grep -iE "^HTTP/|alt-svc|content-type" || true
  echo "=== 本机静态资源 ==="
  for u in /manifest.webmanifest /manifest.webmanifest?v=v67 /sw.js /index.html; do
    printf "%-40s " "$u"
    curl -sk -o /dev/null -w "%{http_code} %{content_type} %{size_download}B\n" \
      --resolve vb.bscjs.top:443:127.0.0.1 "https://vb.bscjs.top$u" || echo FAIL
  done
  echo "=== /admin 与 /m/ 是否仍反代 ==="
  for u in /admin /m/; do
    printf "%-40s " "$u"
    curl -sk -o /dev/null -w "%{http_code} %{content_type}\n" \
      --resolve vb.bscjs.top:443:127.0.0.1 "https://vb.bscjs.top$u" || echo FAIL
  done
  echo "=== API health ==="
  curl -s --max-time 5 http://127.0.0.1:8787/api/health 2>&1 | head -c 250 || true
  echo
  echo "=== probe done ==="
}

fix() {
  BK="/etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M%S)"
  sudo -n cp -a "$CF" "$BK"
  echo "backup: $BK"

  sudo -n python3 - "$CF" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
changed = []

# 1) 全局关 HTTP/3：Caddy 只在启用 h3 时下发 Alt-Svc: h3=":443"
if re.search(r'^\s*protocols\s+h1\s+h2\s*$', s, re.M):
    changed.append('protocols h1 h2: already present (skip)')
else:
    m = re.match(r'^\s*\{\s*\n', s)
    block = '\tservers {\n\t\tprotocols h1 h2\n\t}\n'
    if m:
        s = s[:m.end()] + block + s[m.end():]
        changed.append('protocols h1 h2: inserted into existing global block')
    else:
        s = '{\n' + block + '}\n\n' + s
        changed.append('protocols h1 h2: created global block')

# 2) /m* 是前缀匹配，会连 /manifest.webmanifest 一起吞掉
pat = re.compile(r'(?m)^(\s*)handle\s+/m\*\s*\{')
if pat.search(s):
    def split(mm):
        i = mm.group(1)
        return (f'{i}handle /m {{\n'
                f'{i}\treverse_proxy 127.0.0.1:8787\n'
                f'{i}}}\n'
                f'{i}handle /m/* {{')
    s = pat.sub(split, s, count=1)
    changed.append('handle /m*: split into /m and /m/*')
else:
    changed.append('handle /m*: old rule not found (skip)')

# 3) 已访问过站点的浏览器会缓存 h3 记录最多 30 天，主动下发 clear 立刻清掉
if 'Alt-Svc "clear"' in s:
    changed.append('Alt-Svc clear: already present (skip)')
else:
    s2 = re.sub(r'(?m)^(\s*)(vb\.bscjs\.top\s*\{[^\n]*\n)',
                lambda mm: mm.group(0) + f'{mm.group(1)}\theader Alt-Svc "clear"\n',
                s, count=1)
    if s2 == s:
        raise SystemExit('ERROR: vb.bscjs.top site block not found - abort')
    s = s2
    changed.append('Alt-Svc clear: inserted into vb site')

open(p, 'w', encoding='utf-8').write(s)
print('\n'.join(changed))
PY

  if ! sudo -n "$CADDY_BIN" validate --config "$CF" --adapter caddyfile >/tmp/caddy-validate.log 2>&1; then
    echo "!!! caddy validate FAILED - ROLLBACK !!!"
    cat /tmp/caddy-validate.log
    sudo -n cp -a "$BK" "$CF"
    exit 1
  fi
  echo "caddy validate: OK"

  if [ ! -f "$WEB/manifest.webmanifest" ]; then
    cp -f "$REPO/manifest.webmanifest" "$WEB/"
    echo "manifest: copied from repo"
  else
    echo "manifest: already in web/"
  fi

  if ! sudo -n systemctl reload caddy 2>/tmp/caddy-reload.log; then
    echo "systemctl reload failed, fallback to caddy reload"
    cat /tmp/caddy-reload.log
    if ! sudo -n "$CADDY_BIN" reload --config "$CF" --adapter caddyfile; then
      echo "!!! reload FAILED - ROLLBACK !!!"
      sudo -n cp -a "$BK" "$CF"
      sudo -n systemctl reload caddy || true
      exit 1
    fi
  fi
  echo "caddy reload: OK"
  sleep 2

  echo "=== post-fix checks ==="
  echo "--- 响应头（应无 h3，应有 clear）---"
  curl -sk -o /dev/null -D - --resolve vb.bscjs.top:443:127.0.0.1 https://vb.bscjs.top/ \
    | grep -iE "^HTTP/|alt-svc" || true
  for u in /manifest.webmanifest /manifest.webmanifest?v=v67 /sw.js /app.js?v=v67 /admin /m/; do
    printf "%-40s " "$u"
    curl -sk -o /dev/null -w "%{http_code} %{content_type} %{size_download}B\n" \
      --resolve vb.bscjs.top:443:127.0.0.1 "https://vb.bscjs.top$u" || echo FAIL
  done
  echo "--- API ---"
  curl -s --max-time 5 http://127.0.0.1:8787/api/health | head -c 250 || true
  echo
  echo "=== fix done (backup: $BK) ==="
}

case "$ACTION" in
  probe) probe ;;
  fix)   fix ;;
  *) echo "unknown action: $ACTION (use probe|fix)"; exit 2 ;;
esac
