"""工作平台（需登录）· 蓝图

2026-09-30 升级：数据从「进程内存 mock」改为 **SQLite 落盘**（见 db.py 顶部说明）。

改之前的问题不是"数据看起来假"，而是**三个角色之间根本没有真实的协作**：
  · 标注员提交只写进本进程列表，换账号/重启/落到另一个 gunicorn worker 就看不见；
  · 任务状态不随提交变化，交完那张图还是"待标注"；
  · 打回之后没有去处，标注员看不到"我被谁打回了、为什么"。

现在是一条真的流水线，三个角色各有各的活，且互相看得见：

    标注员 张同学   领取 → 标注 → 提交 ────────────┐
                        ▲                          ▼
                        └── 返工重提 ←── 打回 ── 审核员 李老师（通过 / 打回，留意见）
                                                    ▲
                          管理员 王老师：指派任务 / 团队看板 / 操作日志

权限仍走 RBAC（annotator < reviewer < admin），且**数据层也做归属校验**：
不是指派给你的任务，前端藏了按钮、后端也会拒（见 db.submit_task）。
"""

import json
import os
import urllib.error
import urllib.request
from functools import wraps

from flask import (Blueprint, current_app, jsonify, redirect, render_template,
                   request, session, url_for)

from . import db
from .mock import ROLE_LEVEL, USERS

# AI 画框检测服务地址（Ubuntu 常驻，见 docs/17 与 AI画框模型部署交接说明.md）。
# 端口 7860 与门户 8000 分离，避免冲突；前端只跟本路由交互，不在浏览器直连模型服务。
DETECT_URL = "http://127.0.0.1:7860/detect"

# 演示模式开关：页面上据此显示"演示"提示与身份切换入口
DEMO_MODE = True

workbench_bp = Blueprint("workbench", __name__, url_prefix="/workbench")

# 首次导入即建表并写入演示种子（幂等：已有数据则跳过）
db.init_db()


# --------------------------------------------------------------- 会话与权限
def current_user():
    """返回当前登录用户；会话结构失效（如升级前的旧 cookie 缺字段）一律当未登录，
    避免 KeyError 导致整页 500——旧 cookie 用户会被引导回登录页重新登录覆盖之。"""
    u = session.get("wb_user")
    if not isinstance(u, dict) or "username" not in u or "role" not in u:
        return None
    return u


def _login_required(view):
    """未登录一律回登录页（RBAC 的第一道门）"""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not current_user():
            return redirect(url_for("workbench.login", next=request.path))
        return view(*args, **kwargs)
    return wrapper


