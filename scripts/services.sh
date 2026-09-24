#!/usr/bin/env bash
# ============================================================
# 满语文数智化门户 · 依赖服务一键启停
#
#   三个服务之间互不加载对方的模型，门户只做页面渲染 + 反向代理：
#     OCR 推理服务（8080）  manju_layout 环境
#     TTS 合成服务（7868）  GPT 环境（GPT-SoVITS）
#     门户          （8000）  .venv 轻量环境
#
# 用法：
#   ./scripts/services.sh start     # 启动三个服务
#   ./scripts/services.sh stop      # 停止三个服务
#   ./scripts/services.sh restart   # 重启
#   ./scripts/services.sh status    # 查看存活与端口
#
# 注意：三个服务的进程名都可能包含 "app.py"，因此 PID 与 kill 一律按
#       **解释器的绝对路径**区分，切勿用 pkill -f "python app.py"（会误杀 TTS）。
# ============================================================
set -uo pipefail

PORTAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OCR_DIR="/home/leyesi/ocr_deploy"
TTS_DIR="/home/leyesi/shaopf/manchu_TTS"

# 各服务必须用各自的 conda 环境（唯一装有对应依赖的环境）
OCR_PY="/home/leyesi/miniconda3/envs/manju_layout/bin/python"
TTS_PY="/home/leyesi/miniconda3/envs/GPT/bin/python"
PORTAL_PY="${PORTAL_DIR}/.venv/bin/python"

OCR_PORT="${OCR_PORT:-8080}"
TTS_PORT="${TTS_PORT:-7868}"
PORTAL_PORT="${PORTAL_PORT:-8000}"

LOG_DIR="${PORTAL_DIR}/logs"
mkdir -p "$LOG_DIR"

# 按监听端口反查 PID：比 pgrep -f 可靠——进程的 argv[0] 可能只是 "python"（无路径），
# 用解释器绝对路径去 pgrep 会匹配不到，导致 status 误报"未运行"、stop 也停不掉。
pid_on_port() {
  ss -lntp 2>/dev/null | grep -E ":${1}[^0-9]" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
}

ocr_pid()   { pgrep -f "server.py --host .*--port ${OCR_PORT}" | head -1; }
tts_pid()   { pid_on_port "$TTS_PORT"; }
portal_pid(){ pid_on_port "$PORTAL_PORT"; }

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

start_tts() {
  if [[ -n "$(tts_pid)" ]]; then
    echo "TTS 服务已在运行 (pid $(tts_pid))，跳过"
    return 0
  fi
  if [[ ! -f "$TTS_PY" ]]; then
    echo "跳过 TTS 服务：未找到 GPT 环境解释器 $TTS_PY"
    return 0
  fi
  echo "启动 TTS 服务 :${TTS_PORT}（加载 GPT-SoVITS 模型约需 20~60 秒）..."
  ( cd "$TTS_DIR" && nohup "$TTS_PY" app.py \
      >> "${LOG_DIR}/tts_${TTS_PORT}.log" 2>&1 & )
}

stop_one() {
  local pid=$1 name=$2
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null && echo "  ${name}已停止 (pid $pid)"
  else
    echo "  ${name}未运行"
  fi
}

stop_all() {
  echo "停止服务..."
  stop_one "$(portal_pid)" "门户"
  stop_one "$(ocr_pid)" "OCR 服务"
  stop_one "$(tts_pid)" "TTS 服务"
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
    start_tts
    start_portal
    echo "等待服务就绪..."
    wait_up "http://127.0.0.1:${OCR_PORT}/api/recognize" "OCR 服务" || true
    wait_up "http://127.0.0.1:${TTS_PORT}/healthz" "TTS 服务" || true
    wait_up "http://127.0.0.1:${PORTAL_PORT}/health" "门户"
    echo "完成。门户地址：http://127.0.0.1:${PORTAL_PORT}/"
    echo "  OCR 页面：/ocr/    转换：/translit/    翻译：/translate/    语音合成：/tts/"
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
    op=$(ocr_pid); tp=$(tts_pid); pp=$(portal_pid)
    [[ -n "$op" ]] && echo "OCR 服务 :${OCR_PORT} 运行中 (pid $op)" || echo "OCR 服务 :${OCR_PORT} 未运行"
    [[ -n "$tp" ]] && echo "TTS 服务 :${TTS_PORT} 运行中 (pid $tp)" || echo "TTS 服务 :${TTS_PORT} 未运行"
    [[ -n "$pp" ]] && echo "门户     :${PORTAL_PORT} 运行中 (pid $pp)" || echo "门户     :${PORTAL_PORT} 未运行"
    echo "--- 代理健康检查 ---"
    curl -s -m 5 "http://127.0.0.1:${PORTAL_PORT}/api/ocr/health" || echo "(门户未响应)"
    echo
    curl -s -m 5 "http://127.0.0.1:${PORTAL_PORT}/api/translate/health" | head -c 200 || echo "(门户未响应)"
    echo
    curl -s -m 5 "http://127.0.0.1:${PORTAL_PORT}/api/tts/health" || echo "(门户未响应)"
    echo
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
