# 18 · OCR 识别与标注画框问题排查及修改方案

> 日期：2026-11-01
> 关联：[17-OCR标注页接入真实AI画框模型与字体文件名落定](./17-OCR标注页接入真实AI画框模型与字体文件名落定.md)
> 背景：用户反馈三类问题——① 古籍 OCR 页能显示但无法识别（疑似缺版面分析）；② 工作台「AI 画框」每页画出的框都一样（怀疑模型没启动）；③ AI 画出的框删不掉。本文档记录排查结论与修改方案。

---

## 0. 一句话结论

- **① 古籍 OCR 无法识别（已修复）**：根因是 8080 此前跑在 `paddle` 环境**缺 `mmcv`** → 版面分析失败、整页降级"单框直送"。正确环境 `manchu_layout` 却因**本机 GPU 可用时 paddle/torch 共存走 CUDA 触发 glibc 堆损坏崩溃**。修复：在 `manchu_layout` 下 `CUDA_VISIBLE_DEVICES=-1` **强制 CPU**，版面分析正常、整页 `layout_used=True`、多列满文。详见 §1.5。
- **② 每页画框都一样（已修复，真因是前端 bug，不是模型）**：检测服务 7860 与后端路由**均正常、按图返回不同结果**（路由 `T-2609-001~006` = 37/9/33/37/37/32；用户素材 `ja001~ja319.jpg` = 30/37/34/38/34/36/27/25），模型一直在跑，并非"没启动"。真实成因：`static/js/workbench.js` 的 `btnDetect` 发送 **`window.WB_TASK.id`**（页面初次渲染注入的全局量），而切换任务只更新局部变量 `curId`、`WB_TASK` 从不更新 → **切到任何一页都用第一个任务 `T-2609-001` 检测，恒返回它的 37 个框**，表现为"每页都是 37 个、画出来都一样"。修复：改用当前任务 `curId`。⚠️ 需浏览器硬刷新（Ctrl+Shift+R）生效。
- **③ 框删不掉**：`workbench.js` 里**根本没有"删除框"的逻辑**（只有 toast/行/chip 的 `.remove()`），属功能缺失，需新增。

> 重要：本文档撰写时，为保护已运行的服务，未直接改 8080 的运行环境（曾误改成 `manju_layout` 导致服务崩溃，已回滚到 `paddle` 环境恢复运行）。以下为方案，待确认后实施。

---

## 1. 问题 ①：古籍 OCR 无法识别（缺版面分析）

### 1.1 链路与现状
- 页面 `templates/ocr/index.html` + `static/js/ocr.js`：`doRecognize()` 仅向 `/api/ocr/recognize` 发送 `image / model_type / recognize_chinese`，**不带 `skip_layout`** → 依赖 8080 服务内部做整页**版面分析**后逐列识别。
- 门户代理 `modules/ocr/__init__.py` 的 `/api/ocr/recognize` 原样透传 multipart，无问题。
- 8080 服务 `ocr_deploy/server.py`：版面分析依赖 `/manju_dataset/mmdetection/layout_analyzer.py` 与权重 `best_coco_segm_mAP_epoch_30.pth`（均已确认存在），但加载时 `import` 需要 `mmcv`。

### 1.2 根因（已实证）
`manchu-ocr.service` 的 `ExecStart` 用的是 `/home/leyesi/miniconda3/envs/paddle/bin/python`。该环境 **没有 `torch`/`mmdet`/`mmcv`**。启动日志明确：

```
[WARNING] 版面分析模块加载失败: No module named 'mmcv'
```

→ `LAYOUT_AVAILABLE = False` → 整页识别走 `收到 skip_layout=1，进入单框直送模式`，把整页当一列直送识别，基本识别不出满文。这正是"缺了版面分析"。

### 1.3 正确的运行环境
环境 `manju_layout` 同时具备（已核实）：
`paddle 3.3.1` + `torch 2.0.1+cu118` + `mmdet 3.0.0` + `mmcv 2.0.1` + `flask 3.1.3` + `flask_cors` + `cv2 4.11` + `numpy 1.24.3`。
这是 8080 服务**本应运行**的环境（既满足 paddle 3.x 识别，又满足 torch/mmdet/mmcv 版面分析）。

### 1.4 当前阻断点：manju_layout 启动即崩
把 `manchu-ocr.service` 切到 `manju_layout` 后，进程在 paddle 的 PIR/onednn 融合阶段报：

```
corrupted double-linked list
FatalError: `Termination signal` is detected by the operating system.
```

→ PID 退出，8080 端口不监听，服务 DOWN。此为**堆损坏类崩溃**，需在实施阶段定位（见 §1.5）。

