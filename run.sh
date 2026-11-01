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
#
# 本地浏览（SSH 隧道）：本机若不在服务所在机，需先建隧道把远程端口映射回本地，
#   再访问 http://127.0.0.1:8002 。建立隧道的命令（按实际远程主机/端口调整）：
#     ssh -L 8002:127.0.0.1:8002 leyesi@10.22.0.17
#   说明：上式把「本机 8002」映射到「远程 127.0.0.1:8002」。若门户实际监听 8000，
#   则改用 ssh -L 8002:127.0.0.1:8000 ...（本地仍用 8002 访问，无需改 PORT）。
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

# 通用：确保某个依赖服务（由 systemd --user 托管）被拉起；失败仅影响对应功能，不阻断门户
ensure_service() {
  local name="$1" port="$2" feat="$3"
  if command -v systemctl >/dev/null 2>&1 && systemctl --user cat "$name" >/dev/null 2>&1; then
    if systemctl --user is-active --quiet "$name"; then
      echo "${feat}服务 ${name} 已在运行（端口 ${port}）"
    elif systemctl --user start "$name" >/dev/null 2>&1; then
      echo "已拉起 ${feat}服务 ${name}（端口 ${port}）"
    else
      echo "警告：${name} 启动失败，${feat}功能将不可用（不影响门户其余功能）"
    fi
  else
    echo "提示：未找到 ${name} 服务，${feat}功能将不可用"
  fi
}
ensure_ocr()      { ensure_service manchu-ocr 8080 "OCR 识别"; }
ensure_detect()   { ensure_service manchu-detect 7860 "AI 画框检测"; }
ensure_translate(){ ensure_service manchu-translate-8001 8001 "满汉翻译"; }

# 探测门户与各上游的映射是否连通（端口已在 systemd unit 中固定）
check_mappings() {
  echo "服务映射检查（门户 ${PORT} → 上游）："
  printf "  OCR(8080)        : %s\n" "$(curl -s -m5 "http://127.0.0.1:${PORT}/api/ocr/health" 2>/dev/null | grep -o '"upstream_alive":[a-z]*' || echo n/a)"
  printf "  Detect(7860)     : %s\n" "$(curl -s -m5 "http://127.0.0.1:7860/health" 2>/dev/null | grep -o '"model_loaded":[a-z]*' || echo n/a)"
  printf "  翻译模型在线数   : %s\n" "$(curl -s -m5 "http://127.0.0.1:${PORT}/api/translate/health" 2>/dev/null | grep -o '"alive": *true' | wc -l) 个"
}

case "${1:-foreground}" in
  foreground)
    # 前台：由 systemd 或终端托管，进程退出即视为停止
    exec "$GUNICORN" -c gunicorn.conf.py app:app
    ;;
  start)
    ensure_ocr
    ensure_detect
    ensure_translate
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
      check_mappings
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
      check_mappings
    else
      echo "未运行"
    fi
    ;;
  *)
    echo "用法：$0 [foreground|start|stop|restart|status]"; exit 1
    ;;
esac
