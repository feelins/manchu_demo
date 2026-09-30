"""工作平台 · 数据层（SQLite 落盘）

2026-09-30 升级：从「进程内内存 mock」改为 **SQLite 落盘**。

为什么必须改——原实现有三处当场就会穿帮的假：

1. **多 worker 各存一份**（最要命）：gunicorn 是 `workers=2`，原来的 `_SUBS` 是模块级
   列表，每个 worker 进程各有一份。标注员提交可能落在 worker A，审核员刷新落到
   worker B —— 待审队列是空的，"提交 → 审核"这条闭环根本演不出来。
2. **重启即失忆**：进程一重启，任务状态、提交、审核全回落到 mock 初值。
3. **状态不回写**：标注员交完，任务列表里那张图还是"待标注"，换个人还能再交一遍；
   打回之后的记录也没有去处，标注员看不到"我被打回了、原因是什么"。

落盘之后：换账号、换浏览器、重启门户，三个角色看到的都是**同一份真实流转的数据**。

--------------------------------------------------------------------------
任务状态机（ocr / proofread / ud 三种任务共用一套）
--------------------------------------------------------------------------

    待领取 ──领取──▶ 标注中 ──提交──▶ 待审核 ──通过──▶ 已通过
                       ▲                │
                       └──── 返工 ───── 已打回 ◀──打回──┘

· 未指派的任务标注员可自行「领取」，管理员也可直接指派给某人
· 打回时 assignee 保留原标注员：**只有他能返工**，避免"谁都能改别人的数据"
· 每次提交都带 attempt（第几次提交），返工重提时能看出"这是第 2 稿"
"""

import datetime
import json
import os
import sqlite3
from contextlib import contextmanager

from .mock import OCR_TASKS, PROOFREAD_ROWS, UD_SENTENCES, USERS

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_PATH = os.environ.get("WB_DB") or os.path.join(BASE_DIR, "data", "workbench.db")

# ---- 任务状态 ----
T_WAIT = "待领取"      # 未指派，或已指派但还没开工
T_DOING = "标注中"     # 已领取，正在做
T_REVIEW = "待审核"    # 已提交，等审核
T_PASS = "已通过"
T_REJECT = "已打回"    # 审核打回，退回标注员返工

# ---- 提交状态 ----
S_WAIT = "待审核"
S_PASS = "已通过"
S_REJECT = "已打回"

KIND_NAME = {"ocr": "OCR 标注", "proofread": "双行校对", "ud": "依存标注"}
KIND_URL = {"ocr": "workbench.ocr_annotate",
            "proofread": "workbench.proofread",
            "ud": "workbench.ud_annotator"}


def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")


