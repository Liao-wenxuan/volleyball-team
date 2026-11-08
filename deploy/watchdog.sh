#!/usr/bin/env bash
# 内存看门狗 —— 只告警、留证据，绝不自动杀进程。
#
# 背景：2026-11-06 这台 1.6G 机器被同住的 Docker build + 无限重启容器拖到
# journal 里 "Under memory pressure" 连刷 252 次、全站 0 字节超时 54 分钟，
# 而且没有 OOM-killer 记录 —— OS 不会替你收尸，得自己提前看到苗头。
#
# 设计取舍：
# - 连续 CONFIRM 次超阈值才告警，一次抖动不刷屏。
# - 不 stop / restart 任何进程：误杀线上服务的代价比晚几分钟发现大得多。
# - 整机真僵死时 cron 也不会跑，所以必须配外部探活兜底（.github/workflows/monitor.yml）。
# - state 存最新数值，日志只在状态翻转时写，避免 2 分钟一行把盘刷满。
#
# 部署：crontab 每 2 分钟跑一次；见仓库根目录 README「可观测性」一节。
# 覆盖阈值可用环境变量调，便于演练：WATCHDOG_MIN_AVAILABLE_MB=999999 WATCHDOG_CONFIRM=1 WATCHDOG_DRY_RUN=1

set -euo pipefail

DATA_DIR="${WATCHDOG_DATA_DIR:-$HOME/data/volleyball}"
LOG_FILE="${WATCHDOG_LOG:-$DATA_DIR/watchdog.log}"
STATE_FILE="${WATCHDOG_STATE:-$DATA_DIR/watchdog.state}"
MIN_AVAILABLE_MB="${WATCHDOG_MIN_AVAILABLE_MB:-200}"
MIN_SWAP_FREE_MB="${WATCHDOG_MIN_SWAP_FREE_MB:-512}"
MAX_LOAD="${WATCHDOG_MAX_LOAD:-4}"
CONFIRM="${WATCHDOG_CONFIRM:-3}"
DRY_RUN="${WATCHDOG_DRY_RUN:-0}"

if [ ! -r /proc/meminfo ]; then
  echo "watchdog: /proc/meminfo 不可读（仅支持 Linux），跳过"
  exit 0
fi
mkdir -p "$DATA_DIR"

read_kb() { awk -v k="$1" '$1 == k { print $2; exit }' /proc/meminfo; }

avail_kb=$(read_kb 'MemAvailable:')
swap_total_kb=$(read_kb 'SwapTotal:')
swap_free_kb=$(read_kb 'SwapFree:')
# 某些非 Linux 的 /proc 模拟层（Git Bash / MSYS）也有 meminfo 但字段不全；
# 拿不到数字就跳过，千万别把「读不到」当成「内存 0MB」发出去告警。
case "$avail_kb" in '' | *[!0-9]*)
  echo 'watchdog: /proc/meminfo 缺少 MemAvailable，跳过'
  exit 0
  ;;
esac
case "$swap_total_kb" in '' | *[!0-9]*) swap_total_kb=0 ;; esac
case "$swap_free_kb" in '' | *[!0-9]*) swap_free_kb="$swap_total_kb" ;; esac
avail_mb=$((avail_kb / 1024))
swap_free_mb=$((swap_free_kb / 1024))
swap_used_mb=$(((swap_total_kb - swap_free_kb) / 1024))
load1=$(awk '{ print $1 }' /proc/loadavg)
ts=$(date '+%F %T %z')

reasons=()
if [ "$avail_mb" -lt "$MIN_AVAILABLE_MB" ]; then
  reasons+=("可用内存 ${avail_mb}MB < ${MIN_AVAILABLE_MB}MB")
fi
if [ "$swap_total_kb" -gt 0 ] && [ "$swap_free_mb" -lt "$MIN_SWAP_FREE_MB" ]; then
  reasons+=("swap 剩余 ${swap_free_mb}MB < ${MIN_SWAP_FREE_MB}MB（已用 ${swap_used_mb}MB）")
fi
if awk -v l="$load1" -v m="$MAX_LOAD" 'BEGIN { exit !(l > m) }'; then
  reasons+=("load1 ${load1} > ${MAX_LOAD}")
fi
bad=0
[ "${#reasons[@]}" -gt 0 ] && bad=1

prev_status=ok
consecutive=0
if [ -f "$STATE_FILE" ]; then
  v=$(grep '^status=' "$STATE_FILE" 2>/dev/null | cut -d= -f2 || true)
  [ -n "$v" ] && prev_status="$v"
  v=$(grep '^consecutive=' "$STATE_FILE" 2>/dev/null | cut -d= -f2 || true)
  case "$v" in '' | *[!0-9]*) v=0 ;; esac
  consecutive="$v"
fi

if [ "$bad" = 1 ]; then
  consecutive=$((consecutive + 1))
else
  consecutive=0
fi
next_status="$prev_status"
[ "$bad" = 0 ] && next_status=ok
if [ "$bad" = 1 ] && [ "$consecutive" -ge "$CONFIRM" ]; then
  next_status=alert
fi

reason_text=$(IFS='; '; echo "${reasons[*]-}")
echo "[$ts] status=$next_status bad=$bad consecutive=$consecutive avail=${avail_mb}MB swap_free=${swap_free_mb}MB load1=${load1} ${reason_text}"

top_procs() {
  (ps -eo pid,comm,rss --sort=-rss 2>/dev/null || ps aux --sort=-rss 2>/dev/null || true) | head -7
}

if [ "$DRY_RUN" = 1 ]; then
  echo "[DRY_RUN] 不写 state / log。状态翻转会发生：${prev_status} -> ${next_status}"
  if [ "$next_status" = alert ] && [ "$prev_status" != alert ]; then
    echo "[DRY_RUN] 将写 ALERT 日志，附 Top RSS 进程："
    top_procs | sed 's/^/  /'
  fi
  exit 0
fi

# 先写临时文件再 mv，避免探活读到半截 state
{
  echo "status=$next_status"
  echo "consecutive=$consecutive"
  echo "updated_at=$ts"
  echo "available_mb=$avail_mb"
  echo "swap_free_mb=$swap_free_mb"
  echo "swap_used_mb=$swap_used_mb"
  echo "load1=$load1"
  echo "min_available_mb=$MIN_AVAILABLE_MB"
} > "$STATE_FILE.tmp"
mv -f "$STATE_FILE.tmp" "$STATE_FILE"

if [ "$next_status" = alert ] && [ "$prev_status" != alert ]; then
  {
    echo "[$ts] ALERT ${reason_text}（连续 ${consecutive} 次 ≥ ${CONFIRM}）"
    echo "  采样: avail=${avail_mb}MB swap_free=${swap_free_mb}MB swap_used=${swap_used_mb}MB load1=${load1}"
    echo "  Top RSS 进程:"
    top_procs | sed 's/^/  /'
  } >> "$LOG_FILE"
  if command -v logger >/dev/null 2>&1; then
    logger -t volleyball-watchdog "ALERT ${reason_text}" || true
  fi
elif [ "$next_status" = ok ] && [ "$prev_status" = alert ]; then
  echo "[$ts] RECOVERED avail=${avail_mb}MB swap_free=${swap_free_mb}MB load1=${load1}" >> "$LOG_FILE"
  if command -v logger >/dev/null 2>&1; then
    logger -t volleyball-watchdog "RECOVERED" || true
  fi
fi
