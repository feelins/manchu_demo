"""满汉双向翻译（蓝图）

职责：
1. `/translate/`          渲染移植后的翻译页面（templates/translate/index.html）
2. `/api/translate/*`     反向代理到三个翻译模型服务，并**抹平协议差异**

上游服务现状（2026-09-24 核实，详见 docs/08-满汉双向翻译模块移植记录.md）：
- 三个翻译服务原本由 Windows 机上的「服务启动器」拉起，
  脚本 `api_server_v3_lora_gguf.py` / `api_server_v3_llama_q8_fix.py` **本机不存在**
- 因此本模块**无法在本机端到端联调**，代理链路用本地 mock 服务完成验证
- 把服务迁到本机、或改用远程地址时，只需设置环境变量，不必改代码

为什么必须代理，而不是让浏览器直连源页面里的 `http://localhost:8003`：
1. 门户对外提供服务时，浏览器所在机器未必是运行模型的机器（localhost 会失效）
2. 8001/8003 用自定义的 `/translate`，8005 用 OpenAI 兼容的 `/v1/chat/completions`，
   协议不统一；代理层统一成 `{text, direction, model} -> {translation}`，前端简单
3. 统一超时与错误返回，避免页面直接暴露上游堆栈

环境变量（覆盖默认上游地址）：
    TRANSLATE_UPSTREAM_8001=http://host:8001
    TRANSLATE_UPSTREAM_8003=http://host:8003
    TRANSLATE_UPSTREAM_8005=http://host:8005
    TRANSLATE_TIMEOUT=300          # 单次翻译超时（秒），CPU 推理较慢，默认放宽
"""

import json
import os
import urllib.error
import urllib.request

from flask import Blueprint, jsonify, render_template, request

# ---------------------------------------------------------------
# 模型注册表
#
# protocol 两类，与源页面保持一致：
#   simple : 8001 / 8003，POST /translate，body {text, direction} -> {translation}
#   openai : 8005，llama-server，POST /v1/chat/completions（OpenAI 兼容）
# ---------------------------------------------------------------
MODEL_REGISTRY = {
    "8001": {
        "name": "旧模型 (GGUF Q8_0)",
        "short": "GGUF Q8_0",
        "protocol": "simple",
    },
    "8003": {
        "name": "新模型 (LoRA-GGUF)",
        "short": "LoRA 优化版",
        "protocol": "simple",
    },
    "8005": {
        "name": "新模型 (llama-server + LoRA)",
        "short": "llama-server + LoRA",
        "protocol": "openai",
        "model_id": os.environ.get("TRANSLATE_MODEL_ID_8005", "Qwen3.6-27B"),
    },
}

DEFAULT_MODEL = os.environ.get("TRANSLATE_DEFAULT_MODEL", "8003")

TRANSLATE_TIMEOUT = int(os.environ.get("TRANSLATE_TIMEOUT", 300))

# 8005 走 chat 接口时的提示语，与源页面逐字一致（翻译质量对措辞敏感，勿随意改）
OPENAI_PROMPTS = {
    "mnc2zho": "将以下满文翻译为汉语：{}",
    "zho2mnc": "将以下汉文翻译为满文：{}",
}


def _upstream(model_key: str) -> str:
    """取某个模型的上游地址，优先读环境变量（便于指向远程机）。"""
    env = os.environ.get(f"TRANSLATE_UPSTREAM_{model_key}")
    if env:
        return env.rstrip("/")
    return f"http://127.0.0.1:{model_key}"


def _http_json(url, payload=None, timeout=5, method=None):
    """发一个 JSON 请求，返回 (ok, data_or_None, error_message)。"""
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method=method or ("POST" if payload is not None else "GET"),
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    try:
        return True, json.loads(raw), None
    except json.JSONDecodeError:
        return False, None, "上游返回不是合法 JSON"


def _translate_simple(base_url, text, direction, timeout):
    """8001 / 8003：POST /translate。"""
    ok, data, err = _http_json(f"{base_url}/translate",
                               {"text": text, "direction": direction}, timeout)
    if not ok:
        return None, err or "解析上游响应失败"
    if isinstance(data, dict) and data.get("error"):
        return None, str(data["error"])
    translation = data.get("translation") if isinstance(data, dict) else None
    if translation is None:
        return None, "上游响应缺少 translation 字段"
    return translation, None


