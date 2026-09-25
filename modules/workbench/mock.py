"""工作平台 · 演示数据（mock）

**这一版是纯演示**：不接数据库、不做真实上传下载。
· 用户、任务、标注框、句对、依存树全部预置
· 操作产生的数据（提交 / 审核）存在 Flask session 里：刷新保留，换浏览器即空
真实平台要换成 DB + 对象存储 + 权限体系 + 审计，见 docs/11 第 5 节。

演示底稿尽量用真素材（语料切片里的古籍图与句对），标注状态是假的——
这样界面看起来像真的，但不会产生任何真实数据。
"""

# ---------------------------------------------------------------- 演示账号
# 三个角色，覆盖 docs/11 §3.1 的权限矩阵；登录页直接选，无需密码
USERS = [
    {"id": "zhang", "name": "张同学", "role": "annotator", "role_name": "标注员"},
    {"id": "li", "name": "李老师", "role": "reviewer", "role_name": "审核员"},
    {"id": "wang", "name": "王老师", "role": "admin", "role_name": "管理员"},
]

# 角色层级：数字越大权限越高（用于演示 RBAC 拦截）
ROLE_LEVEL = {"annotator": 1, "reviewer": 2, "admin": 3}

# ---------------------------------------------------------------- OCR 标注任务
# 图片来自 static/corpus/ocr_real/（真实语料切片），框与置信度是 mock
OCR_TASKS = [
    {
        "id": "ja08027",
        "image": "corpus/ocr_real/ja08027.png",
        "status": "待标注",
        "boxes": [
            {"x": 10, "y": 8, "w": 78, "h": 10, "text": "ᡤᡝᠮᡠ ᠠᡴᡡ ᠣᡥᠣ᠈", "conf": 0.94},
            {"x": 10, "y": 22, "w": 74, "h": 10, "text": "ᠠᠮᠪᠠ ᠪᠠ ᡩᡝ", "conf": 0.88},
            {"x": 10, "y": 36, "w": 80, "h": 10, "text": "ᡳᠰᠠᠨᠠᡥᠠᠪᡳ", "conf": 0.71, "suspect": True},
            {"x": 10, "y": 50, "w": 70, "h": 10, "text": "ᠰᡝᡥᡝᠩᡤᡝ", "conf": 0.92},
        ],
    },
    {
        "id": "ja15322",
        "image": "corpus/ocr_real/ja15322.png",
        "status": "待标注",
        "boxes": [
            {"x": 10, "y": 12, "w": 76, "h": 11, "text": "ᠠᠨᡳᠶᠠ ᡳᠯᠠᠨ ᠪᡳᠶᠠᡳ", "conf": 0.90},
            {"x": 10, "y": 28, "w": 72, "h": 11, "text": "ᡳᠴᡝ ᠰᡠᠨᠵᠠ ᡩᡝ", "conf": 0.83, "suspect": True},
            {"x": 10, "y": 44, "w": 68, "h": 11, "text": "ᠸᡝᠰᡳᡥᡠᠨ", "conf": 0.95},
        ],
    },
    {
        "id": "ja11210",
        "image": "corpus/ocr_real/ja11210.png",
        "status": "已提交",
        "boxes": [
            {"x": 10, "y": 10, "w": 80, "h": 10, "text": "ᠮᡳᠨᡳ ᠨᡠᡴᡨᡝ ᠪᡝ", "conf": 0.93},
            {"x": 10, "y": 26, "w": 76, "h": 10, "text": "ᡤᠠᡳᡴᡳ ᠰᡝᠮᡝ", "conf": 0.89},
        ],
    },
    {
        "id": "ja02912",
        "image": "corpus/ocr_real/ja02912.png",
        "status": "待标注",
        "boxes": [
            {"x": 10, "y": 14, "w": 74, "h": 11, "text": "ᡳᠨᡠ ᡝᠮᡠ ᠮᡠᡩᠠᠨ", "conf": 0.87},
            {"x": 10, "y": 32, "w": 70, "h": 11, "text": "ᠪᠠᡳᡨᠠ ᠪᡳ", "conf": 0.79, "suspect": True},
        ],
    },
    {
        "id": "ja11100",
        "image": "corpus/ocr_real/ja11100.png",
        "status": "待标注",
        "boxes": [
            {"x": 10, "y": 10, "w": 82, "h": 10, "text": "ᡝᠨᡩᡠᡵᡳᠩᡤᡝ ᡥᠠᠨ", "conf": 0.96},
            {"x": 10, "y": 24, "w": 78, "h": 10, "text": "ᡝᠵᡝᠨ᠈ ᡶᡠᠴᡳᡥᡳ", "conf": 0.91},
            {"x": 10, "y": 38, "w": 72, "h": 10, "text": "ᡥᡝᠰᡝ ᠪᡝ", "conf": 0.68, "suspect": True},
            {"x": 10, "y": 52, "w": 66, "h": 10, "text": "ᡩᠠᡥᠠᠮᡝ", "conf": 0.90},
        ],
    },
    {
        "id": "ja27907",
        "image": "corpus/ocr_real/ja27907.png",
        "status": "待标注",
        "boxes": [
            {"x": 10, "y": 12, "w": 76, "h": 11, "text": "ᡝᡵᡝᠪᡝ ᡩᠣᡵᡤᡳ", "conf": 0.85},
            {"x": 10, "y": 30, "w": 72, "h": 11, "text": "ᠶᠠᠮᡠᠨ  ᡳ", "conf": 0.72, "suspect": True},
        ],
    },
]

