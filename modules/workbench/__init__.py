"""工作平台（**演示版**蓝图）

这一版的目标：把「登录 → 标注/校对 → 提交 → 审核 → 统计变化 → 权限拦截」
这条完整流程**演出来**，用来讲清楚工作平台是什么、怎么操作。

刻意不做的事（真实平台必须补，见 docs/11 第 5 节）：
· 不接数据库 —— 提交/审核记录存 Flask session，换浏览器即空
· 不做真实上传下载 —— 标注结果不落盘，导出只在前端用 Blob 生成
· 不做真鉴权 —— 登录页直接选身份，无口令校验

数据全部来自 mock.py；演示底稿（古籍图、句对）取自语料切片，看起来像真的。
"""

import datetime
from functools import wraps

from flask import (Blueprint, jsonify, redirect, render_template, request,
                   session, url_for)

from .mock import (BASE_SUBMISSIONS, OCR_TASKS, PROOFREAD_ROWS, ROLE_LEVEL,
                   UD_SENTENCES, USERS)

# 演示模式开关：页面上据此常驻提示"数据不落盘"
DEMO_MODE = True

workbench_bp = Blueprint("workbench", __name__, url_prefix="/workbench")


# --------------------------------------------------------------- 会话与权限
def current_user():
    return session.get("wb_user")


def _login_required(view):
    """未登录一律回登录页（演示版 RBAC 的第一道门）"""
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


# --------------------------------------------------------------- 提交记录（session）
# 提交记录放在**模块级列表**里，而不是各自的 session：
# 否则标注员（A 浏览器）提交后，审核员（B 浏览器）根本看不到，"提交→审核"闭环演示不出来。
# 代价是所有访客共享一份演示数据——演示场景无所谓，反而更像真系统。
# 真实平台这里应换成数据库（见 docs/11 §3.6）。
_SUBS = [dict(s) for s in BASE_SUBMISSIONS]


def _subs():
    return _SUBS


def _save_subs(subs):
    _SUBS[:] = subs


def _add_submission(kind, title, status="待审核"):
    subs = _subs()
    sub = {
        "id": f"S-{datetime.datetime.now():%y%m%d}-{len(subs) + 1:03d}",
        "type": kind,
        "title": title,
        "user": current_user()["name"],
        "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        "status": status,
        "comment": "",
    }
    subs.insert(0, sub)
    _save_subs(subs)
    return sub


def _stats():
    subs = _subs()
    passed = sum(1 for s in subs if s["status"] == "已通过")
    rejected = sum(1 for s in subs if s["status"] == "已驳回")
    pending = sum(1 for s in subs if s["status"] == "待审核")
    done = passed + rejected
    return {
        "total": len(subs),
        "pending": pending,
        "passed": passed,
        "rejected": rejected,
        "done": done,
        "rate": round(passed / done * 100) if done else 0,
    }


def _common():
    """每个页面都要带的公共变量"""
    return {"user": current_user(), "stats": _stats(), "demo": DEMO_MODE}


# --------------------------------------------------------------- 登录 / 登出
@workbench_bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        uid = request.form.get("uid", "")
        user = next((u for u in USERS if u["id"] == uid), None)
        if not user:
            return redirect(url_for("workbench.login"))
        session["wb_user"] = user
        return redirect(request.args.get("next") or url_for("workbench.index"))
    return render_template("workbench/login.html", users=USERS, demo=DEMO_MODE)


@workbench_bp.route("/logout")
def logout():
    session.pop("wb_user", None)
    # 不清空提交记录：演示数据是共享的，换个人登录还要接着看
    return redirect(url_for("portal.index"))


@workbench_bp.route("/reset", methods=["POST"])
def reset():
    """把演示数据恢复到初始状态（演示时反复讲流程用）"""
    _SUBS[:] = [dict(s) for s in BASE_SUBMISSIONS]
    return jsonify({"ok": True, "stats": _stats()})


