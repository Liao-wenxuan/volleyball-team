#!/usr/bin/env bash
set -euo pipefail

STAMP=$(date +%Y%m%d-%H%M)
DEST="$HOME/backups"
KEEP=7
mkdir -p "$DEST"

# 只备份各项目的主库：跳过 */backups/*（那是应用自己生成的滚动备份，
# 再打包一遍等于备份的备份，一天多出 N 个 tar）。
# 文件名带父目录名：~/data/csp/app.db 和 ~/data/volleyball/app.db 都叫 app.db，
# 只按 basename 命名会让两个项目生成同名 tar 互相覆盖。
# 2026-11-08 恢复演练发现：解开当天的 app-*.tar.gz 拿到的是另一个项目的库。
find "$HOME/data" -maxdepth 3 -type f -name '*.db' -not -path '*/backups/*' -print0 | while IFS= read -r -d '' db; do
  name="$(basename "$(dirname "$db")")-$(basename "$db" .db)"
  snap="$DEST/${name}-${STAMP}.db"
  tarfile="$DEST/${name}-${STAMP}.tar.gz"
  sqlite3 "$db" ".backup '$snap'"
  tar czf "$tarfile" -C "$DEST" "$(basename "$snap")"
  rm -f "$snap"
  echo "[$(date '+%F %T')] ok $db -> $(basename "$tarfile")"
done

cd "$HOME"
if find apps -maxdepth 3 -name '.env' -print -quit 2>/dev/null | grep -q .; then
  tar czf "$DEST/env-${STAMP}.tar.gz" $(find apps -maxdepth 3 -name '.env')
fi

find "$DEST" -name '*.tar.gz' -mtime +"$KEEP" -delete
echo "[$(date '+%F %T')] done (keep ${KEEP}d)"
ls -lh "$DEST" | tail -6
