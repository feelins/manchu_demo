"""满语文数智化平台 · 门户入口

当前阶段：统一外壳（base.html + 设计令牌）已抽出，首页改为模板继承。
各功能模块（OCR / 转换 / 翻译 / TTS / ASR / 语料 / 工作平台）
先以占位路由注册，阶段 2 起逐个替换为真实蓝图（Blueprint）。
"""

import os

from flask import Flask, jsonify, render_template, request

from config import (CAPABILITY_CARDS, CORPUS_STATS, FOOTER_LINKS, NAV_ITEMS,
                    SITE, TRACE_PIPELINES)
from modules.corpus import corpus_api_bp, corpus_bp
from modules.ocr import ocr_api_bp, ocr_bp
from modules.translate import translate_api_bp, translate_bp
from modules.translit import translit_bp
from modules.tts import tts_api_bp, tts_bp

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 已接入真实蓝图的模块（其余仍为占位路由）
REAL_MODULES = {"ocr", "translit", "translate", "tts", "corpus"}

# 各模块后端网关前缀（前端只用相对路径，由门户转发到真实服务）
OCR_API_BASE = os.environ.get("OCR_API_BASE", "/api/ocr")


def _make_placeholder_view(item):
    """为尚未实现的模块生成占位视图（阶段 2 后由真实蓝图替换）"""

    def view():
        return render_template("placeholder.html", module=item)

    view.__name__ = f"{item['key']}_index"
    return view


def create_app():
    app = Flask(
        __name__,
        template_folder=os.path.join(BASE_DIR, "templates"),
        static_folder=os.path.join(BASE_DIR, "static"),
    )

    # ---- 全站模板变量：站点信息、导航、页脚、首页数据 ----
    @app.context_processor
    def inject_globals():
        endpoint = request.endpoint or ""
        # 端点前缀即栏目 key（如 "ocr.index" -> "ocr"），用于导航自动高亮
        active_nav = endpoint.split(".")[0] if "." in endpoint else ""
        return {
            "site": SITE,
            "nav_items": NAV_ITEMS,
            "footer_links": FOOTER_LINKS,
            "active_nav": active_nav,
            "capability_cards": CAPABILITY_CARDS,
            "trace_pipelines": TRACE_PIPELINES,
            "corpus_stats": CORPUS_STATS,
            "ocr_api": OCR_API_BASE,
        }

    # ---- 首页 ----
    @app.route("/", endpoint="portal.index")
    def index():
        return render_template("index.html")

    # ---- 已接入的模块蓝图 ----
    app.register_blueprint(ocr_bp)        # 页面：/ocr/
    app.register_blueprint(ocr_api_bp)    # 接口：/api/ocr/（转发到 OCR 推理服务）
    app.register_blueprint(translit_bp)   # 页面：/translit/（纯前端，无需后端服务）
    app.register_blueprint(translate_bp)      # 页面：/translate/
    app.register_blueprint(translate_api_bp)  # 接口：/api/translate/（转发到三个翻译模型服务）
    app.register_blueprint(tts_bp)       # 页面：/tts/
    app.register_blueprint(tts_api_bp)   # 接口：/api/tts/（转发到 TTS 推理服务 + 音频回源）
    app.register_blueprint(corpus_bp)       # 页面：/corpus/（语料集，只读切片，无外部依赖）
    app.register_blueprint(corpus_api_bp)   # 接口：/api/corpus/（切片与规模统计）

    # ---- 其余模块占位路由（保证导航与页脚链接可用） ----
    for item in NAV_ITEMS:
        if item["key"] == "portal" or item["key"] in REAL_MODULES:
            continue
        app.add_url_rule(
            f"/{item['key']}/",
            endpoint=f"{item['key']}.index",
            view_func=_make_placeholder_view(item),
        )

    # ---- 健康检查 ----
    @app.route("/health")
    def health():
        return jsonify({"status": "ok", "service": "manchu-portal"})

    return app


app = create_app()


if __name__ == "__main__":
    # 局域网访问：host=0.0.0.0；仅本机可改为 127.0.0.1
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=True)
