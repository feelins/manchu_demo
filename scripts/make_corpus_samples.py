#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""语料集展示切片生成器

用途：从本机原始语料中抽出**极少量**样例，落到 static/corpus/ 供 /corpus/ 页面展示。
设计要点（详见 docs/10-语料集模块分析与规划.md）：

1. 只抽切片，绝不搬运全量：原始数据 GB 级（古籍图 102 MB / 合成目录 2.7 GB / 语音 1 GB），
   本页面只为了"让人看见数据长什么样"，不是数据集分发。
2. 输出目录是 static/corpus/ 而不是 docs/ —— 页面通过 url_for('static', ...) 引用，
   docs/ 是归档目录，不该放运行时资源。
3. 抽样用**等距抽样**而非随机：结果确定、可复现，重跑不漂移。
4. 清洗：平行语料去 CRLF，合成图标签去 BOM（manju_170k/*.txt 带 \\ufeff）。
5. 同时产出 index.json（含元数据与口径），页面与首页数据卡都从它读。

用法：
    python3 scripts/make_corpus_samples.py            # 生成全部四类
    python3 scripts/make_corpus_samples.py speech     # 只生成某一类
"""

import json
import os
import shutil
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "static", "corpus")

PARALLEL_SRC = "/home/leyesi/shaopf/服务器配置相关/平台框架/平台框架/06语料集/0602满汉双向翻译训练数据行数/不可展示全部 仅展示几十条即可  all1+2+3.txt"
OCR_REAL_DIR = "/home/leyesi/ancient_ocr_finetune/ancient_4k_v7"
OCR_SYNTH_DIR = "/home/leyesi/ocr/manju_170k"
SPEECH_DIR = "/home/leyesi/shaopf/Manchu_data_v8/manchu_align_v8"

N_PARALLEL = 30     # 句对
N_IMAGE = 6         # 每类图片张数
N_SPEECH = 6        # 音频条数
STATS_DATE = "2026-09-25"


def even_sample(items, n):
    """等距抽样：结果确定，重跑可复现。"""
    if len(items) <= n:
        return items
    step = len(items) / float(n)
    return [items[int(i * step)] for i in range(n)]


def write_index(category, meta, entries, total_size):
    meta.update({
        "category": category,
        "sample_count": len(entries),
        "sample_bytes": total_size,
        "stats_date": STATS_DATE,
        "note": "展示切片，非全量数据；全量需走申请流程。",
        "entries": entries,
    })
    os.makedirs(os.path.join(OUT, category), exist_ok=True)
    path = os.path.join(OUT, category, "index.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    return path


def clean(s):
    """去 BOM + CRLF + 首尾空白。"""
    return s.replace("\ufeff", "").replace("\r", "").strip()


# ---------------------------------------------------------------
# ① 满汉平行语料：双行对照（奇数行拉丁满文 / 偶数行汉文）
# ---------------------------------------------------------------
def build_parallel():
    with open(PARALLEL_SRC, encoding="utf-8") as f:
        lines = [clean(l) for l in f]
    pairs = []
    for i in range(0, len(lines) - 1, 2):
        if lines[i] and lines[i + 1]:
            pairs.append((lines[i], lines[i + 1]))

    picked = even_sample(pairs, N_PARALLEL)
    entries = [{"id": i + 1, "manju_latin": m, "zh": z}
               for i, (m, z) in enumerate(picked)]

    meta = {
        "name": "满汉平行语料",
        "source_type": "文本",
        "version": "all1+2+3",
        "total_lines": len(lines),
        "total_pairs": len(pairs),
        "form": "双行对照：奇数行拉丁满文 / 偶数行汉文",
        "annotation": "拉丁转写（非传统满文原文）",
        "license": "仅展示切片",
        "source_path": PARALLEL_SRC,
    }
    return write_index("parallel", meta, entries, 0)


# ---------------------------------------------------------------
# ② OCR 图文：真实古籍 / 合成
# ---------------------------------------------------------------
def build_images(category, src_dir, list_file, meta, size_filter=None):
    """list_file: 形如 'images_clean/xxx.png\\t标签' 的索引；合成类可传 None（按文件名配 .txt）。"""
    if list_file:
        with open(list_file, encoding="utf-8") as f:
            rows = [l for l in f if l.strip()]
        picked = even_sample(rows, N_IMAGE)
        items = []
        for r in picked:
            rel = r.split("\t")[0].strip()
            label = clean(r.split("\t")[1]) if "\t" in r else ""
            items.append((os.path.basename(rel), label))
    else:
        names = sorted(n for n in os.listdir(src_dir) if n.endswith(".png"))
        picked = even_sample(names, N_IMAGE)
        items = []
        for n in picked:
            txt = os.path.join(src_dir, n[:-4] + ".txt")
            label = ""
            if os.path.isfile(txt):
                with open(txt, encoding="utf-8") as f:
                    label = clean(f.read())
            items.append((n, label))

    dst = os.path.join(OUT, category)
    os.makedirs(dst, exist_ok=True)
    entries, total = [], 0
    for i, (name, label) in enumerate(items):
        src = os.path.join(src_dir, name)
        if not os.path.isfile(src):
            continue
        shutil.copyfile(src, os.path.join(dst, name))
        size = os.path.getsize(src)
        total += size
        entries.append({
            "id": i + 1,
            "image": "corpus/%s/%s" % (category, name),
            "label": label,
            "bytes": size,
        })

    meta["source_path"] = src_dir
    return write_index(category, meta, entries, total)


def build_ocr_real():
    meta = {
        "name": "满文 OCR 训练数据（真实古籍）",
        "source_type": "图像 + 满文标注",
        "version": "ancient_4k_v7",
        "total_images": 17198,
        "total_train_lines": 7739,
        "form": "古籍扫描切分后的行图，附传统满文标注",
        "annotation": "传统满文（人工校对）",
        "license": "仅展示切片",
    }
    return build_images("ocr_real",
                        os.path.join(OCR_REAL_DIR, "images_clean"),
                        os.path.join(OCR_REAL_DIR, "train.txt"),
                        meta)


def build_ocr_synth():
    meta = {
        "name": "满文 OCR 训练数据（合成）",
        "source_type": "图像 + 满文标注",
        "version": "manju_170k",
        "total_images": 173170,
        "form": "满文标准字体渲染的合成行图（多字体）",
        "annotation": "传统满文（合成时同步生成，标签文件带 BOM，已清洗）",
        "license": "仅展示切片",
    }
    return build_images("ocr_synth", OCR_SYNTH_DIR, None, meta)


# ---------------------------------------------------------------
# ③ 语音：wav + 拉丁文本（TTS / ASR 同一批，两种用途）
# ---------------------------------------------------------------
def build_speech():
    wavs = sorted(n for n in os.listdir(SPEECH_DIR) if n.endswith(".wav"))
    # 优先挑 1~3 秒的短音频（约 48KB~150KB），展示加载快、体积小
    sized = [(os.path.getsize(os.path.join(SPEECH_DIR, n)), n) for n in wavs]
    short = [n for s, n in sized if 48000 < s < 150000] or [n for _, n in sized[:N_SPEECH]]
    picked = even_sample(short, N_SPEECH)

    dst = os.path.join(OUT, "speech")
    os.makedirs(dst, exist_ok=True)
    entries, total = [], 0
    for i, name in enumerate(picked):
        src = os.path.join(SPEECH_DIR, name)
        shutil.copyfile(src, os.path.join(dst, name))
        size = os.path.getsize(src)
        total += size

        txt = os.path.join(SPEECH_DIR, name[:-4] + ".txt")
        text = ""
        if os.path.isfile(txt):
            with open(txt, encoding="utf-8") as f:
                text = clean(f.read())

        entries.append({
            "id": i + 1,
            "audio": "corpus/speech/%s" % name,
            "text": text,
            "duration_sec": round((size - 44) / 48000.0, 2),   # 24kHz / 16bit / 单声道
            "sample_rate": 24000,
            "bytes": size,
            "usage": "TTS（文本→音频）与 ASR（音频→文本）共用同一批数据，不重复计数",
        })

    meta = {
        "name": "满语语音语料",
        "source_type": "音频 + 拉丁转写 + 音素对齐",
        "version": "Manchu_data_v8 / manchu_align_v8",
        "total_items": 2424,
        "form": "wav（24kHz/16bit/单声道）+ 同名词文本 + TextGrid 对齐",
        "annotation": "拉丁满文转写 + MFA 音素对齐",
        "license": "仅展示切片（录音说话人授权待确认）",
    }
    return write_index("speech", meta, entries, total)


BUILDERS = {
    "parallel": build_parallel,
    "ocr_real": build_ocr_real,
    "ocr_synth": build_ocr_synth,
    "speech": build_speech,
}


def main():
    os.makedirs(OUT, exist_ok=True)
    cats = sys.argv[1:] or list(BUILDERS)
    for c in cats:
        if c not in BUILDERS:
            print("未知类别:", c, "可选:", "/".join(BUILDERS))
            continue
        path = BUILDERS[c]()
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        print("%-10s %2d 条  %8.1f KB  -> %s" % (
            c, data["sample_count"], data["sample_bytes"] / 1024.0,
            os.path.relpath(path, BASE)))

    total = sum(
        os.path.getsize(os.path.join(d, f))
        for d, _, fs in os.walk(OUT) for f in fs)
    print("-" * 60)
    print("切片总大小: %.1f KB（原始全量数据不入库）" % (total / 1024.0))


if __name__ == "__main__":
    main()
