# 0701 满文古籍 OCR 标注页 · 改造说明

> 建立：2026-09-30
> 对应问题：工作台 › 满文古籍 OCR 标注「页面不对」「任务应是整页图」「要用参考工具的布局与专用字体」
> 相关：[11-工作平台模块分析](./11-工作平台模块分析与规划.md)、
> [12-v0阶段工作总结](./12-v0阶段工作总结.md)、[14-翻译模型服务部署方案](./14-翻译模型服务部署方案.md)

---

## 1. 改了什么

| 项 | 改前 | 改后 |
|---|---|---|
| 中间区域 | 行切图 + 横向小框，不像标注工具 | 参照 v8 标注工具：**整页画布 + 竖排列框 + 框预览 + 竖排满文校对框** |
| 下发任务 | 行切图（`corpus/ocr_real/ja*.png`，253×48） | **整页古籍扫描图**（`corpus/ocr_page/ja042~047.png`） |
| 任务列表 | — | **保留**（用户明确要求：下发给标注员的待处理任务） |
| 满文字体 | 全局 `Buleku` | 本页**内嵌专用字体** `BulekuAnnot`（见 §3，关键） |
| AI 画框/预测 | 模拟 | 仍为模拟（真实权重已就位、服务未部署，见 §4） |

### 页面结构（参照 v8 工具，非原样照搬）

```
┌ 任务列表（保留） ┬ 整页画布 ┬ 竖排工具栏 + 框预览 + 满文校对 + 提交 ┐
│  6 个下发任务    │ 文件名条 │  🔍 AI 画框 / 🤖 AI 预测 / ➕ / 🗑️     │
│  整页缩略 + 状态 │ 缩放控制 │  框预览（按框坐标从原图裁剪）          │
│                  │ 整页图   │  校对框：竖排、BulekuAnnot、30px、加长 │
│                  │ 框层     │  置信度 / 状态 / 确认 / 进度 / 提交    │
```

交互：点框选中 → 右侧显示该框裁剪预览 + 文件名 + 列号 → 竖排文本框校对 → 确认 → 整体提交。
框按**竖排列从右向左**编号（满文书写方向），新加的框接在最左。

---

## 2. 整页任务图从哪来

- 原始整页扫描：`/data/manju_dataset/images/raw/`（209 张，**2144×3136**）
- 演示切片：`static/corpus/ocr_page/ja042~ja047.png`（缩放至宽 900，共 2.0 MB）
- 生成方式（需换图时重跑）：

```python
from PIL import Image
import os, glob
src, dst = '/data/manju_dataset/images/raw', 'static/corpus/ocr_page'
for f in sorted(glob.glob(os.path.join(src, '*.jpg')))[:6]:
    im = Image.open(f).convert('RGB')
    w, h = im.size
    im.resize((900, int(h * 900 / w)), Image.LANCZOS) \
      .save(os.path.join(dst, os.path.basename(f).replace('.jpg', '.png')))
```

任务数据在 `modules/workbench/mock.py` 的 `OCR_TASKS`，字段：
`id` / `file`（**文件名**，页面顶部显示）/ `image` / `size` / `page` / `status` / `boxes`。
框坐标是**相对整页的百分比**（竖排窄列：`w≈5.2%`、`h≈68%`）。

---

## 3. ⚠️ 两个同名的满文字体（必须区分）

站内存在**两个都叫 `001A-Buleku-R.ttf` 但内容不同**的字体（大小都是 156K，md5 不同）：

| md5 | 位置 | 用途 |
|---|---|---|
| `3f1f78af8c75…` | `static/fonts/001A-Buleku-R.ttf`（以及 `其他版块满文字体/`、`demo/fonts/`、`~/.local/share/fonts/`） | **其他版块**用（全局 `Buleku`） |
| `6b011df94dd5…` | `static/fonts/annot/001A-Buleku-R.ttf`（源自 `20260930-v1修改/问题反馈/问题反馈/`） | **只有 OCR 标注页**用 |
| `6b011df94dd5…` | `0701…/manju_annotation_tool_v8…专用字体/001A-Buleku-R.ttf` | 与上一行同一文件（v8 工具的专用字体） |

处理办法：标注页在 `{% block extra_css %}` 里**内嵌** `@font-face` 定义独立字体名
`BulekuAnnot`，只指向 `fonts/annot/` 那份；**不去动**全局 `Buleku`。
这样其他版块不受影响，标注页用对字体。

> 校验：`md5sum static/fonts/annot/001A-Buleku-R.ttf static/fonts/001A-Buleku-R.ttf`
> 应输出两个不同的 md5。

---

## 4. AI 画框 / AI 预测

| 项 | 状态 |
|---|---|
| v3 最佳权重 | `/data/manju_dataset/runs/detect/manju_detect/exp_0512_2006/weights/best.pt`（6.0 MB，**已在本机**） |
| 检测服务（v8 工具用 `localhost:7860`） | **未部署**（端口未监听） |
| 识别服务（v8 工具用 `127.0.0.1:1000`） | **未部署** |
| 「AI画框训练日志」文件夹 | **本机未找到**（可能仍在 Windows 工作站） |

当前页面上的「AI 画框 / AI 预测」是**模拟**（1 秒返回预置结果），页面顶部已如实标注。

**要接真实模型时**（参考 v8 工具的调用方式）：

1. 起检测服务（YOLO 权重 `best.pt`）监听 **7860**，接口返回框坐标
2. 起识别服务监听 **1000**，`POST /api/recognize`（字段 `image`，`model_type=ancient`，`skip_layout=1`）
3. 前端 `btnDetect` / `btnPredict` 改为请求门户代理（不要在页面直连端口，与翻译模块的做法一致）
4. 删掉页面顶部的"模拟"提示

---

## 5. 参考文件

| 用途 | 路径 |
|---|---|
| 参考用标注工具 HTML | `服务器配置相关/平台框架/平台框架/07工作平台（需登录，不对外）/0701满文古籍OCR数据标注/manju_annotation_tool_v8AI预测_修正收集版文本框加长加文件名.html` |
| 该工具的专用字体 | 同名目录下的 `… 专用字体/001A-Buleku-R.ttf` |
| 标注页专用字体（站内） | `static/fonts/annot/001A-Buleku-R.ttf` |

借鉴的是**布局与交互**（竖排标题栏、图片区 + 可拖动分隔、框预览、竖排满文输入、竖排工具栏），
样式按门户现有设计语言重做，未原样搬用。

---

## 6. 待办

| 项 | 说明 |
|---|---|
| 接真实检测/识别服务 | 7860 / 1000 起服务后改前端请求（§4） |
| 补齐「AI画框训练日志」 | 本机未找到，需从工作站拷贝 |
| 任务量扩充 | 现在只有 6 个演示任务，可按需从 raw 的 209 张里加 |
| 整页真框 | 现在框是 mock 百分比；接服务后应由检测模型给出 |