def _role_required(role):
    """角色不足时给 403 提示页——用于演示「标注员进不了审核台」。"""
    def deco(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            user = current_user()
            if not user:
                return redirect(url_for("workbench.login", next=request.path))
            if ROLE_LEVEL.get(user["role"], 0) < ROLE_LEVEL[role]:
                return render_template(
                    "workbench/denied.html",
                    user=user, need=role,
                    need_name={"reviewer": "审核员", "admin": "管理员"}.get(role, role),
                ), 403
            return view(*args, **kwargs)
        return wrapper
    return deco


# --------------------------------------------------------------- 可见性规则
def _visible_tasks(user):
    """该用户能看到的任务：
       管理员/审核员 -> 全部；标注员 -> 我负责的 + 还没人领的（可领取）"""
    if user["role"] in ("admin", "reviewer"):
        return db.list_tasks()
    me = user["username"]
    return [t for t in db.list_tasks() if t["assignee"] == me or not t["assignee"]]


def _editable(task, user):
    """这个任务此刻能不能编辑（前端按钮显隐用；后端 db 里还有一道硬校验）"""
    if not task:
        return False
    if task["status"] in (db.T_PASS, db.T_REVIEW):
        return False
    return (not task["assignee"]) or task["assignee"] == user["username"] \
        or user["role"] == "admin"


def _decorate(task, user):
    """给任务补上展示字段：负责人中文名、可编辑性、状态样式类"""
    names = {u["username"]: u["name"] for u in USERS}
    task["assignee_name"] = names.get(task["assignee"], "未指派") if task["assignee"] else "未指派"
    task["editable"] = _editable(task, user)
    task["claimable"] = (not task["assignee"] and task["status"] == db.T_WAIT) \
        or (task["assignee"] == user["username"] and task["status"] == db.T_REJECT)
    task["can_review"] = user["role"] in ("reviewer", "admin")
    task["badge"] = {"待领取": "wait", "标注中": "doing", "待审核": "wait",
                     "已通过": "ok", "已打回": "bad"}.get(task["status"], "")
    task["boxes"] = task["payload"] if task["kind"] == "ocr" else []
    task["editable"] = _editable(task, user)
    # 种子时把原图文件名存进了 title（tasks 表无独立 file 列），这里补回 file 字段，
    # 供模板/JS 显示「文件名」（v8 工具的「加文件名」对应需求）
    task["file"] = task.get("title")
    task["url"] = {
        "ocr": url_for("workbench.ocr_annotate", task=task["id"]),
        "proofread": url_for("workbench.proofread"),
        "ud": url_for("workbench.ud_annotator"),
    }.get(task["kind"], "#")
    return task


def _common():
    """每个页面都要带的公共变量"""
    user = current_user()
    return {
        "user": user,
        "user_names": {u["username"]: u["name"] for u in USERS},
        "stats": db.stats(),
        "todos": db.todos(user["username"], user["role"]) if user else [],
        "demo": DEMO_MODE,
        "switch_users": [u for u in USERS if not user or u["username"] != user["username"]],
    }


# --------------------------------------------------------------- 登录 / 登出
@workbench_bp.route("/login", methods=["GET", "POST"])
def login():
    """登录：校验用户名 + 口令，按角色放行不同功能（RBAC 见 _role_required）。

    口令校验只做字符串比对（mock 数据里明文存），仅为演示"门口有门禁"；
    真实平台应换成 DB + 加盐哈希 + 失败锁定 + 审计，见 docs/11 §5。
    """
    error = ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = next((u for u in USERS
                     if u["username"] == username and u["password"] == password), None)
        if not user:
            error = "用户名或口令不正确，请使用下方列出的演示账号登录"
        else:
            # 口令不进 session：会话里只留展示需要的字段
            session["wb_user"] = {k: v for k, v in user.items() if k != "password"}
            db.log(username, "登录", f"{user['name']}（{user['role_name']}）登录工作台")
            nxt = request.form.get("next") or request.args.get("next")
            return redirect(nxt or url_for("workbench.index"))
    return render_template("workbench/login.html", users=USERS, demo=DEMO_MODE, error=error)


@workbench_bp.route("/logout")
def logout():
    user = current_user()
    if user:
        db.log(user["username"], "登出", f"{user['name']} 退出工作台")
    session.pop("wb_user", None)
    # 不清空数据：库里的任务/提交是共享的，换个人登录接着看
    return redirect(url_for("portal.index"))


@workbench_bp.route("/switch/<username>")
def switch(username):
    """演示便利：一键切换身份（省得退出再登）。仅在 DEMO_MODE 下开放。"""
    if not DEMO_MODE:
        return redirect(url_for("workbench.index"))
    user = next((u for u in USERS if u["username"] == username), None)
    if user:
        session["wb_user"] = {k: v for k, v in user.items() if k != "password"}
        db.log(username, "登录", f"{user['name']} 切换身份进入工作台")
    return redirect(url_for("workbench.index"))


@workbench_bp.route("/reset", methods=["POST"])
@_login_required
def reset():
    """把演示数据恢复到初始局面（演示时反复讲流程用）"""
    db.reset_db()
    db.log(current_user()["username"], "重置", "重置演示数据到初始局面")
    return jsonify({"ok": True, "stats": db.stats()})


# --------------------------------------------------------------- 工作台首页
@workbench_bp.route("/")
@_login_required
def index():
    user = current_user()
    ctx = _common()

    if user["role"] == "annotator":
        # 标注员只看自己的：手上的活 + 自己的提交记录
        tasks = [_decorate(t, user) for t in db.list_tasks(assignee=user["username"])]
        subs = db.list_submissions(user=user["username"], limit=8)
    else:
        tasks = [_decorate(t, user) for t in _visible_tasks(user)]
        subs = db.list_submissions(limit=8)

    ocr_tasks = [t for t in tasks if t["kind"] == "ocr"]
    proof = db.list_tasks(kind="proofread")
    proof_rows = proof[0]["payload"] if proof else []
    ud = db.list_tasks(kind="ud")

    ctx.update({
        "my_tasks": tasks[:9],
        "subs": subs,
        "logs": db.list_logs(10) if user["role"] == "admin" else [],
        "tasks_total": len(ocr_tasks),
        "tasks_todo": sum(1 for t in ocr_tasks if t["status"] in (db.T_WAIT, db.T_DOING)),
        "rows_total": len(proof_rows),
        "rows_bad": sum(1 for r in proof_rows if r.get("error")),
        "ud_total": sum(len(t["payload"]) for t in ud),
        "pending_list": db.list_submissions(status=db.S_WAIT),
        "task_badge": {"待领取": "wait", "标注中": "doing", "待审核": "wait",
                       "已通过": "ok", "已打回": "bad"},
    })
    return render_template("workbench/index.html", **ctx)


# --------------------------------------------------------------- 0701 OCR 标注
@workbench_bp.route("/ocr-annotate")
@_login_required
def ocr_annotate():
    user = current_user()
    tasks = [_decorate(t, user) for t in _visible_tasks(user) if t["kind"] == "ocr"]
    cur = request.args.get("task", "")
    task = next((t for t in tasks if t["id"] == cur), None) or (tasks[0] if tasks else None)
    ctx = _common()
    ctx.update({"tasks": tasks, "task": task or {},
                "last_sub": db.list_submissions(task_id=task["id"], limit=3) if task else []})
    return render_template("workbench/ocr_annotate.html", **ctx)


@workbench_bp.route("/ocr-annotate/submit", methods=["POST"])
@_login_required
def ocr_submit():
    user = current_user()
    payload = request.get_json(force=True) or {}
    task_id = payload.get("task_id", "")
    boxes = payload.get("boxes", [])
    if not boxes:
        return jsonify({"ok": False, "msg": "还没有任何框，不能提交"}), 400
    task = db.get_task(task_id)
    title = f"{task['title']} · {len(boxes)} 框" if task else f"{task_id} · {len(boxes)} 框"
    sid, msg = db.submit_task(task_id, user["username"], boxes, title=title)
    if not sid:
        return jsonify({"ok": False, "msg": msg}), 400
    return jsonify({"ok": True, "msg": msg, "submission_id": sid,
                    "stats": db.stats(), "task": db.get_task(task_id)})


# --------------------------------------------------------------- 0701 AI 画框（真实模型代理）
# 把标注页「AI 画框」接到 Ubuntu 单词框检测服务（:7860）。后端代理而非前端直连，
# 规避 CORS / 校园网白名单，且模型服务与门户同机时走 127.0.0.1 即可。
@workbench_bp.route("/ocr-annotate/ai-detect", methods=["POST"])
@_login_required
def ocr_ai_detect():
    user = current_user()
    payload = request.get_json(force=True) or {}
    task_id = payload.get("task_id", "")
    task = db.get_task(task_id)
    if not task or task["kind"] != "ocr":
        return jsonify({"ok": False, "msg": "任务不存在或不是 OCR 标注任务"}), 400

    img_rel = task.get("image", "")
    img_path = os.path.join(current_app.static_folder, img_rel) if img_rel else ""
    if not img_path or not os.path.exists(img_path):
        return jsonify({"ok": False, "msg": "任务图片缺失：" + (img_rel or "(空)")}), 400

    try:
        with open(img_path, "rb") as f:
            raw = f.read()
    except OSError as e:
        return jsonify({"ok": False, "msg": "读取图片失败：" + str(e)}), 500

    # 转发给检测服务（multipart/form-data，字段名 file，与 v8 契约一致）
    boundary = b"----manchu_wb_boundary"
    body = (b"--" + boundary + b"\r\n"
            b'Content-Disposition: form-data; name="file"; filename="page.png"\r\n'
            b"Content-Type: image/png\r\n\r\n" + raw + b"\r\n"
            b"--" + boundary + b"--\r\n")
    req = urllib.request.Request(
        DETECT_URL, data=body,
        headers={"Content-Type": "multipart/form-data; boundary=" + boundary.decode()})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            det = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return jsonify({"ok": False,
                        "msg": "检测服务返回错误（可能模型未加载）：HTTP %d" % e.code}), 502
    except Exception as e:
        return jsonify({"ok": False,
                        "msg": "无法连接检测服务 127.0.0.1:7860，请确认 manchu-detect 已启动：" + str(e)}), 502

    iw = det.get("image_width") or 1
    ih = det.get("image_height") or 1
    boxes = det.get("boxes") or []
    if not boxes:
        return jsonify({"ok": False,
                        "msg": "AI 未检测到任何文本框（可能原图无文字或阈值过高）"}), 200

    # 原图像素坐标 -> 显示百分比（显示图等比缩放，但百分比与尺寸无关）
    pct = [{
        "x": round(b["x"] / iw * 100, 3),
        "y": round(b["y"] / ih * 100, 3),
        "w": round(b["w"] / iw * 100, 3),
        "h": round(b["h"] / ih * 100, 3),
        "conf": round(float(b.get("confidence", 0)), 3),
    } for b in boxes]

    # 列优先排序（借鉴 v8：按中心 x 聚类成列，列内按 y 自上而下）——满文竖排右起
    pct.sort(key=lambda b: b["x"] + b["w"] / 2)
    widths = sorted(b["w"] for b in pct)
    median_w = widths[len(widths) // 2] if widths else 5
    col_th = min(max(2, median_w * 0.55), median_w * 1.2)
    cols, cur = [], [pct[0]]
    for b in pct[1:]:
        prev_c = cur[-1]["x"] + cur[-1]["w"] / 2
        c = b["x"] + b["w"] / 2
        if abs(c - prev_c) > col_th:
            cols.append(cur)
            cur = [b]
        else:
            cur.append(b)
    cols.append(cur)
    for col in cols:
        col.sort(key=lambda b: b["y"])
    ordered = [b for col in cols for b in col]
    for b in ordered:
        b["suspect"] = b["conf"] < 0.7

    db.log(user["username"], "AI画框",
           f"对 {task.get('title', task['id'])} 检测得 {len(ordered)} 个文本框")
    return jsonify({"ok": True, "boxes": ordered, "count": len(ordered),
                    "inference_time_ms": det.get("inference_time_ms")})


@workbench_bp.route("/task/claim", methods=["POST"])
@_login_required
def claim():
    """领取/继续一个任务（标注员的主要动作）"""
    user = current_user()
    tid = (request.get_json(force=True) or {}).get("task_id", "")
    ok, msg = db.claim_task(tid, user["username"])
    return jsonify({"ok": ok, "msg": msg, "task": db.get_task(tid),
                    "stats": db.stats()}), (200 if ok else 400)


@workbench_bp.route("/api/submission/<sid>")
@_login_required
def api_submission(sid):
    """提交详情（审核员据此判断，不再只看一个标题）"""
    s = db.get_submission(sid)
    if not s:
        return jsonify({"ok": False, "msg": "提交记录不存在"}), 404
    t = db.get_task(s["task_id"]) or {}
    return jsonify({"ok": True, "submission": s, "task": {
        "id": t.get("id"), "title": t.get("title"), "image": t.get("image"),
        "size": t.get("size"), "page": t.get("page")}})


@workbench_bp.route("/task/assign", methods=["POST"])
@_login_required
@_role_required("admin")
def assign():
    """管理员指派/改派任务"""
    payload = request.get_json(force=True) or {}
    ok, msg = db.assign_task(payload.get("task_id", ""), payload.get("username", ""),
                             current_user()["username"])
    return jsonify({"ok": ok, "msg": msg}), (200 if ok else 400)


# --------------------------------------------------------------- 0702 双行校对
@workbench_bp.route("/proofread")
@_login_required
def proofread():
    user = current_user()
    task = next((t for t in db.list_tasks(kind="proofread")
                 if t["assignee"] in (None, user["username"])
                 or user["role"] in ("admin", "reviewer")), None)
    task = _decorate(task, user) if task else {}
    ctx = _common()
    rows = task.get("payload", []) if task else []
    ctx.update({"rows": rows, "task": task,
                "bad_rows": [r["idx"] for r in rows if r.get("error")],
                "last_sub": db.list_submissions(task_id=task["id"], limit=3) if task else []})
    return render_template("workbench/proofread.html", **ctx)


@workbench_bp.route("/proofread/submit", methods=["POST"])
@_login_required
def proofread_submit():
    user = current_user()
    payload = request.get_json(force=True) or {}
    fixed = payload.get("fixed", [])
    task = next((t for t in db.list_tasks(kind="proofread")
                 if t["assignee"] in (None, user["username"])), None)
    if not task:
        return jsonify({"ok": False, "msg": "没有指派给你的校对任务"}), 400
    title = f"{task['title']} · {len(task['payload'])} 句对（修正 {len(fixed)} 处）"
    sid, msg = db.submit_task(task["id"], user["username"], {"fixed": fixed}, title=title)
    if not sid:
        return jsonify({"ok": False, "msg": msg}), 400
    return jsonify({"ok": True, "msg": msg, "submission_id": sid, "stats": db.stats()})


# --------------------------------------------------------------- 0703 依存标注
@workbench_bp.route("/ud-annotator")
@_login_required
def ud_annotator():
    user = current_user()
    task = next((t for t in db.list_tasks(kind="ud")
                 if t["assignee"] in (None, user["username"])
                 or user["role"] in ("admin", "reviewer")), None)
    task = _decorate(task, user) if task else {}
    ctx = _common()
    sentences = task.get("payload", []) if task else []
    ctx.update({"sentences": sentences, "sentence": sentences[0] if sentences else {},
                "task": task,
                "last_sub": db.list_submissions(task_id=task["id"], limit=3) if task else []})
    return render_template("workbench/ud_annotator.html", **ctx)


@workbench_bp.route("/ud-annotator/submit", methods=["POST"])
@_login_required
def ud_submit():
    user = current_user()
    payload = request.get_json(force=True) or {}
    sents = payload.get("sentences", [])
    task = next((t for t in db.list_tasks(kind="ud")
                 if t["assignee"] in (None, user["username"])), None)
    if not task:
        return jsonify({"ok": False, "msg": "没有指派给你的依存标注任务"}), 400
    sid, msg = db.submit_task(task["id"], user["username"], {"sentences": sents},
                              title=f"{task['title']} · {len(sents)} 句")
    if not sid:
        return jsonify({"ok": False, "msg": msg}), 400
    return jsonify({"ok": True, "msg": msg, "submission_id": sid, "stats": db.stats()})


# --------------------------------------------------------------- 审核台（审核员+）
@workbench_bp.route("/review")
@_login_required
@_role_required("reviewer")
def review():
    ctx = _common()
    ctx.update({"pending": db.list_submissions(status=db.S_WAIT),
                "reviewed": db.list_submissions(status=[db.S_PASS, db.S_REJECT], limit=20)})
    return render_template("workbench/review.html", **ctx)


@workbench_bp.route("/review/decide", methods=["POST"])
@_login_required
@_role_required("reviewer")
def review_decide():
    payload = request.get_json(force=True) or {}
    sid = payload.get("id", "")
    approve = bool(payload.get("approve", True))
    comment = (payload.get("comment", "") or "").strip()
    if not approve and not comment:
        return jsonify({"ok": False, "msg": "打回必须写清原因，标注员才知道改什么"}), 400
    ok, msg = db.review_task(sid, current_user()["username"], approve, comment)
    return jsonify({"ok": ok, "msg": msg, "stats": db.stats()}), (200 if ok else 400)


# --------------------------------------------------------------- 管理页（管理员）
@workbench_bp.route("/admin")
@_login_required
@_role_required("admin")
def admin():
    ctx = _common()
    user = current_user()
    tasks = [_decorate(t, user) for t in db.list_tasks()]
    ctx.update({
        "tasks": tasks,
        "members": db.list_users(),
        "logs": db.list_logs(40),
        "annotators": [u for u in USERS if u["role"] in ("annotator", "reviewer")],
        "unassigned": [t for t in tasks if not t["assignee"]],
    })
    return render_template("workbench/admin.html", **ctx)