# --------------------------------------------------------------- 工作台首页
@workbench_bp.route("/")
@_login_required
def index():
    ctx = _common()
    ctx.update({
        "subs": _subs(),
        "pending_list": [s for s in _subs() if s["status"] == "待审核"],
        "tasks_total": len(OCR_TASKS),
        "tasks_todo": sum(1 for t in OCR_TASKS if t["status"] == "待标注"),
        "rows_total": len(PROOFREAD_ROWS),
        "rows_bad": sum(1 for r in PROOFREAD_ROWS if r["error"]),
        "ud_total": len(UD_SENTENCES),
    })
    return render_template("workbench/index.html", **ctx)


# --------------------------------------------------------------- 0701 OCR 标注
@workbench_bp.route("/ocr-annotate")
@_login_required
def ocr_annotate():
    ctx = _common()
    ctx.update({"tasks": OCR_TASKS, "task": OCR_TASKS[0]})
    return render_template("workbench/ocr_annotate.html", **ctx)


@workbench_bp.route("/ocr-annotate/submit", methods=["POST"])
@_login_required
def ocr_submit():
    payload = request.get_json(force=True) or {}
    task_id = payload.get("task_id", "")
    boxes = payload.get("boxes", [])
    task = next((t for t in OCR_TASKS if t["id"] == task_id), None)
    title = f"{task['id']}.png · {len(boxes)} 框" if task else f"{task_id} · {len(boxes)} 框"
    sub = _add_submission("OCR 标注", title)
    return jsonify({"ok": True, "submission": sub, "stats": _stats()})


# --------------------------------------------------------------- 0702 双行校对
@workbench_bp.route("/proofread")
@_login_required
def proofread():
    ctx = _common()
    ctx.update({
        "rows": PROOFREAD_ROWS,
        "bad_rows": [r["idx"] for r in PROOFREAD_ROWS if r["error"]],
    })
    return render_template("workbench/proofread.html", **ctx)


@workbench_bp.route("/proofread/submit", methods=["POST"])
@_login_required
def proofread_submit():
    payload = request.get_json(force=True) or {}
    fixed = payload.get("fixed", [])
    title = f"all_v8_part03 · {len(PROOFREAD_ROWS)} 句对（修正 {len(fixed)} 处）"
    sub = _add_submission("双行校对", title)
    return jsonify({"ok": True, "submission": sub, "stats": _stats()})


# --------------------------------------------------------------- 0703 依存标注
@workbench_bp.route("/ud-annotator")
@_login_required
def ud_annotator():
    ctx = _common()
    ctx.update({"sentences": UD_SENTENCES, "sentence": UD_SENTENCES[0]})
    return render_template("workbench/ud_annotator.html", **ctx)


@workbench_bp.route("/ud-annotator/submit", methods=["POST"])
@_login_required
def ud_submit():
    payload = request.get_json(force=True) or {}
    count = len(payload.get("sentences", []))
    sub = _add_submission("依存标注", f"ud_batch04.conllu · {count} 句")
    return jsonify({"ok": True, "submission": sub, "stats": _stats()})


# --------------------------------------------------------------- 审核台（审核员+）
@workbench_bp.route("/review")
@_login_required
@_role_required("reviewer")
def review():
    ctx = _common()
    ctx.update({"pending": [s for s in _subs() if s["status"] == "待审核"],
                "reviewed": [s for s in _subs() if s["status"] != "待审核"]})
    return render_template("workbench/review.html", **ctx)


@workbench_bp.route("/review/decide", methods=["POST"])
@_login_required
@_role_required("reviewer")
def review_decide():
    payload = request.get_json(force=True) or {}
    sub_id = payload.get("id", "")
    approve = payload.get("approve", True)
    comment = payload.get("comment", "")
    subs = _subs()
    for s in subs:
        if s["id"] == sub_id:
            s["status"] = "已通过" if approve else "已驳回"
            s["comment"] = comment
            s["reviewer"] = current_user()["name"]
            break
    _save_subs(subs)
    return jsonify({"ok": True, "stats": _stats()})