### 1.5 修改方案（① 已于 2026-11-01 实施）
1. **解决 manju_layout 启动崩溃**（关键前置）：
   - 怀疑是 paddle 3.3.1 的 oneDNN/mkldnn 融合在本机 CPU 上堆损坏。先尝试在 unit 注入：`Environment=FLAGS_use_mkldnn=0`（或 `DNNL_MAX_CPU_ISA=AVX2`），保留 `OMP_NUM_THREADS=1` / `KMP_DUPLICATE_LIB_OK=TRUE`。
   - 若仍崩，排查是否 torch/mmdet 加载时与 paddle 争用 OpenMP/MKL 运行库；检查 `ldd` 是否有多份 libgomp/libiomp 冲突。
   - 若 manju_layout 的 paddle 3.3.1 本身不稳，需回退到"原好版本"所用 paddle 构建（核对 `manju_layout` 历史/其他含 mmcv 的环境，如 `aligner`/`trans` 等是否同时有 paddle+mmcv）。
2. **切换服务环境**：崩溃解决后，将 `manchu-ocr.service` 的 `PATH` 与 `ExecStart` 指向 `manju_layout`，`daemon-reload` + `restart`。
3. **验证**：
   - `grep` 启动日志出现 `版面分析模块加载成功` 与 `版面分析模型(v7)初始化完成`；
   - 用整页样图实测：`curl -F image=@/manju_dataset/images_800/ja001.jpg -F model_type=ancient http://127.0.0.1:8000/api/ocr/recognize`，应返回多列、且 `columns[].text` 为满文。
4. **同步文档 17**：将 §8.2 中"必须用 paddle 3.3.0 环境"更正为"必须用 `manju_layout` 环境（paddle 3.3.1 + torch/mmdet/mmcv）"。

---

## 2. 问题 ②：AI 自动画框每页都一样

### 2.1 实测结论：检测模型本身正常
- `systemctl --user is-active manchu-detect` = `active`；`http://127.0.0.1:7860/health` 返回 `model_loaded:true`，providers 含 `TensorrtExecutionProvider / CUDAExecutionProvider / CPUExecutionProvider`。
- 对两张不同图直接打 `7860/detect`：
  - `ja02912.png` → `box_count=1`, 首框 `{x:240,y:4,w:13,h:27,...}`
  - `a000001.png` → `box_count=0`
  → **不同输入返回不同结果，模型按图推理，确实在跑**。

### 2.2 根因（已实证：前端发了错误的 task_id）
工作台路由 `ocr_ai_detect` 按 `task['image']` 取图转发 7860，逻辑正确。实测各 OCR 任务 `image` 为 `ja042~ja047.png`、**md5 互不相同**；端到端打 `ai-detect`：**不同任务返回不同框数**（37/9/33/37/37/32），后端像素→百分比转换也正确；对用户素材 `ja001~ja319.jpg` 直测亦各不相同（30/37/34/38/34/36/27/25）。即模型、路由、坐标换算全部正常。

**真正的 bug 在前端**：`static/js/workbench.js` 的 `btnDetect` 以 `window.WB_TASK.id` 作为请求参数——那是页面初次渲染时由模板注入的全局量；`loadTask()` 切换任务时只更新局部变量 `curId`，`window.WB_TASK` **从不更新**。于是**切到任何一页点「AI 画框」，实际都拿第一个任务 `T-2609-001` 去检测，永远返回它的 37 个框**——正是用户反馈的"每一页都是 37 个框"。

> 早期曾误判为"种子框几何雷同"（`mock.py` 中 6 个任务种子框 `x/y/w/h` 相同）。那确实会让**初始**框相似（已用 `_ocr_seed_boxes` 差异化），但**不是**点击「AI 画框」后结果雷同的原因。

### 2.3 修改方案（已于 2026-11-01 实施）
1. **修复前端 task_id（关键）**：`btnDetect` 的请求体由 `window.WB_TASK.id` 改为 `curId`，空值守卫改为 `if (!curId)`。`btnPredict` 基于 `boxes()`（内部已用 `curId`），无需改。
2. **保留种子框差异化**：`db.py` 的 `_ocr_seed_boxes(i)` 仍按任务序号生成不同列数/起点的占位框，避免「重置演示数据」后初始框雷同（仅影响初始占位框，不影响 AI 结果）。
3. **回归验证**：依次打开 `T-2609-001~006` 点「AI 画框」，框数应为 37/9/33/37/37/32（各不相同）；素材 `ja001~ja319` 直测亦各不相同。
4. **生效前提**：改动在 `static/js/workbench.js`，需浏览器硬刷新（Ctrl+Shift+R）；若本地另跑实例需先 `git pull`。