# ---------------------------------------------------------------- 双行校对
# 前 12 条真实句对（语料切片），人为插入 3 处典型错误用于演示"校验 + 修复"
# error: None / "empty"（缺汉文行）/ "mismatch"（奇偶不对应）/ "blank"（多余空段落）
PROOFREAD_ROWS = [
    {"idx": 1, "latin": "an -i gisun de amtan be sara bithe", "zh": "庸言知旨序", "error": None},
    {"idx": 2, "latin": "erdeken -i milaraka de sain.", "zh": "早些撇开了好。", "error": None},
    {"idx": 3, "latin": "baibi taxaraburahv qalaburahv seme", "zh": "只恐怕差错了，", "error": None},
    {"idx": 4, "latin": "yasa faha tokome mohoburengge aina", "zh": "", "error": "empty"},
    {"idx": 5, "latin": "ai oqibe emu gosire gisun bureu.", "zh": "可怎么的呢求给个好话儿！", "error": None},
    {"idx": 6, "latin": "beleme habxara be nakabufi, mergen", "zh": "息诬告 以全善良。", "error": None},
    {"idx": 7, "latin": "duin biyai iqe ilan de, auhan -i d", "zh": "四月初三日，赐敖汉部杜棱额驸以济浓名号。", "error": None},
    {"idx": 8, "latin": "ilaqi jergi tafaka dolixan de aqan", "zh": "", "error": "blank"},
    {"idx": 9, "latin": "umesi sain amban", "zh": "这一句汉文与前句对不上", "error": "mismatch"},
    {"idx": 10, "latin": "terei gisun be donjifi", "zh": "听了他的话", "error": None},
    {"idx": 11, "latin": "abkai hesei forgon be", "zh": "奉天承运", "error": None},
    {"idx": 12, "latin": "gurun i doro be dasara", "zh": "治国之道", "error": None},
]

# ---------------------------------------------------------------- 依存句法标注
# 拉丁满文句子 + 预置分词/词性/依存关系（演示用，不求语言学精确）
UD_SENTENCES = [
    {
        "id": "s1",
        "text": "erdeken -i milaraka de sain.",
        "zh": "早些撇开了好。",
        "tokens": [
            {"id": 1, "form": "erdeken", "upos": "ADV", "head": 5, "deprel": "advmod"},
            {"id": 2, "form": "-i", "upos": "PART", "head": 1, "deprel": "case"},
            {"id": 3, "form": "milaraka", "upos": "VERB", "head": 5, "deprel": "advcl"},
            {"id": 4, "form": "de", "upos": "ADP", "head": 3, "deprel": "case"},
            {"id": 5, "form": "sain", "upos": "ADJ", "head": 0, "deprel": "root"},
            {"id": 6, "form": ".", "upos": "PUNCT", "head": 5, "deprel": "punct"},
        ],
    },
    {
        "id": "s2",
        "text": "terei gisun be donjifi",
        "zh": "听了他的话",
        "tokens": [
            {"id": 1, "form": "terei", "upos": "PRON", "head": 2, "deprel": "nmod"},
            {"id": 2, "form": "gisun", "upos": "NOUN", "head": 4, "deprel": "obj"},
            {"id": 3, "form": "be", "upos": "ADP", "head": 2, "deprel": "case"},
            {"id": 4, "form": "donjifi", "upos": "VERB", "head": 0, "deprel": "root"},
        ],
    },
    {
        "id": "s3",
        "text": "abkai hesei forgon be",
        "zh": "奉天承运",
        "tokens": [
            {"id": 1, "form": "abkai", "upos": "NOUN", "head": 3, "deprel": "nmod"},
            {"id": 2, "form": "hesei", "upos": "NOUN", "head": 3, "deprel": "nmod"},
            {"id": 3, "form": "forgon", "upos": "NOUN", "head": 0, "deprel": "root"},
            {"id": 4, "form": "be", "upos": "ADP", "head": 3, "deprel": "case"},
        ],
    },
]

# ---------------------------------------------------------------- 预置提交记录
# 登录后写入 session，作为"历史数据"的底稿，让首页一进来就有内容可看
BASE_SUBMISSIONS = [
    {"id": "S-240924-003", "type": "OCR 标注", "title": "ja11210.png · 2 框",
     "user": "张同学", "time": "2026-09-24 16:20", "status": "已通过", "comment": ""},
    {"id": "S-240924-002", "type": "双行校对", "title": "all_v8_part03 · 12 句对",
     "user": "张同学", "time": "2026-09-24 11:37", "status": "已通过", "comment": ""},
    {"id": "S-240923-001", "type": "依存标注", "title": "ud_batch03.conllu · 8 句",
     "user": "李老师", "time": "2026-09-23 09:05", "status": "已驳回",
     "comment": "第 3 句分词与前两批不一致，请统一"},
]
