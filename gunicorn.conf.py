"""Gunicorn 常驻配置（门户生产运行用）

用法（通常由 run.sh / systemd 调用，不必手动打）：
    .venv/bin/gunicorn -c gunicorn.conf.py app:app

两个关键参数不是随手填的：
  · timeout=600 —— 门户会把 OCR / TTS 的推理请求转发给后端再回源，单次请求可达数分钟
    （/api/tts/ 自身 gateway timeout 就是 600）。worker 超时若小于它，请求会被 gunicorn
    从中间掐断，前端表现为合成到一半报 502。
  · worker_class=gthread —— 门户大量时间耗在"等后端"，是 IO 密集型；
    用线程模型（而非加重 worker 进程）能省内存，也避免每个 worker 都重复初始化。

日志落在 logs/ 下，由 logrotate 或 systemd-journald 处理轮转。
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(BASE_DIR, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

# ---- 监听地址 ----
bind = os.environ.get("PORTAL_BIND", "0.0.0.0:8000")

# ---- 并发模型 ----
workers = int(os.environ.get("PORTAL_WORKERS", 2))
threads = int(os.environ.get("PORTAL_THREADS", 4))
worker_class = "gthread"

# ---- 超时（务必 ≥ 后端 gateway timeout）----
timeout = int(os.environ.get("PORTAL_TIMEOUT", 600))
graceful_timeout = 30
keepalive = 65

# ---- 日志 ----
loglevel = "info"
accesslog = os.path.join(LOG_DIR, "gunicorn-access.log")
errorlog = os.path.join(LOG_DIR, "gunicorn-error.log")
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s %(D)sµs'

# ---- 进程文件 ----
# 【不要在这里设 pidfile】systemd 托管时（Type=simple，前台运行）由 systemd 自己管 PID，
# 若在此处写 pidfile，一旦进程异常退出留下残留文件，下次启动会被 gunicorn 判定为
# "Already running on PID xxx" 而拒绝启动，systemd 随即陷入无限重启。
# 实测踩过：残留 pidfile 导致服务重启计数上万次、页面全部不可访问。
# 只有 `./run.sh start`（--daemon 后台兜底模式）需要 pid 文件，由该脚本用 --pid 传入。
pidfile = None
