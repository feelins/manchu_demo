# -*- coding: utf-8 -*-
"""生成 docs/samples/translit 样例（可重跑，保证样例与规则表同步）。

用法：
    .venv/bin/python scripts/gen_translit_samples.py

依赖：OCR 服务需已启动（./scripts/services.sh start），脚本经门户代理取真实古籍文本。

规则表严格照抄 static/js/translit.js（含替换顺序），因此本地生成的拉丁转写
与浏览器端「满文 → 拉丁」结果一致，可互为回归基准。
"""
import json
import os
import urllib.request
import uuid

DEST = "/home/leyesi/shaopf/manchu_demo/docs/samples/translit"


def u(code):
    return chr(code)


MANJU_TO_LATIN_RULES = [
    (u(0x1829), "ng"), (u(0x183A), "k'"), (u(0x186C), "g'"),
    (u(0x202F) + u(0x1873), "-i"), (u(0x186D), "h'"),
    (u(0x186E) + u(0x185F), "ci"), (u(0x186E), "c"),
    (u(0x186F), "z"), (u(0x1870), "r'"),
    (u(0x1830) + u(0x185F), "si'"), (u(0x1871) + u(0x1873), "q'i"),
    (u(0x1877) + u(0x1873), "j'i"), (u(0x1820), "a"),
    (u(0x182A), "b"), (u(0x1834), "q"), (u(0x1869), "d"),
    (u(0x185D), "e"), (u(0x1876), "f"), (u(0x1864), "g"),
    (u(0x1865), "h"), (u(0x1873), "i"), (u(0x1835), "j"),
    (u(0x1874), "k"), (u(0x182F), "l"), (u(0x182E), "m"),
    (u(0x1828), "n"), (u(0x1823), "o"), (u(0x1866), "p"),
    (u(0x1875), "r"), (u(0x1830), "s"), (u(0x1868), "t"),
    (u(0x1860), "u"), (u(0x1861), "v"), (u(0x1838), "w"),
    (u(0x1867), "x"), (u(0x1836), "y"),
    ("ao", "au"), ("eo", "eu"), ("io", "iu"),
    ("oo", "ou"), ("uo", "uu"), ("vo", "vu"),
    (u(0x1808), ","), (u(0x1809), "."),
]

LATIN_TO_MANJU_RULES = [
    ("ng", u(0x1829)), ("-i", u(0x202F) + u(0x1873)),
    ("k'", u(0x183A)), ("g'", u(0x186C)), ("h'", u(0x186D)),
    ("ci", u(0x186E) + u(0x185F)), ("c'i", u(0x186E) + u(0x185F)),
    ("c'", u(0x186E)), ("z", u(0x186F)), ("r'", u(0x1870)),
    ("n'", u(0x1828) + u(0x180B)), (u(0x17E), u(0x1870)),
    ("sy", u(0x1830) + u(0x185F)), ("si'", u(0x1830) + u(0x185F)),
    ("q'i", u(0x1871) + u(0x1873)), ("q'y", u(0x1871) + u(0x1873)),
    ("qy", u(0x1871) + u(0x1873)), ("j'i", u(0x1877) + u(0x1873)),
    ("jy'", u(0x1877) + u(0x1873)), ("jy", u(0x1877) + u(0x1873)),
    ("au", "ao"), ("eu", "eo"), ("iu", "io"),
    ("ou", "oo"), ("uu", "uo"), ("vu", "vo"),
    (" i ", " " + u(0x200D) + u(0x1873) + " "),
    ("a", u(0x1820)), ("b", u(0x182A)), ("q", u(0x1834)),
    ("d", u(0x1869)), ("e", u(0x185D)), ("f", u(0x1876)),
    ("g", u(0x1864)), ("h", u(0x1865)), ("i", u(0x1873)),
    ("j", u(0x1835)), ("k", u(0x1874)), ("l", u(0x182F)),
    ("m", u(0x182E)), ("n", u(0x1828)), ("o", u(0x1823)),
    ("p", u(0x1866)), ("r", u(0x1875)), ("s", u(0x1830)),
    ("t", u(0x1868)), ("u", u(0x1860)), ("v", u(0x1861)),
    (u(0x16B), u(0x1861)), ("w", u(0x1838)), ("x", u(0x1867)),
    (u(0x161), u(0x1867)), ("y", u(0x1836)),
    (",", u(0x1808)), (".", u(0x1809)),
]


def apply_rules(text, rules):
    """等价于 JS applyRules：按规则顺序做全局纯字符串替换。"""
    result = text
    for src, dst in rules:
        result = result.replace(src, dst)
    return result


