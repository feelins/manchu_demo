# 17 · OCR 标注页接入真实 AI 画框模型 + 字体/文件名落定

> 日期：2026-10-03
> 关联：[11-工作平台初稿设计](./11-工作平台模块分析与初稿设计.md)、
> [15-满文古籍OCR标注页改造说明](./15-满文古籍OCR标注页改造说明.md)、
> [16-工作平台真实协作改造](./16-工作平台真实协作改造方案与过程记录.md)、
> 用户提供《AI画框模型部署交接说明.md》

---

## 0. 一句话结论

把【工作台 › 满文古籍 OCR 标注】页从"借鉴 v8 外观 + mock"进一步做实：
**AI 画框按钮现在真正调用 Ubuntu 上常驻的单词框检测模型**（YOLOv8n v6，端口 7860），
后端代理、坐标换算、列优先排序全部打通；同时确认了本页字体就是用户指定的
`问题反馈2\001A-Buleku-R.ttf`（与现内嵌字体字节一致），并**修掉了文件名一直不显示的真 bug**。

---

## 1. 用户三项要求

| # | 要求 | 落地情况 |
|---|---|---|
| 1 | 借鉴 v8 工具（`manchu_annotation_tool_v8…文本框加长加文件名.html`）的实现 | 文本框加长已具备；"加文件名"修了真 bug（见 §3.3） |
| 2 | 接入已部署在 Ubuntu 的 AI 画框模型（见交接说明） | 已接真实模型，后端代理 `/workbench/ocr-annotate/ai-detect` → `127.0.0.1:7860/detect`（见 §3.1） |
| 3 | 本页必须用 `问题反馈2\001A-Buleku-R.ttf`，内嵌到 HTML | 已确认该字体 == 本页内嵌的 `static/fonts/annot/001A-Buleku-R.ttf`（md5 一致），需求本就满足（见 §3.2） |
| — | 方案与实现步骤落盘 | 本文档 |

---

## 2. 动手前现状盘点

- OCR 标注页（doc 15 改造完成）已有：整页画布、竖排列框、竖排满文校对框、`BulekuAnnot` 内嵌字体。
- **「AI 画框 / AI 预测」此前是 mock**：前端 `btnDetect` 只是把预设框 `shown=true` 显示出来，**根本不调模型**。
- **字体**：站内两份同名 `001A-Buleku-R.ttf`——
  - 全局 `static/fonts/001A-Buleku-R.ttf`（md5 `3f1f78…`）→ 其他版块用 `'Buleku'`
  - 专用 `static/fonts/annot/001A-Buleku-R.ttf`（md5 `6b011d…`）→ 仅本页用 `'BulekuAnnot'`
  - 用户指定的「问题反馈2」那份 md5 经核验 **也是 `6b011d…`**，即本页早已内嵌的那款 → **无需换文件**。
- **文本框**：`.wb-anno-input` 已是 `height:300px; font-size:30px`（doc 15 已加长），符合要求。
- **文件名（关键发现）**：模板/JS 用 `task.file`，但 `tasks` 表**没有 `file` 列**——种子把原图文件名存进了 `title`。
  所以 `task.file` 一直为空，文件名实际没显示。这才是"加文件名"要修的真问题。

---

## 3. 方案与改动

### 3.1 接入真实 AI 画框模型（核心）

**模型服务（用户提供交接说明）**
- YOLOv8n 单类单词框检测，输入整页图、输出单词/文本块边框。
- 监听 `0.0.0.0:7860`，`POST /detect`：`multipart/form-data`，字段名 `file`，返回
  `{image_width, image_height, boxes:[{x,y,w,h,confidence}], box_count, inference_time_ms}`（原图像素坐标）。
- CPU 推理约 68ms/页（CUDA 12 与 onnxruntime-gpu 要求的 13 不匹配，自动回落 CPU，仅 WARNING）。

**集成方式：后端代理（而非前端直连）**
- 新增路由 `POST /workbench/ocr-annotate/ai-detect`：
  1. 取任务底图（`task.image` → `static/` 下文件）；
  2. 以 `multipart` 转发给 `http://127.0.0.1:7860/detect`；
  3. 把**原图像素坐标换算为显示百分比**：`x% = x/image_width*100`（y/w/h 同理，与显示尺寸无关）；
  4. **列优先排序**（借鉴 v8 逻辑）：按框中心 x 升序 → 按中位列宽聚类成列 → 每列内按 y 自上而下；
  5. 标记低置信度（`conf<0.7` → `suspect`）；返回 `{ok, boxes, count, inference_time_ms}`。
- 前端 `btnDetect` 改为 `fetch` 该路由，用返回框**替换**当前框并渲染（替代原 mock）。

**为什么走后端代理**：模型与门户同机，后端走 `127.0.0.1` 即可；规避浏览器 CORS / 校园网白名单；
模型地址只写一处（便于日后改 IP/隧道）。

