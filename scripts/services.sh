#!/usr/bin/env bash
# ============================================================
# 满语文数智化门户 · 依赖服务一键启停
#
#   OCR 推理服务（8080）必须先于门户（8000）可用；
#   门户不加载模型，只做页面渲染 + /api/ocr 反向代理。
#
# 用法：
#   ./scripts/services.sh start     # 启动两个服务
#   ./scripts/services.sh stop      # 停止两个服务
#   ./scripts/services.sh restart   # 重启
#   ./scripts/services.sh status    # 查看存活与端口
# ============================================================
set -uo pipefail

PORTAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OCR_DIR="/home/leyesi/ocr_deploy"

# OCR 服务必须用 manju_layout 环境（唯一装有 paddle + mmdet 的环境）
OCR_PY="/home/leyesi/miniconda3/envs/manju_layout/bin/python"
PORTAL_PY="${PORTAL_DIR}/.venv/bin/python"

OCR_PORT="${OCR_PORT:-8080}"
PORTAL_PORT="${PORTAL_PORT:-8000}"

LOG_DIR="${PORTAL_DIR}/logs"
mkdir -p "$LOG_DIR"

ocr_pid()   { pgrep -f "server.py --host .*--port ${OCR_PORT}" | head -1; }
portal_pid(){ pgrep -f "python app.py" | head -1; }

start_ocr() {
  if [[ -n "$(ocr_pid)" ]]; then
    echo "OCR 服务已在运行 (pid $(ocr_pid))，跳过"
    return 0
  fi
  echo "启动 OCR 服务 :${OCR_PORT}（加载模型约需 60~90 秒）..."
  ( cd "$OCR_DIR" && nohup "$OCR_PY" server.py --host 0.0.0.0 --port "$OCR_PORT" \
      >> "${LOG_DIR}/ocr_${OCR_PORT}.log" 2>&1 & )
}

start_portal() {
  if [[ -n "$(portal_pid)" ]]; then
    echo "门户已在运行 (pid $(portal_pid))，跳过"
    return 0
  fi
  echo "启动门户 :${PORTAL_PORT} ..."
  ( cd "$PORTAL_DIR" && PORT="$PORTAL_PORT" nohup "$PORTAL_PY" app.py \
      >> "${LOG_DIR}/portal.log" 2>&1 & )
}

stop_all() {
  echo "停止服务..."
  pkill -f "python app.py" 2>/dev/null && echo "  门户已停止"
  pkill -f "server.py --host" 2>/dev/null && echo "  OCR 服务已停止"
}

wait_up() {
  local url=$1 name=$2
  for i in $(seq 1 60); do
    if curl -s -o /dev/null -m 2 "$url"; then
      echo "  ${name} 就绪：${url}"
      return 0
    fi
    sleep 2
  done
  echo "  ${name} 超时未就绪（模型加载较慢？查看 ${LOG_DIR}/）"
  return 1
}

case "${1:-start}" in
  start)
    start_ocr
    start_portal
    echo "等待服务就绪..."
    wait_up "http://127.0.0.1:${OCR_PORT}/api/recognize" "OCR 服务" || true
    wait_up "http://127.0.0.1:${PORTAL_PORT}/health" "门户"
    echo "完成。门户地址：http://127.0.0.1:${PORTAL_PORT}/  OCR 页面：/ocr/"
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    sleep 3
    exec "$0" start
    ;;
  status)
    op=$(ocr_pid); pp=$(portal_pid)
    [[ -n "$op" ]] && echo "OCR 服务 :${OCR_PORT} 运行中 (pid $op)" || echo "OCR 服务 :${OCR_PORT} 未运行"
    [[ -n "$pp" ]] && echo "门户     :${PORTAL_PORT} 运行中 (pid $pp)" || echo "门户     :${PORTAL_PORT} 未运行"
    echo "--- 代理健康检查 ---"
    curl -s -m 5 "http://127.0.0.1:${PORTAL_PORT}/api/ocr/health" || echo "(门户未响应)"
    echo
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