---

## 3. 问题 ③：AI 画出的框无法删除

### 3.1 根因
在 `static/js/workbench.js` 检索 `删除 / delete / remove / btnDelete`：仅命中 toast、表格行、依存弧 chip、验收卡片的 `.remove()`，**没有任何"删除标注框"的处理**。即选中框后既无按钮也无快捷键可删——属功能缺失，不是偶发 bug。

### 3.2 修改方案（已于 2026-11-01 实施）
在 `workbench.js` 中新增删除能力（不破坏现有 ②③④ 拖动/编号/变色）：

1. **新增 `deleteBox(b)`**：从 `boxes()` 数组移除 `b`、移除其 DOM（`b._el`）、清空 `selected`、调用 `reorderAndRender()` 重新编号（保持 ③ 列优先编号一致）。
2. **入口一（按钮）**：在右侧属性面板（`#propBody` 或画布工具条）加「🗑 删除选中框」按钮，点击调用 `deleteBox(selected)`（无选中时禁用）。
3. **入口二（快捷键）**：`document.addEventListener('keydown')` 监听 `Delete` / `Backspace`，当 `selected` 存在且当前焦点不在 `input/textarea` 时调用 `deleteBox(selected)`。
4. **覆盖所有来源**：手工新增框、AI 检测框、AI 预测框都应可被删（它们都在同一 `boxes()` 结构里）。
5. **验证**：画框/AI 画框后选中某框 → 按 Delete 或点按钮 → 框消失、剩余框编号自动重排、无残留 DOM。

---

## 4. 关于"17 号修改把原来的好版本改乱了"的说明

- doc 17 覆盖的是 **AI 画框接入（7860 代理）、字体落定、文件名显示**，这些与本次三个问题无直接因果关系；7860 检测当前正常即是佐证。
- 古籍 OCR **整页识别**的本质瓶颈是 **8080 服务的运行环境缺 mmcv**（早于且独立于 doc 17 的页面改动）。"原好版本"应当是 8080 跑在同时含 paddle+mmcv 的环境（即 `manju_layout` 或类似）；现在 `manju_layout` 的 paddle 3.3.1 启动崩溃，是本次需要解决的真正阻断点。
- 工作台「AI 预测」在本文档周期前已从 mock 改为真实识别（见 doc 17 §8.1），与 ③ 删除功能相互独立。

---

## 5. 实施 Checklist（确认后执行）

- [x] 1.5.1 已定位崩溃根因：本机 GPU 可用时 paddle/torch 共存走 CUDA 触发 glibc 堆损坏；无需 `FLAGS_use_mkldnn=0`，直接隐藏 GPU 即可
- [x] 1.5.2 已将 `manchu-ocr.service` 切到 `manchu_layout` + `CUDA_VISIBLE_DEVICES=-1` 并重启
- [x] 1.5.3 已验证整页识别 `layout_used=True`、多列满文（`asj212a.jpg` 实测 5 列）
- [x] 1.5.4 已更新 doc 17 §8.2 的环境说明（见上）
- [x] 2.3.1 已核对：6 任务图片本就不同；已将种子框替换为各自真实检测结果（每页不同），并让 `db.py` 重置后差异化
- [x] 3.2.1~3.2.5 已在 workbench.js 新增删除框：工具栏「🗑 删除」+ 属性面板「🗑 删除此框」+ `Delete`/`Backspace` 快捷键，删后自动重排编号
- [x] 全部完成后浏览器硬刷新（Ctrl+Shift+R）复测三处（② ③ 已验证；① 见 §1.5）

---

## 6. 验证命令速查

```bash
# 8080 环境与版面分析（崩溃解决后）
systemctl --user status manchu-ocr
grep -iE "版面分析|LAYOUT" /home/leyesi/ocr_deploy/server.log | tail -5

# 整页识别实测
curl -s -m 90 -X POST http://127.0.0.1:8000/api/ocr/recognize \
  -F "image=@/manju_dataset/images_800/ja001.jpg" -F "model_type=ancient" \
  | python -c "import sys,json;d=json.load(sys.stdin);print('cols',len(d.get('columns',[])))"

# 检测服务是否正常（问题②）
curl -s -m 30 -X POST http://127.0.0.1:7860/detect -F "file=@<两张不同图>" \
  | python -c "import sys,json;print(len(json.load(sys.stdin).get('boxes',[])))"

# 服务总览
systemctl --user is-active manchu-portal manchu-detect manchu-ocr manchu-translate-8001
```