def _translate_openai(base_url, text, direction, model_id, timeout):
    """8005：llama-server 的 OpenAI 兼容接口。

    保留源页面的两个细节：
    - reasoning_content 回退：某些推理模型把正文放进 reasoning_content
    - max_tokens 256：满汉翻译通常不需要更长输出
    """
    prompt = OPENAI_PROMPTS.get(direction, "{}").format(text)
    ok, data, err = _http_json(
        f"{base_url}/v1/chat/completions",
        {
            "model": model_id,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
            "max_tokens": 256,
        },
        timeout,
    )
    if not ok:
        return None, err or "解析上游响应失败"
    choices = data.get("choices") if isinstance(data, dict) else None
    if not choices:
        return None, "上游响应缺少 choices"
    msg = choices[0].get("message", {}) or {}
    translation = msg.get("content") or msg.get("reasoning_content") or ""
    if not translation:
        return None, "上游返回空译文"
    return translation, None


# ---------------------------------------------------------------
# 蓝图
# ---------------------------------------------------------------
translate_bp = Blueprint("translate", __name__, url_prefix="/translate")
translate_api_bp = Blueprint("translate_api", __name__, url_prefix="/api/translate")


@translate_bp.route("/")
def index():
    models = [
        {"key": k, "name": v["name"], "short": v["short"]}
        for k, v in MODEL_REGISTRY.items()
    ]
    return render_template("translate/index.html",
                           models=models,
                           default_model=DEFAULT_MODEL)


@translate_api_bp.route("/translate", methods=["POST"])
def translate():
    """统一翻译入口。

    入参：{"text": "...", "direction": "mnc2zho"|"zho2mnc", "model": "8003"}
    返回：{"translation": "...", "model": ..., "model_name": ...}
    错误：{"error": "...", "detail": ...} + 相应状态码
    """
    payload = request.get_json(silent=True) or {}
    text = (payload.get("text") or "").strip()
    direction = payload.get("direction") or "mnc2zho"
    model_key = str(payload.get("model") or DEFAULT_MODEL)

    if not text:
        return jsonify({"error": "请输入待翻译文本"}), 400
    if direction not in ("mnc2zho", "zho2mnc"):
        return jsonify({"error": f"不支持的翻译方向：{direction}"}), 400

    spec = MODEL_REGISTRY.get(model_key)
    if spec is None:
        return jsonify({
            "error": f"未知模型：{model_key}",
            "detail": f"可选：{', '.join(sorted(MODEL_REGISTRY))}",
        }), 400

    base_url = _upstream(model_key)
    try:
        if spec["protocol"] == "openai":
            translation, err = _translate_openai(
                base_url, text, direction, spec.get("model_id", "Qwen3.6-27B"),
                TRANSLATE_TIMEOUT)
        else:
            translation, err = _translate_simple(base_url, text, direction,
                                                 TRANSLATE_TIMEOUT)
    except urllib.error.HTTPError as e:
        return jsonify({"error": f"模型 {spec['name']} 返回 {e.code}",
                        "detail": e.read().decode("utf-8", "replace")}), 502
    except urllib.error.URLError as e:
        return jsonify({
            "error": f"无法连接模型 {spec['name']}（{base_url}）",
            "detail": str(e.reason),
            "hint": "本机未部署该翻译服务，可用 TRANSLATE_UPSTREAM_%s 指向运行中的机器"
                    % model_key,
        }), 502
    except Exception as e:  # pragma: no cover - 兜底
        return jsonify({"error": "翻译请求失败", "detail": str(e)}), 500

    if err:
        return jsonify({"error": err, "model": model_key}), 502

    return jsonify({
        "translation": translation,
        "model": model_key,
        "model_name": spec["name"],
    })


@translate_api_bp.route("/health")
def health():
    """探测三个模型服务的在线情况，供页面状态指示与运维巡检。

    永远返回 200（探测类接口），各模型状态放在 models[].alive。
    """
    models = []
    for key, spec in MODEL_REGISTRY.items():
        base_url = _upstream(key)
        probe_url = f"{base_url}/v1/models" if spec["protocol"] == "openai" \
            else f"{base_url}/health"
        alive = False
        try:
            req = urllib.request.Request(probe_url, method="GET")
            with urllib.request.urlopen(req, timeout=5):
                alive = True
        except urllib.error.HTTPError:
            # 401/403/404 都说明进程活着，只是接口路径不同
            alive = True
        except Exception:
            alive = False

        models.append({
            "key": key,
            "name": spec["name"],
            "short": spec["short"],
            "protocol": spec["protocol"],
            "upstream": base_url,
            "alive": alive,
        })

    return jsonify({
        "portal": "ok",
        "default_model": DEFAULT_MODEL,
        "models": models,
    })