def ocr_text(path, model="ancient"):
    """经门户代理调 OCR，返回该图所有满文列文本（真实古籍文本）。"""
    b = uuid.uuid4().hex
    data = open(path, "rb").read()
    body = b""
    for k, v in [("model_type", model), ("recognize_chinese", "0")]:
        body += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    body += (f'--{b}\r\nContent-Disposition: form-data; name="image"; '
             f'filename="x.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode()) + data + f'\r\n--{b}--\r\n'.encode()
    req = urllib.request.Request(
        "http://127.0.0.1:8000/api/ocr/recognize", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    r = json.load(urllib.request.urlopen(req, timeout=300))
    return [c["text"] for c in r.get("columns", []) if c["type"] == "manchu"]


def write(rel, content):
    p = os.path.join(DEST, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)
    return p


def main():
    # ---- 1. 从 OCR 实测输出取真实古籍满文 ----
    src = {
        "ja003": "/home/leyesi/shaopf/manchu_demo/docs/samples/ocr/ja003.jpg",
        "nz003d": "/home/leyesi/shaopf/manchu_demo/docs/samples/ocr/nz003d.jpg",
    }
    ocred = {}
    for name, path in src.items():
        cols = ocr_text(path)
        ocred[name] = cols
        print(f"{name}: {len(cols)} 列")

    # ---- 2. 规则覆盖度样例（手工构造，覆盖特殊拼写与标点）----
    phrases = [
        ocred["ja003"][0] if ocred["ja003"] else "",
        ocred["ja003"][1] if len(ocred["ja003"]) > 1 else "",
    ]

    print("\n=== round-trip 验证（manju → latin → manju）===")
    ok = True
    for i, m in enumerate(phrases):
        lat = apply_rules(m, MANJU_TO_LATIN_RULES)
        back = apply_rules(lat, LATIN_TO_MANJU_RULES)
        same = back == m
        ok = ok and same
        print(f"样例{i+1}: 可逆={same}")
        if not same:
            print("   原 :", m[:70])
            print("   回 :", back[:70])
        lat2 = apply_rules(m, MANJU_TO_LATIN_RULES)
        if i == 0:
            first_latin = lat2
    print("整体可逆:", ok)

    # ---- 3. 输出样例文件 ----
    # 3.1 单句样例（用于快速手测）
    write("manju/01-single.txt", phrases[0] + "\n")
    write("latin/01-single.txt", apply_rules(phrases[0], MANJU_TO_LATIN_RULES) + "\n")

    # 3.2 整页多列样例（每段一列，用于演示批量 / Word 段落保留）
    page = "\n".join(ocred["ja003"])
    write("manju/02-page.txt", page + "\n")
    write("latin/02-page.txt", apply_rules(page, MANJU_TO_LATIN_RULES) + "\n")

    # 3.3 多来源混合（演示批量文件夹：一次转多个来源）
    mixed = "\n".join(ocred["nz003d"] + ocred["ja003"][:2])
    write("manju/03-mixed.txt", mixed + "\n")
    write("latin/03-mixed.txt", apply_rules(mixed, MANJU_TO_LATIN_RULES) + "\n")

    # 3.4 规则速查表：**从规则表自动推导**（避免手写字符出错）
    #     分两类：字符映射（满文 ↔ 拉丁）与后置拼写修正（拉丁 → 拉丁）
    manju_map = [(f, t) for f, t in MANJU_TO_LATIN_RULES
                 if any(0x1800 <= ord(ch) <= 0x18AF or ord(ch) == 0x202F for ch in f)]
    post_map = [(f, t) for f, t in MANJU_TO_LATIN_RULES if (f, t) not in manju_map]

    write("manju/04-cheatsheet.txt", "\n".join(m for m, _ in manju_map) + "\n")
    write("latin/04-cheatsheet.txt", "\n".join(l for _, l in manju_map) + "\n")
    tsv = ["# 满文\t拉丁\t类别"]
    tsv += [f"{m}\t{l}\t字符映射" for m, l in manju_map]
    tsv += [f"（{f}）\t{t}\t拼写修正" for f, t in post_map]
    write("expected/04-cheatsheet.tsv", "\n".join(tsv) + "\n")

    # ---- 4. 反向基准：以 latin/*.txt 为输入时的正确满文输出 ----
    #     规则并非严格互逆（见 README「已知的有损点」），因此反向要有自己的预期基准
    for name in ["01-single", "02-page", "03-mixed", "04-cheatsheet"]:
        lp = os.path.join(DEST, "latin", name + ".txt")
        if os.path.exists(lp):
            lt = open(lp, encoding="utf-8").read()
            write(f"reverse/{name}.manju.txt", apply_rules(lt, LATIN_TO_MANJU_RULES))

    # ---- 5. 回归校验 ----
    print("\n=== 回归校验 ===")
    for name in ["01-single", "02-page", "03-mixed", "04-cheatsheet"]:
        mp = os.path.join(DEST, "manju", name + ".txt")
        lp = os.path.join(DEST, "latin", name + ".txt")
        rp = os.path.join(DEST, "reverse", name + ".manju.txt")
        m_text = open(mp, encoding="utf-8").read()
        l_text = open(lp, encoding="utf-8").read()
        r_text = open(rp, encoding="utf-8").read()
        fwd_ok = apply_rules(m_text, MANJU_TO_LATIN_RULES) == l_text   # 正向预期
        rev_ok = apply_rules(l_text, LATIN_TO_MANJU_RULES) == r_text   # 反向预期
        strict = apply_rules(l_text, LATIN_TO_MANJU_RULES) == m_text   # 严格互逆？
        print(f"{name:16s} 正向(满→拉)预期一致: {fwd_ok}   反向(拉→满)预期一致: {rev_ok}   严格互逆: {strict}")

    print("\n=== 已生成 ===")
    for root, _, files in sorted(os.walk(DEST)):
        for fn in sorted(files):
            p = os.path.join(root, fn)
            kb = os.path.getsize(p)
            print(f"{os.path.relpath(p, DEST):36s} {kb:5d} B")
    return first_latin


if __name__ == "__main__":
    main()
