"""满语语音合成 TTS（蓝图）

职责：
1. `/tts/`              渲染移植后的合成页面（templates/tts/index.html）
2. `/api/tts/*`         反向代理到真实的 TTS 推理服务（默认 http://127.0.0.1:7868）

上游服务：`/home/leyesi/shaopf/manchu_TTS/app.py`（FastAPI，端口 7868）
接口契约（据其源码）：
    GET  /healthz              -> {"ok": true}
    POST /api/convert          {"text"} -> {source_text, latin_text, cmudict_tokens, cmudict_text}
    POST /api/synthesize       {"text"} -> {audio_url, spectrogram_url, latin_text,
                                            cmudict_text, reference_audio, reference_text}
    GET  /generated/<file>     合成产物（wav / 频谱 png）

关于 /generated 的处理（本模块唯一的非平凡点）：
上游返回的 audio_url 形如 `/generated/manchu_xxx.wav`，这个路径挂在 TTS 服务根下，
门户不知道它。因此代理做两件事：
1. synthesize 的响应里把这两个 URL 改写成 `/api/tts/media/<文件名>`
2. 提供 `/api/tts/media/<filename>` 回源取字节，前端即可零改动播放

环境变量：
    TTS_UPSTREAM=http://host:7868   上游地址
    TTS_TIMEOUT=600                 合成超时（秒），CPU 推理较慢故放宽
"""

import mimetypes
import os
import urllib.error
import urllib.request

from flask import Blueprint, jsonify, render_template, request

TTS_UPSTREAM = os.environ.get("TTS_UPSTREAM", "http://127.0.0.1:7868").rstrip("/")

# 文本转化很快；CPU 合成单句实测约需数十秒，首次还要加载模型，故统一放宽到 10 分钟
TTS_TIMEOUT = int(os.environ.get("TTS_TIMEOUT", 600))


def _forward(path, payload=None, timeout=TTS_TIMEOUT, method=None):
    """把 JSON 请求转发到上游，返回 (status, body_bytes, content_type)。"""
    data = None
    headers = {"Accept": "*/*"}
    if payload is not None:
        import json
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(
        f"{TTS_UPSTREAM}{path}",
        data=data,
        headers=headers,
        method=method or ("POST" if payload is not None else "GET"),
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read(), resp.headers.get("Content-Type", "")


def _upstream_error(e, what):
    """统一的错误出口，尽量把上游的原始响应带回来。"""
    if isinstance(e, urllib.error.HTTPError):
        detail = e.read().decode("utf-8", "replace")
        try:
            import json
            detail = json.loads(detail).get("detail", detail)
        except Exception:
            pass
        return jsonify({"error": f"TTS 服务返回 {e.code}",
                        "detail": detail,
                        "hint": f"上游：{TTS_UPSTREAM}"}), 502
    if isinstance(e, urllib.error.URLError):
        return jsonify({
            "error": f"无法连接 TTS 服务（{TTS_UPSTREAM}）",
            "detail": str(e.reason),
            "hint": "请在 manchu_TTS 目录启动服务，或设置 TTS_UPSTREAM 指向运行中的机器",
        }), 502
    return jsonify({"error": f"{what}失败", "detail": str(e)}), 500


def _rewrite_media_url(url):
    """`/generated/x.wav` -> `/api/tts/media/x.wav`（只保留文件名，避免路径穿越）"""
    if not url:
        return url
    return "/api/tts/media/" + os.path.basename(url)


# ---------------------------------------------------------------
# 蓝图
# ---------------------------------------------------------------
tts_bp = Blueprint("tts", __name__, url_prefix="/tts")
tts_api_bp = Blueprint("tts_api", __name__, url_prefix="/api/tts")


@tts_bp.route("/")
def index():
    return render_template("tts/index.html")


@tts_api_bp.route("/convert", methods=["POST"])
def convert():
    """文本规范化 + 音素预测（不合成音频，速度快）。"""
    payload = request.get_json(silent=True) or {}
    text = (payload.get("text") or "").strip()
    if not text:
        return jsonify({"error": "请输入满语文本"}), 400

    try:
        status, body, _ = _forward("/api/convert", {"text": text}, timeout=30)
    except Exception as e:
        return _upstream_error(e, "文本转化")

    import json
    try:
        data = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        return jsonify({"error": "上游返回不是合法 JSON"}), 502
    return jsonify(data), status


@tts_api_bp.route("/synthesize", methods=["POST"])
def synthesize():
    """合成语音，并把 audio_url / spectrogram_url 改写成门户可访问的路径。"""
    payload = request.get_json(silent=True) or {}
    text = (payload.get("text") or "").strip()
    if not text:
        return jsonify({"error": "请输入满语文本"}), 400

    try:
        status, body, _ = _forward("/api/synthesize", {"text": text})
    except Exception as e:
        return _upstream_error(e, "语音合成")

    import json
    try:
        data = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        return jsonify({"error": "上游返回不是合法 JSON"}), 502

    data["audio_url"] = _rewrite_media_url(data.get("audio_url"))
    data["spectrogram_url"] = _rewrite_media_url(data.get("spectrogram_url"))
    return jsonify(data), status


@tts_api_bp.route("/media/<path:filename>")
def media(filename):
    """回源取合成产物（wav / 频谱图）。

    filename 经 basename 归一，避免上游路径被外部控制（路径穿越）。
    """
    safe = os.path.basename(filename)
    if not safe:
        return jsonify({"error": "文件名非法"}), 400

    try:
        status, body, content_type = _forward(f"/generated/{safe}", timeout=60)
    except Exception as e:
        return _upstream_error(e, "获取音频")

    ctype = content_type or (mimetypes.guess_type(safe)[0] or "application/octet-stream")
    return body, status, {
        "Content-Type": ctype,
        "Content-Disposition": f"inline; filename={safe}",
    }


@tts_api_bp.route("/health")
def health():
    """探测 TTS 服务是否在线。"""
    try:
        status, body, _ = _forward("/healthz", timeout=8)
        alive = status < 500
    except urllib.error.HTTPError:
        # 进程在，只是没这个路由
        alive = True
    except Exception:
        alive = False

    return jsonify({
        "portal": "ok",
        "upstream": TTS_UPSTREAM,
        "upstream_alive": alive,
        "timeout": TTS_TIMEOUT,
    }), 200 if alive else 503