@contextmanager
def conn():
    """每次操作开一条新连接：gunicorn 是 gthread 多线程 + 多 worker 进程，
    连接不能跨线程复用。WAL 模式下多进程读写同一文件是安全的。"""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=8)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id         TEXT PRIMARY KEY,      -- 任务号 T-2509xx-xx
    kind       TEXT NOT NULL,         -- ocr / proofread / ud
    title      TEXT NOT NULL,         -- 展示名：ja042.jpg
    image      TEXT,                  -- 底图（OCR 任务）
    size       TEXT,                  -- 原图尺寸
    page       INTEGER,
    payload    TEXT,                  -- JSON：框 / 行 / 句（原始素材）
    assignee   TEXT,                  -- 指派给谁（空=未指派）
    status     TEXT NOT NULL,
    comment    TEXT DEFAULT '',       -- 最近一次审核意见（打回时有用）
    created_at TEXT,
    updated_at TEXT
);
CREATE TABLE IF NOT EXISTS submissions (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL,
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL,
    user        TEXT NOT NULL,        -- 提交人 username
    payload     TEXT,                 -- JSON：提交内容（框文本等，供审核查看）
    attempt     INTEGER DEFAULT 1,    -- 第几次提交（返工重提会 +1）
    status      TEXT NOT NULL,
    reviewer    TEXT,
    comment     TEXT DEFAULT '',
    created_at  TEXT,
    reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS logs (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       TEXT NOT NULL,
    username TEXT NOT NULL,
    name     TEXT,                    -- 中文名，便于管理员页面直接看
    role     TEXT,
    action   TEXT NOT NULL,           -- 领取/提交/通过/打回/指派/登录/重置
    detail   TEXT,                    -- 人话描述
    task_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sub_status ON submissions(status);
CREATE INDEX IF NOT EXISTS idx_sub_task   ON submissions(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assign ON tasks(assignee);
"""


# --------------------------------------------------------------- 初始化与种子
def _seed_tasks():
    """演示初始局面——刻意让三种角色一登录就都有事可做：

        ja042  张同学  已通过   ← 历史成绩，看板/通过率不至于是空的
        ja043  张同学  待审核   ← 李老师（审核员）登录就有待审
        ja044  未指派  待领取   ← 张同学可自行领取；王老师也可指派给别人
        ja045  张同学  已打回   ← 张同学登录就看见"待返工 + 审核意见"
        ja046  未指派  待领取
        ja047  张同学  标注中   ← "我正标着这张"
    """
    layout = {
        "ja042": ("zhang", T_PASS, ""),
        "ja043": ("zhang", T_REVIEW, ""),
        "ja044": (None, T_WAIT, ""),
        "ja045": ("zhang", T_REJECT, "第 3 列切分偏了，右侧还有一列没框到，请重新画框后提交"),
        "ja046": (None, T_WAIT, ""),
        "ja047": ("zhang", T_DOING, ""),
    }
    rows = []
    for i, t in enumerate(OCR_TASKS, start=1):
        assignee, status, comment = layout.get(t["id"], (None, T_WAIT, ""))
        rows.append({
            "id": f"T-2609-{i:03d}",
            "kind": "ocr",
            "title": t["file"],
            "image": t["image"],
            "size": t.get("size", ""),
            "page": t.get("page"),
            "payload": json.dumps(t["boxes"], ensure_ascii=False),
            "assignee": assignee,
            "status": status,
            "comment": comment,
            "created_at": "2026-09-29 09:00",
            "updated_at": "2026-09-29 09:00",
        })
    # 一个校对任务、一个依存任务，让"标注工具"入口不是空的
    rows.append({
        "id": "T-2609-101", "kind": "proofread", "title": "all_v8_part03.txt",
        "image": None, "size": f"{len(PROOFREAD_ROWS)} 句对", "page": None,
        "payload": json.dumps(PROOFREAD_ROWS, ensure_ascii=False),
        "assignee": "zhang", "status": T_WAIT, "comment": "",
        "created_at": "2026-09-29 09:00", "updated_at": "2026-09-29 09:00",
    })
    rows.append({
        "id": "T-2609-102", "kind": "ud", "title": "ud_batch04.conllu",
        "image": None, "size": f"{len(UD_SENTENCES)} 句", "page": None,
        "payload": json.dumps(UD_SENTENCES, ensure_ascii=False),
        "assignee": "zhang", "status": T_PASS, "comment": "",
        "created_at": "2026-09-28 09:00", "updated_at": "2026-09-28 15:20",
    })
    return rows


def _seed_subs():
    """历史提交记录：ja042 已通过、ja043 待审、ja045 被打回（带意见）"""
    return [
        {"id": "S-260930-002", "task_id": "T-2609-002", "kind": "ocr", "title": "ja043.jpg · 3 框",
         "user": "zhang", "payload": json.dumps(OCR_TASKS[1]["boxes"], ensure_ascii=False),
         "attempt": 1, "status": S_WAIT, "reviewer": None, "comment": "",
         "created_at": "2026-09-30 10:12", "reviewed_at": None},
        {"id": "S-260929-001", "task_id": "T-2609-001", "kind": "ocr", "title": "ja042.jpg · 4 框",
         "user": "zhang", "payload": json.dumps(OCR_TASKS[0]["boxes"], ensure_ascii=False),
         "attempt": 1, "status": S_PASS, "reviewer": "li", "comment": "",
         "created_at": "2026-09-29 16:20", "reviewed_at": "2026-09-29 16:48"},
        {"id": "S-260929-000", "task_id": "T-2609-004", "kind": "ocr", "title": "ja045.jpg · 3 框",
         "user": "zhang", "payload": json.dumps(OCR_TASKS[3]["boxes"], ensure_ascii=False),
         "attempt": 1, "status": S_REJECT, "reviewer": "li",
         "comment": "第 3 列切分偏了，右侧还有一列没框到，请重新画框后提交",
         "created_at": "2026-09-29 11:05", "reviewed_at": "2026-09-29 14:30"},
        {"id": "S-260927-004", "task_id": "T-2609-102", "kind": "ud", "title": "ud_batch04.conllu · 3 句",
         "user": "zhang", "payload": json.dumps(UD_SENTENCES, ensure_ascii=False),
         "attempt": 1, "status": S_PASS, "reviewer": "li", "comment": "",
         "created_at": "2026-09-27 15:20", "reviewed_at": "2026-09-27 15:55"},
    ]


def _seed_logs():
    p = [("2026-09-29 09:00", "wang", "王老师", "admin", "指派", "把 6 张整页古籍分配给张同学"),
         ("2026-09-29 11:05", "zhang", "张同学", "annotator", "提交", "提交 ja045.jpg · 3 框"),
         ("2026-09-29 14:30", "li", "李老师", "reviewer", "打回", "打回 ja045.jpg：第 3 列切分偏了"),
         ("2026-09-29 16:20", "zhang", "张同学", "annotator", "提交", "提交 ja042.jpg · 4 框"),
         ("2026-09-29 16:48", "li", "李老师", "reviewer", "通过", "通过 ja042.jpg · 4 框"),
         ("2026-09-30 10:12", "zhang", "张同学", "annotator", "提交", "提交 ja043.jpg · 3 框")]
    return [{"ts": a, "username": b, "name": c, "role": d, "action": e,
             "detail": f, "task_id": None} for a, b, c, d, e, f in p]


def _user_map():
    return {u["username"]: u for u in USERS}


def log(username, action, detail, task_id=None):
    u = _user_map().get(username, {})
    with conn() as c:
        c.execute("INSERT INTO logs (ts, username, name, role, action, detail, task_id)"
                  " VALUES (?,?,?,?,?,?,?)",
                  (now(), username, u.get("name", username), u.get("role", ""),
                   action, detail, task_id))


def init_db(force=False):
    """建表 + 首次种子。force=True 时清空重建（"重置演示数据"用）。"""
    with conn() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)
        n = c.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        if n and not force:
            return False
        if force:
            c.execute("DELETE FROM tasks")
            c.execute("DELETE FROM submissions")
            c.execute("DELETE FROM logs")
        c.executemany(
            "INSERT INTO tasks (id,kind,title,image,size,page,payload,assignee,status,"
            "comment,created_at,updated_at) VALUES (:id,:kind,:title,:image,:size,:page,"
            ":payload,:assignee,:status,:comment,:created_at,:updated_at)", _seed_tasks())
        c.executemany(
            "INSERT INTO submissions (id,task_id,kind,title,user,payload,attempt,status,"
            "reviewer,comment,created_at,reviewed_at) VALUES (:id,:task_id,:kind,:title,:user,"
            ":payload,:attempt,:status,:reviewer,:comment,:created_at,:reviewed_at)", _seed_subs())
        for r in _seed_logs():
            c.execute("INSERT INTO logs (ts,username,name,role,action,detail,task_id)"
                      " VALUES (?,?,?,?,?,?,?)",
                      (r["ts"], r["username"], r["name"], r["role"], r["action"],
                       r["detail"], r["task_id"]))
    return True


def reset_db():
    init_db(force=True)


# --------------------------------------------------------------- 任务读写
def _task_row(r):
    d = dict(r)
    d["payload"] = json.loads(d["payload"] or "[]")
    d["kind_name"] = KIND_NAME.get(d["kind"], d["kind"])
    return d


def list_tasks(kind=None, assignee=None, status=None):
    q, args = "SELECT * FROM tasks WHERE 1=1", []
    if kind:
        q += " AND kind=?"; args.append(kind)
    if assignee:
        q += " AND assignee=?"; args.append(assignee)
    if status:
        if isinstance(status, (list, tuple)):
            q += " AND status IN (%s)" % ",".join("?" * len(status)); args += list(status)
        else:
            q += " AND status=?"; args.append(status)
    q += " ORDER BY id"
    with conn() as c:
        return [_task_row(r) for r in c.execute(q, args).fetchall()]


def get_task(tid):
    with conn() as c:
        r = c.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    return _task_row(r) if r else None


def _touch(c, tid, **fields):
    sets = ", ".join(f"{k}=?" for k in fields)
    c.execute(f"UPDATE tasks SET {sets}, updated_at=? WHERE id=?",
              list(fields.values()) + [now(), tid])


def claim_task(tid, username):
    """领取任务：待领取 / 已打回 → 标注中。已被别人占的任务不允许抢。"""
    t = get_task(tid)
    if not t:
        return False, "任务不存在"
    if t["assignee"] and t["assignee"] != username and t["status"] in (T_DOING, T_REVIEW):
        return False, f"该任务已由 {t['assignee']} 负责"
    if t["status"] == T_PASS:
        return False, "该任务已通过审核，无需再标"
    with conn() as c:
        _touch(c, tid, assignee=username, status=T_DOING)
    log(username, "领取", f"领取任务 {t['title']}", tid)
    return True, "已领取"


def submit_task(tid, username, payload, title=None):
    """提交：标注中 / 已打回 → 待审核，同时写一条提交记录（attempt 递增）"""
    t = get_task(tid)
    if not t:
        return None, "任务不存在"
    if t["assignee"] and t["assignee"] != username:
        return None, "这不是指派给你的任务"
    if t["status"] == T_PASS:
        return None, "该任务已通过审核，无需再提交"
    if t["status"] == T_REVIEW:
        return None, "该任务已在审核中，请勿重复提交"
    with conn() as c:
        prev = c.execute("SELECT COUNT(*) FROM submissions WHERE task_id=?", (tid,)).fetchone()[0]
        # 编号要**全局唯一**：按"该任务的第几次"编会撞号（两个任务各自首次提交都是 -001），
        # 所以取全局条数为基数，再循环兜底到不重复为止。
        n = c.execute("SELECT COUNT(*) FROM submissions").fetchone()[0]
        today = datetime.datetime.now().strftime("%y%m%d")
        sid = "S-%s-%03d" % (today, n + 1)
        while c.execute("SELECT 1 FROM submissions WHERE id=?", (sid,)).fetchone():
            n += 1
            sid = "S-%s-%03d" % (today, n + 1)
        c.execute("INSERT INTO submissions (id,task_id,kind,title,user,payload,attempt,"
                  "status,reviewer,comment,created_at,reviewed_at)"
                  " VALUES (?,?,?,?,?,?,?,?,NULL,'',?,NULL)",
                  (sid, tid, t["kind"], title or f"{t['title']} · 提交", username,
                   json.dumps(payload, ensure_ascii=False), prev + 1, S_WAIT, now()))
        _touch(c, tid, assignee=username, status=T_REVIEW, comment="")
    log(username, "提交", f"提交 {t['title']}（第 {prev + 1} 次）", tid)
    return sid, "已提交，等待审核"


def assign_task(tid, username, actor):
    """管理员指派/改派"""
    t = get_task(tid)
    if not t:
        return False, "任务不存在"
    if t["status"] in (T_PASS, T_REVIEW):
        return False, f"任务处于「{t['status']}」，不能改派"
    with conn() as c:
        _touch(c, tid, assignee=username or None, status=T_WAIT)
    who = _user_map().get(username, {}).get("name", username) if username else "（收回，未指派）"
    log(actor, "指派", f"把 {t['title']} 指派给 {who}", tid)
    return True, f"已指派给 {who}"


def review_task(sid, reviewer, approve, comment=""):
    """审核：通过 → 任务已通过；打回 → 任务已打回（退回原标注员返工）"""
    with conn() as c:
        s = c.execute("SELECT * FROM submissions WHERE id=?", (sid,)).fetchone()
        if not s:
            return False, "提交记录不存在"
        s = dict(s)
        status = S_PASS if approve else S_REJECT
        c.execute("UPDATE submissions SET status=?, reviewer=?, comment=?, reviewed_at=?"
                  " WHERE id=?", (status, reviewer, comment, now(), sid))
        # 只有"最新一稿"的审核结果才回写任务状态（防止旧稿审核覆盖新状态）
        latest = c.execute("SELECT id FROM submissions WHERE task_id=?"
                           " ORDER BY attempt DESC LIMIT 1", (s["task_id"],)).fetchone()
        if latest and latest[0] == sid:
            _touch(c, s["task_id"],
                   status=T_PASS if approve else T_REJECT, comment=comment or "")
    act = "通过" if approve else "打回"
    log(reviewer, act, f"{act} {s['title']}" + (f"：{comment}" if comment else ""), s["task_id"])
    return True, act + "成功"


# --------------------------------------------------------------- 提交 / 日志读
def list_submissions(user=None, status=None, task_id=None, limit=None):
    q, args = "SELECT * FROM submissions WHERE 1=1", []
    if user:
        q += " AND user=?"; args.append(user)
    if status:
        if isinstance(status, (list, tuple)):
            q += " AND status IN (%s)" % ",".join("?" * len(status)); args += list(status)
        else:
            q += " AND status=?"; args.append(status)
    if task_id:
        q += " AND task_id=?"; args.append(task_id)
    q += " ORDER BY created_at DESC, id DESC"
    if limit:
        q += f" LIMIT {int(limit)}"
    with conn() as c:
        out = []
        for r in c.execute(q, args).fetchall():
            d = dict(r)
            d["payload"] = json.loads(d["payload"] or "[]")
            d["kind_name"] = KIND_NAME.get(d["kind"], d["kind"])
            out.append(d)
        return out


def get_submission(sid):
    subs = list_submissions()
    return next((s for s in subs if s["id"] == sid), None)


def list_logs(limit=60):
    with conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT * FROM logs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()]


def list_users():
    """带实时工作量的用户列表（管理员看板用）"""
    out = []
    for u in USERS:
        with conn() as c:
            doing = c.execute("SELECT COUNT(*) FROM tasks WHERE assignee=? AND status IN (?,?)",
                              (u["username"], T_DOING, T_REJECT)).fetchone()[0]
            waiting = c.execute("SELECT COUNT(*) FROM tasks WHERE assignee=? AND status=?",
                                (u["username"], T_REVIEW)).fetchone()[0]
            passed = c.execute("SELECT COUNT(*) FROM tasks WHERE assignee=? AND status=?",
                               (u["username"], T_PASS)).fetchone()[0]
            subs = c.execute("SELECT COUNT(*) FROM submissions WHERE user=?",
                             (u["username"],)).fetchone()[0]
            reviewed = c.execute("SELECT COUNT(*) FROM submissions WHERE reviewer=?",
                                 (u["username"],)).fetchone()[0]
        out.append({**{k: v for k, v in u.items() if k != "password"},
                    "doing": doing, "waiting": waiting, "passed": passed,
                    "subs": subs, "reviewed": reviewed})
    return out


# --------------------------------------------------------------- 统计
def stats():
    """首页统计卡：以**任务**为准（不再是只看提交记录）"""
    with conn() as c:
        q = lambda sql, a=(): c.execute(sql, a).fetchone()[0]
        total = q("SELECT COUNT(*) FROM tasks")
        passed = q("SELECT COUNT(*) FROM tasks WHERE status=?", (T_PASS,))
        review = q("SELECT COUNT(*) FROM tasks WHERE status=?", (T_REVIEW,))
        doing = q("SELECT COUNT(*) FROM tasks WHERE status=?", (T_DOING,))
        wait = q("SELECT COUNT(*) FROM tasks WHERE status=?", (T_WAIT,))
        reject = q("SELECT COUNT(*) FROM tasks WHERE status=?", (T_REJECT,))
        subs = q("SELECT COUNT(*) FROM submissions")
    done = passed + reject
    return {"total": total, "passed": passed, "pending": review, "doing": doing,
            "wait": wait, "reject": reject, "subs": subs,
            "rate": round(passed / done * 100) if done else 0}


def todos(username, role):
    """按角色的「我的待办」——首页第一屏要给出"这人现在该干什么\""""
    out = []
    if role == "annotator":
        mine = list_tasks(assignee=username, status=[T_DOING, T_REJECT])
        out.append({"label": "我手上的任务", "count": len(mine), "kind": "todo",
                    "url": "workbench.ocr_annotate",
                    "hint": "含被打回需要返工的"})
        back = [t for t in mine if t["status"] == T_REJECT]
        if back:
            out.append({"label": "被打回待返工", "count": len(back), "kind": "bad",
                        "url": "workbench.ocr_annotate", "hint": "审核意见已附在任务上"})
        free = len(list_tasks(status=T_WAIT))
        out.append({"label": "可领取的新任务", "count": free, "kind": "wait",
                    "url": "workbench.ocr_annotate", "hint": "在任务列表里点「领取」"})
    if role in ("reviewer", "admin"):
        out.append({"label": "待我验收", "count": len(list_submissions(status=S_WAIT)),
                    "kind": "wait", "url": "workbench.review",
                    "hint": "通过或打回，打回需写意见"})
    if role == "admin":
        out.append({"label": "未指派任务", "count": len(list_tasks(status=T_WAIT)),
                    "kind": "todo", "url": "workbench.admin", "hint": "可在管理页直接指派"}
                   )
        out.append({"label": "操作日志", "count": len(list_logs(999)), "kind": "ok",
                    "url": "workbench.admin", "hint": "谁在什么时候做了什么"})
    return out
