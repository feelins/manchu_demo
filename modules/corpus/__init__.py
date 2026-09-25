"""语料集（蓝图）

职责：
1. `/corpus/`           语料总览：五类数据的规模、统计口径与样例入口
2. `/corpus/parallel`   满汉平行语料样例（30 句对，双行对照 + 满文反写）
3. `/corpus/ocr`        OCR 图文样例（真实古籍 / 合成，各 6 张，图 + 满文标注）
4. `/corpus/speech`     语音语料样例（6 条，TTS 与 ASR 两种用途共用同一批）
5. `/api/corpus/stats`  汇总 JSON（供首页数据卡与其它页面复用）

数据来源：`static/corpus/<类别>/index.json`，由 `scripts/make_corpus_samples.py` 生成。
**页面只展示切片，不提供全量数据**——原始全量（古籍图 102 MB / 合成目录 2.7 GB / 语音 1 GB）
均留在原路径，不入库、不分发，全量需求走申请流程。

关于数字口径（见 docs/10 第 3 节）：
需求文档上的数字与本机实测多处不符，因此每个规模数字都带 `verified` 标记，
未核实的在页面上继续显示占位符，**不虚报**。
"""

import json
import os

from flask import Blueprint, jsonify, render_template

# modules/corpus/__init__.py -> manchu_demo/
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CORPUS_DIR = os.path.join(ROOT, "static", "corpus")

# 切片类别（与 make_corpus_samples.py 的输出目录一一对应）
SLICE_CATEGORIES = ("parallel", "ocr_real", "ocr_synth", "speech")

# 五类语料：对应 平台框架/06语料集/ 的 0601~0605
# verified=False 的项在总览页显示占位符，并在 note 里说明缺口在哪
CORPUS_OVERVIEW = [
    {
        "code": "0601",
        "key": "ocr",
        "title": "满文 OCR 训练数据",
        "manju": "ᠪᡳᡨᡥᡝ",
        "endpoint": "corpus.ocr",
        "scale": None,
        "verified": False,
        "note": "合成 173,170 张 + 真实古籍 17,198 张（本机实测）；"
                "与需求文档的 1,430,707 / 8,599 口径不符，待数据负责人确认后再对外报数",
        "slices": ["ocr_real", "ocr_synth"],
    },
    {
        "code": "0602",
        "key": "parallel",
        "title": "满汉平行语料",
        "manju": "ᠪᡳᡨᡥᡝ ᠰᡠᠪᡳ",
        "endpoint": "corpus.parallel",
        "scale": "49,019 句对",
        "verified": True,
        "note": "98,038 行双行对照（奇数行拉丁满文 / 偶数行汉文），已核实，与需求文档数字一致",
        "slices": ["parallel"],
    },
    {
        "code": "0603",
        "key": "speech",
        "title": "语音合成数据",
        "manju": "ᡩᠣᠨᠵᡳᡵᡝ",
        "endpoint": "corpus.speech",
        "scale": "2,424 条",
        "verified": True,
        "note": "Manchu_data_v8 实测（wav + 拉丁转写 + TextGrid 音素对齐）；"
                "目录批注为「需要邵老师提供」，此处数字为实测，对外报数建议以官方口径为准",
        "slices": ["speech"],
    },
    {
        "code": "0604",
        "key": "asr",
        "title": "语音识别数据",
        "manju": "ᡩᠣᠨᠵᡳᡵᡝ",
        "endpoint": "corpus.speech",
        "scale": None,
        "verified": False,
        "note": "按目录批注「反向使用语音合成数据」——与 0603 是同一批 wav，两种用途、不重复计数；"
                "需求文档的 2,292 条疑为早期版本数字",
        "slices": ["speech"],
    },
    {
        "code": "0605",
        "key": "books",
        "title": "已有古籍总量",
        "manju": "ᠨᠣᠮᡠᠨ",
        "endpoint": None,
        "scale": None,
        "verified": False,
        "note": "本机无任何古籍清单，目录为空；需求文档的 529 种/套无法核对",
        "slices": [],
    },
]


def load_slice(category):
    """读取某类切片的 index.json；文件不存在时返回 None（脚本未运行或数据未提供）。"""
    path = os.path.join(CORPUS_DIR, category, "index.json")
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _slice_brief(category):
    """总览卡片用的切片摘要：条数 + 体积 + 生成日期。"""
    data = load_slice(category)
    if not data:
        return None
    return {
        "category": category,
        "name": data.get("name", category),
        "count": data.get("sample_count", 0),
        "bytes": data.get("sample_bytes", 0),
        "stats_date": data.get("stats_date", ""),
        "version": data.get("version", ""),
    }


def _total_bytes():
    total = 0
    for dirpath, _, filenames in os.walk(CORPUS_DIR):
        for name in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, name))
            except OSError:
                pass
    return total


corpus_bp = Blueprint("corpus", __name__, url_prefix="/corpus")
corpus_api_bp = Blueprint("corpus_api", __name__, url_prefix="/api/corpus")


@corpus_bp.route("/")
def index():
    slices = {c: _slice_brief(c) for c in SLICE_CATEGORIES}
    return render_template(
        "corpus/index.html",
        overview=CORPUS_OVERVIEW,
        slices=slices,
        total_bytes=_total_bytes(),
        has_any=any(v for v in slices.values()),
    )


@corpus_bp.route("/parallel")
def parallel():
    return render_template("corpus/parallel.html", data=load_slice("parallel"))


@corpus_bp.route("/ocr")
def ocr():
    return render_template(
        "corpus/ocr.html",
        real=load_slice("ocr_real"),
        synth=load_slice("ocr_synth"),
    )


@corpus_bp.route("/speech")
def speech():
    return render_template("corpus/speech.html", data=load_slice("speech"))


@corpus_api_bp.route("/stats")
def stats():
    """汇总：五类语料的规模、核实状态 + 切片统计（供首页数据卡复用）"""
    return jsonify({
        "overview": CORPUS_OVERVIEW,
        "slices": {c: _slice_brief(c) for c in SLICE_CATEGORIES},
        "slice_total_bytes": _total_bytes(),
        "note": "scale 为 None 表示口径未核实；页面应显示占位符而非估算值。",
    })
