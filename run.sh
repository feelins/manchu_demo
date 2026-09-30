#!/usr/bin/env bash
# ============================================================
# 满语文数智化门户 · 启停脚本
#
#   ./run.sh              前台运行（systemd 走这个模式；Ctrl+C 停止）
#   ./run.sh start        后台常驻：无 systemd 时的兜底方案
#   ./run.sh stop         停止
#   ./run.sh restart      重启
#   ./run.sh status       查看存活、端口与 PID
#
# 有 systemd 时优先用它（崩溃自愈 + 开机自启 + journal 日志）：
#   systemctl --user start|stop|restart|status manchu-portal
# ============================================================
set -uo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$BASE_DIR" || exit 1

PORT="${PORT:-8000}"
PIDFILE="logs/gunicorn.pid"
LOGFILE="logs/run.log"
GUNICORN=".venv/bin/gunicorn"
mkdir -p logs

running_pid() {
  # 优先用 pidfile，失效时回退到端口反查
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
    cat "$PIDFILE"; return
  fi
  ss -lntp 2>/dev/null | grep -E ":${PORT}[^0-9]" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
}

case "${1:-foreground}" in
  foreground)
    # 前台：由 systemd 或终端托管，进程退出即视为停止
    exec "$GUNICORN" -c gunicorn.conf.py app:app
    ;;
  start)
    pid="$(running_pid)"
    if [ -n "${pid:-}" ]; then
      echo "门户已在运行（pid=${pid}）端口 ${PORT}，无需重复启动"; exit 0
    fi
    if [ ! -x "$GUNICORN" ]; then
      echo "未找到 gunicorn，请先安装：.venv/bin/pip install gunicorn"; exit 1
    fi
    # gunicorn 自己管 daemonize，不需要 nohup；--pid 只给后台模式用（stop 时需要它），
    # 配置里默认不设 pidfile，避免与 systemd 托管冲突，见 gunicorn.conf.py 注释
    PORTAL_BIND="0.0.0.0:${PORT}" "$GUNICORN" -c gunicorn.conf.py app:app --daemon --pid "$PIDFILE"
    sleep 2
    pid="$(running_pid)"
    if [ -n "${pid:-}" ]; then
      echo "门户已后台启动（pid=${pid}）：http://127.0.0.1:${PORT}/"
    else
      echo "启动失败，请查看 logs/gunicorn-error.log"; exit 1
    fi
    ;;
  stop)
    pid="$(running_pid)"
    if [ -z "${pid:-}" ]; then echo "门户未在运行"; exit 0; fi
    kill "$pid" && echo "已停止门户（pid=${pid}）"
    rm -f "$PIDFILE"
    ;;
  restart)
    "$0" stop; sleep 1; "$0" start
    ;;
  status)
    pid="$(running_pid)"
    if [ -n "${pid:-}" ]; then
      echo "运行中：pid=${pid}  端口=${PORT}  http://127.0.0.1:${PORT}/"
      echo "健康：$(curl -s -m 5 "http://127.0.0.1:${PORT}/health")"
    else
      echo "未运行"
    fi
    ;;
  *)
    echo "用法：$0 [foreground|start|stop|restart|status]"; exit 1
    ;;
esac
