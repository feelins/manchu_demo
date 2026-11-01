"""古籍 OCR 模块（蓝图）

职责：
1. `/ocr/`            渲染移植后的 OCR 页面（templates/ocr/index.html）
2. `/api/ocr/*`       反向代理到真实 OCR 推理服务（默认 http://127.0.0.1:8080）

前端一律使用相对路径 `/api/ocr`，由门户统一转发，
避免在浏览器里硬编码后端 IP/端口（跨机访问时 localhost 会失效）。

上游地址可用环境变量 OCR_UPSTREAM 覆盖，例如：
    OCR_UPSTREAM=http://192.168.1.20:8080 .venv/bin/python app.py
"""

import json
import os
import urllib.error
import urllib.request

from flask import Blueprint, jsonify, render_template, request

# 真实 OCR 推理服务（加载 paddle + mmdet 模型，与门户进程分离）
OCR_UPSTREAM = os.environ.get("OCR_UPSTREAM", "http://127.0.0.1:8080").rstrip("/")

# 版面分析 + 识别的单次请求上限；CPU 推理实测约 3~10s，留足余量
OCR_TIMEOUT = int(os.environ.get("OCR_TIMEOUT", 300))

# 页面蓝图：/ocr/
def _prune_chinese_columns(body: bytes, want_chinese: bool) -> bytes:
    """未开启汉字识别时，上游仍会返回 text 为空的 chinese 列。

    这里按索引同步剔除 columns 与 column_thumbs，避免页面渲染出空列、
    以及状态栏「共 N 列」虚高。解析失败时原样返回，绝不吞掉正常结果。
    """
    if want_chinese:
        return body
    try:
        payload = json.loads(body.decode("utf-8"))
    except Exception:
        return body

    columns = payload.get("columns")
    if not isinstance(columns, list):
        return body

    keep = [i for i, c in enumerate(columns)
            if not (isinstance(c, dict) and c.get("type") == "chinese")]
    if len(keep) == len(columns):
        return body

    payload["columns"] = [columns[i] for i in keep]
    thumbs = payload.get("column_thumbs")
    if isinstance(thumbs, list) and len(thumbs) == len(columns):
        payload["column_thumbs"] = [thumbs[i] for i in keep]
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


ocr_bp = Blueprint("ocr", __name__, url_prefix="/ocr")

# 接口蓝图：/api/ocr/（单独注册，避免被 /ocr 前缀污染）
ocr_api_bp = Blueprint("ocr_api", __name__, url_prefix="/api/ocr")


@ocr_bp.route("/")
def index():
    return render_template("ocr/index.html")


@ocr_api_bp.route("/recognize", methods=["POST"])
def recognize():
    """转发图片到 OCR 服务并原样返回结果。

    请求体为 multipart/form-data（image / model_type / recognize_chinese），
    这里不做解析，直接透传原始字节与 Content-Type，避免二次编码导致图片损坏。
    """
    upstream_url = f"{OCR_UPSTREAM}/api/recognize"

    # 顺序要紧：先 get_data() 让 werkzeug 缓存原始字节，之后 request.form 才能从缓存解析。
    # 若先读 form，流会被消费，get_data() 返回空，转发到上游就会 400（缺少 image）。
    raw_body = request.get_data()
    want_chinese = request.form.get("recognize_chinese", "0") not in ("0", "false", "False", "")

    headers = {
        "Content-Type": request.headers.get("Content-Type", ""),
        "Accept": "application/json",
    }

    try:
        req = urllib.request.Request(
            upstream_url,
            data=raw_body,
            headers=headers,
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=OCR_TIMEOUT) as resp:
            body = resp.read()
            content_type = resp.headers.get("Content-Type", "application/json")
            body = _prune_chinese_columns(body, want_chinese)
            return body, resp.status, {"Content-Type": content_type}
    except urllib.error.HTTPError as e:
        # 上游返回了非 2xx，尽量把原始响应体带回来
        body = e.read()
        try:
            return jsonify({"error": f"OCR 服务返回 {e.code}", "detail": body.decode("utf-8")}), e.code
        except UnicodeDecodeError:
            return jsonify({"error": f"OCR 服务返回 {e.code}"}), e.code
    except urllib.error.URLError as e:
        return jsonify({
            "error": f"无法连接 OCR 服务（{OCR_UPSTREAM}）",
            "detail": str(e.reason),
            "hint": "请先在 ocr_deploy 目录启动：python server.py --port 8080",
        }), 502
    except Exception as e:  # pragma: no cover - 兜底
        return jsonify({"error": "OCR 请求失败", "detail": str(e)}), 500


@ocr_api_bp.route("/health")
def health():
    """检查上游 OCR 服务是否在线，用于页面/运维探测。"""
    try:
        req = urllib.request.Request(f"{OCR_UPSTREAM}/api/recognize", method="GET")
        urllib.request.urlopen(req, timeout=5)
        alive = True
    except urllib.error.HTTPError:
        # 405/400 都说明进程在，只是没走 POST
        alive = True
    except Exception:
        alive = False

    return jsonify({
        "portal": "ok",
        "upstream": OCR_UPSTREAM,
        "upstream_alive": alive,
    }), 200 if alive else 503