**修复：模型服务起不来的根因（重要）**
- 推理脚本 `inference_server_local.py` 默认 `PORT = int(os.environ.get("PORT", 8000))`，
  即默认监听 **8000**，与门户 `manchu-portal` 的 8000 **冲突** → 启动即
  `ERROR: [Errno 98] address already in use` 退出（日志中 CUDA 报错只是自动回落 CPU 的 WARNING，非致命）。
- 修复：**不改用户脚本**，在 systemd unit 注入 `Environment=PORT=7860`，对齐交接说明的 7860。
- 另：交接说明称 `manchu-detect.service` 已注册，实际本机**未注册**，已补建 unit 并 `enable --now`。

### 3.2 字体（需求 ③）

- 核验结论：用户指定的 `问题反馈2\001A-Buleku-R.ttf`（md5 `6b011d…`）与本页已内嵌的
  `static/fonts/annot/001A-Buleku-R.ttf` **字节一致** → 需求本就满足。
- 整站涉及**两个同名但内容不同的 `001A-Buleku-R.ttf`**：全局用 `3f1f78…`，本页专用 `6b011d…`
  （`@font-face` 定义独立字体名 `BulekuAnnot` 内嵌，不污染全局 `Buleku`）。仅 OCR 标注页用专用款，符合要求。
- 故**无需替换字体文件**，仅在此落定说明。

### 3.3 文本框加长 + 加文件名（借鉴 v8）

- **文本框加长**：`.wb-anno-input` 已是 `height:300px; font-size:30px`（doc 15 落地），竖排满文校对框足够长；本次复核确认，必要时再调。
- **加文件名（修了真 bug）**：在蓝图 `_decorate()` 补 `task["file"] = task.get("title")`
  （种子把原图文件名存入了 `title`）。此后模板顶栏 `#fileName`、框属性面板「文件名 · 第 N 列」、
  以及 `WB_TASKS` 里的 `file` 字段均能正确显示文件名。

---

## 4. 文件改动清单

**新增**
- `~/.config/systemd/user/manchu-detect.service`：检测服务常驻 unit（`WorkingDirectory`/`ExecStart` 指向 `~/manchu_detect`，`Environment=PORT=7860`，`Restart=always`）。

**修改**
- `modules/workbench/__init__.py`
  - 新增 `ocr_ai_detect` 路由（代理 7860、坐标换算、列优先排序、健壮错误处理：模型离线返回 502 JSON 而非 500）；
  - `_decorate()` 补 `file` 字段（修文件名不显示）；
  - 顶部新增 `import json, os, urllib` 与 `from flask import current_app`，以及 `DETECT_URL` 常量。
- `static/js/workbench.js`：`btnDetect` 由"显示预设框"改为"调用真实检测接口并渲染返回框"。
- `templates/workbench/ocr_annotate.html`：注入 `window.WB_AI_DETECT_URL`；信息横幅改为"AI 画框已接真实模型"；文件名经 `file` 字段显示。
- 文档：本文档 `17`；`README.md` 索引加 17；`15` 中"AI 画框未部署"的过期描述更正。

---

## 5. 验证（均已通过）

- `systemctl --user is-active manchu-detect` = `active`；`7860/health` 返回 `model_loaded=true`。
- **经门户真实 AI 画框**（test client + 真实 HTTP 多 worker 双验证）：
  - 任务 `T-2609-001` → `ok=true, count=37, inference_time_ms≈36`；
  - 坐标已为显示百分比、列优先排序正确（首框 `x≈14.7%` 最左、末框 `x≈81.6%` 最右，与 v8 左→右列序一致）。
- **模型离线时**路由返回 `502` + JSON 错误（页面弹提示，`不`触发 500）。
- **文件名**经 HTTP 实测显示（`ja042.jpg` 出现在页面与 `WB_TASKS`）。
- 三角色登录后 OCR 标注页均 `200`。

---

## 6. 已知约束 / 后续

- **模型目录间歇挂载**：本机 `/home/leyesi/manchu_detect` 位于网络/自动挂载盘，本会话中曾短暂不可见
  （`ls`/`python` 能访问、随即又 `No such file`）。确保该目录挂载后 `manchu-detect` 才能启动。
  若需更稳，可把模型/脚本/venv 迁到本地稳定目录，并改 unit 的 `WorkingDirectory`/`ExecStart`。
- **AI 预测（识别框内满文）仍为 mock**：识别服务（端口 1000）未接入；如需真实，按本模式加后端代理即可。
- 提交号仍为演示编号（`S-YYMMDD-NNN`）。

---

## 7. 复现步骤（给后续维护者）

```bash
# 1) 确保检测模型服务运行（端口 7860，非 8000）
systemctl --user status manchu-detect        # 应为 active
# 若未起：确认 ~/manchu_detect 已挂载，然后
systemctl --user restart manchu-detect
curl -s http://127.0.0.1:7860/health         # model_loaded: true

# 2) 重启门户加载新代码
systemctl --user restart manchu-portal

# 3) 浏览器：登录 zhang → 工作台 → 满文古籍 OCR 标注
#    → 选任务 → 点「🔍 AI 画框」→ 真实检测返回竖排列框 → 逐框校对满文 → 提交
```
