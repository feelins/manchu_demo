# 模块移植记录：满文古籍 OCR

> 源文件：`/home/leyesi/shaopf/服务器配置相关/平台框架/平台框架/01ocr/满文古籍OCR智能识别系统_竖版_批量版 汉字识别开关.html`
> 目标：`manchu_demo` 的 `/ocr/` 栏目（蓝图 `ocr`）
> 时间：2026-09-24　阶段：静态页面移植 + 换肤（后端代理未接）

---

## 1. 源文件性质判定：**不是纯静态页面**

单文件自包含应用（1009 行 / 40 KB），三部分构成：

| 部分 | 行数 | 性质 | 说明 |
|---|---|---|---|
| 内联 CSS | 8–490 | 静态 | 自带一整套配色（紫 / 蓝绿 / 红 / 深墨侧栏），与门户金+墨绿体系不一致 |
| HTML 结构 | 494–553、985–1007 | 静态 | 工具栏 + 左右分栏 + 两个弹层 |
| 内联 JS | 555–983 | 前端逻辑 | 上传、Canvas 旋转列缩略图、竖排列渲染、批量进度、导出 txt、分栏拖拽 |

### 唯一的后端动态调用

```
POST {server}/api/recognize
Content-Type: multipart/form-data
  image             : 图片文件
  model_type        : "standard" | "ancient"
  recognize_chinese : "1" | "0"

成功响应：
  { original_image, columns:[{column, text, type:"manju"|"chinese"}],
    column_thumbs:[dataURL...], layout_used }
失败响应：
  { error }
```

调用点共 **2 处**：单张识别 `doRecognize()`、批量处理 `startBatchProcess()`。

### 其它运行时依赖

| 依赖 | 说明 | 处理 |
|---|---|---|
| `localStorage` | `manjuOcrServerUrl` / `manjuOcrServerUrls`，记住服务器地址 | **已移除**，改为默认网关 `/api/ocr`；工具栏保留一个输入框仅供调试期临时覆盖 |
| `fonts/001A-Buleku-R.ttf` | 页面自带 `@font-face 'ManjuCustom'`（相对路径） | **已移除**，改用门户 `base.html` 里统一的 `Buleku` 字体（CSS 变量 `var(--manju)`） |
| 页面级 `height:100vh; overflow:hidden` | 全屏 App 布局 | **已改**为门户外壳内的定高工作区（`640px`，上限 `calc(100vh - 260px)`），保留页脚 |

---

## 2. 移植后的落点

| 文件 | 说明 |
|---|---|
| `modules/ocr/__init__.py` | 蓝图 `ocr_bp`，`url_prefix="/ocr"`，端点 `ocr.index` |
| `templates/ocr/index.html` | 页面模板，`{% extends "base.html" %}` |
| `static/css/ocr.css` | 模块样式，**全部走设计令牌** |
| `static/js/ocr.js` | 前端逻辑（由原内联 JS 抽出，保留全部功能） |
| `app.py` | 注册蓝图；`REAL_MODULES = {"ocr"}` 使其从占位路由列表移除；注入 `ocr_api` |

**接口地址收敛**：`http://localhost:1000/api/recognize` → `/api/ocr/recognize`
（默认值来自 `app.py` 的 `OCR_API_BASE`，可用环境变量 `OCR_API_BASE` 覆盖；前端 `getServerUrl()` 只拼 `/recognize`）

---

## 3. 换肤映射（原配色 → 门户设计令牌）

| 原样式 | 门户取值 |
|---|---|
| 紫色渐变按钮 `#a855f7→#7c3aed`（古籍识别） | `--gold` 金色渐变（`.btn-gold`） |
| 蓝紫渐变 `#667eea→#764ba2`（正楷识别） | `--gold` 金色渐变（`.btn-gold`） |
| 绿色 `#4CAF50`（上传） | `--ink-4→--ink-2` 墨蓝渐变（`.btn-primary`） |
| 青紫 `#30cfd0→#330867`（列图开关） | 中性白底按钮（`.btn`） |
| 红色 `#e74c3c`（识别汉字 / 汉字列） | `--green` 墨绿（`.btn-green`、`.chinese-column`、`.chinese-title`） |
| 黄橙 `#f6d365→#fda085`（导出） | 金色调描边（`.btn-outline`） |
| 侧栏深墨渐变 `#1a1a2e→#0f3460` | 保留为**原图区**底色（衬托古籍扫描件），边框改 `--gold-dim` |
| 分隔条 `#ddd` / hover `#2196F3` | `--paper` / hover 金色渐变 |
| 滚动条 `#c9a227→#d4af37` | `--gold→--gold-light`（原本就是金色，保留） |
| 批量进度条 `#4CAF50→#8BC34A` | `--green→--gold→--gold-light` |
| 弹层遮罩 `rgba(0,0,0,.6)` | `rgba(15,22,38,.55)`（`--ink` 系） |
| 占位图 `#FFD700` / `#CCCCCC` | `--gold-pale` / `--line` |
| 字体 `'ManjuCustom'` | `var(--manju)`（Buleku） |

**新增（原页面没有）**
- 空状态提示（`上传图片或批量处理` + 满文装饰字 `ᠪᡳᡨᡥᡝ`）
- 区块标题（沿用 `.section-head`）：`Manuscript OCR / 满文古籍 OCR`
- 左、右面板各加小标题（原图 / 识别结果）

---

## 4. 保留与原样迁移的行为

- 竖排列渲染：`writing-mode: vertical-lr` + 按列卡片
- 列缩略图 **Canvas 旋转 90°** 的逻辑（原样保留，这是原作者的关键处理）
- 满文/汉字字号下拉（汉字 16–24，满文 26–66，默认 46）
- 汉字列过滤逻辑（`recognizeChinese` 开关）
- 批量处理：模型选择弹层 → 逐张进度 → 汇总成功/失败
- 导出：单张导出 `ocr_result_<文件名>_<ts>.txt`，批量导出 `batch_ocr_result_<ts>.txt`
- 左右分栏拖拽（15%–80%）

---

## 5. 验证记录

```
GET /                      200
GET /ocr/                  200   （导航「古籍OCR」自动高亮 is-active）
GET /static/css/ocr.css    200
GET /static/js/ocr.js      200
GET /health                200
页面注入 window.OCR_API_DEFAULT = "/api/ocr"
```

⚠️ 当前点击识别会提示「连接识别服务失败」——**预期行为**，后端代理尚未接入。

---

## 6. 待办（下一步）

| # | 事项 | 说明 |
|---|---|---|
| 1 | 门户后端代理 `/api/ocr/recognize` | Flask 端转发到 `OCR_RECOGNIZE_URL`（本机 `ocr_deploy/server.py` 端口 8080 或工作站 1000），前端无需再改 |
| 2 | 版面/检测服务接入 | 原标注工具用的 `localhost:7860/detect`，OCR 页面暂未用到，后续按需加 `/api/ocr/detect` |
| 3 | 预生成示例 | 预置 3~5 张经典古籍图 + 识别结果，命中即秒回（演示保障第一层） |
| 4 | 推理过程面板 | 按 `load → layout → box-detect → column-split → char-recognize → manju-text` 输出 trace，接入统一 Trace 面板 |
| 5 | 字体 WOFF2 子集化 | 现用 TTF 原件，体积偏大 |
| 6 | 批量任务改异步 | 现为前端串行 `await`，张数多时页面长阻塞；改后端任务 + SSE 进度 |
