# 满语语音合成（TTS）模块移植记录

> 第 4 项功能移植完成记录
> 源资产：`平台框架/04语音合成/tts加了满文.html`（12 KB）
> 移植日期：2026-09-24
> 状态：**已完成并通过真实推理的端到端验证**（非 mock、非假数据）

---

## 1. 源资产与结论

| 项 | 内容 |
|---|---|
| 源文件 | `/home/leyesi/shaopf/服务器配置相关/平台框架/平台框架/04语音合成/tts加了满文.html` |
| 形态 | **Jinja2 模板**（内含 `{{ project_title }}`、`/static/style.css`、`/static/app.js`、`/static/fonts/001A-Buleku-R.ttf`），不是一个可直接双击打开的纯静态页 |
| 后端 | 同源的 TTS 推理服务（FastAPI，端口 7868） |
| 推理栈 | GPT-SoVITS v2Pro，`manchu_speaker` 单说话人 |
| 移植结论 | 页面拆成门户模板继承 + 独立 JS；后端**不直连**，统一走门户代理 `/api/tts/*` |

与 OCR（纯静态）、文字转换（纯前端规则）、翻译（服务在 Windows 未迁移）三块都不同，TTS 是**第一个"本机就能跑真实推理"的模块**，因此本次同时完成了服务联调。

---

## 2. 移植产物

| 文件 | 作用 |
|---|---|
| `modules/tts/__init__.py` | 蓝图：`GET /tts/` 渲染页面；`POST /api/tts/convert`、`POST /api/tts/synthesize`、`GET /api/tts/media/<file>`、`GET /api/tts/health` |
| `templates/tts/index.html` | 页面模板（`extends base.html`，填 `content` / `extra_css` / `extra_js`） |
| `static/js/tts.js` | 交互逻辑：文本转化、合成、音频播放、频谱展示、下载、日志 |
| `static/css/tts.css` | 模块样式（全部走 `design-token.css` 变量，无硬编码色值） |
| `scripts/services.sh` | OCR / TTS / 门户三个服务的统一启停（见第 6 节） |

复用：`static/js/manju-rules.js`（满文⇄拉丁公共规则库，与 `/translit/`、`/translate/` 同源）。

---

## 3. 页面 DOM 契约（前端 JS 依赖的 id）

改造页面时若动这些 id，必须同步改 `static/js/tts.js`：

| id | 用途 |
|---|---|
| `sourceText` | 拉丁满文输入框（唯一可编辑输入） |
| `sourceStats` | 字数统计 |
| `manchuScriptDisplay` | 左侧传统满文竖排实时预览（只读，由 `manju-rules.js` 转换） |
| `latinText` | 规范化后的拉丁读音序列（只读） |
| `cmuText` | CMUdict 音素序列（只读） |
| `btnConvert` / `btnSynthesize` | 文本转化 / 合成语音 |
| `btnDemo` / `btnClear` / `btnDownload` | 填入示例 / 清空 / 下载音频 |
| `resultArea` / `audioPlayer` / `audioUrl` / `specImage` | 结果区：播放器、音频链接、频谱图 |
| `svcBanner` / `svcDot` / `svcText` | 服务未连接提示与状态灯 |
| `logBox` | 每次请求的状态与耗时日志 |

---

## 4. 代理设计：本模块唯一的非平凡点

上游 TTS 服务返回的音频地址形如 `/generated/manchu_xxx.wav`，**这个路径挂在上游服务根下，门户并不拥有它**，前端直接拿去播会 404。

处理办法（两步）：

1. `synthesize` 的响应里，把 `audio_url` / `spectrogram_url` 改写成 `/api/tts/media/<文件名>`；
2. 门户提供 `/api/tts/media/<filename>` 回源取字节后转发给浏览器。

```python
def _rewrite_media_url(url):
    if not url:
        return url
    return "/api/tts/media/" + os.path.basename(url)   # 只留文件名，顺带防路径穿越
```

这样前端零改动即可播放与下载，后续 OCR / ASR 若有同类"产物回源"需求，直接复用这个模式。

**超时**：文本转化 30 秒；合成 600 秒（`TTS_TIMEOUT`，CPU 推理 + 首次加载模型都很慢）。

---

## 5. 上游服务契约（据 `manchu_TTS/app.py` 源码）

| 接口 | 请求 | 响应 |
|---|---|---|
| `GET /healthz` | — | `{"ok": true}` |
| `POST /api/convert` | `{"text"}` | `source_text` / `latin_text` / `cmudict_tokens` / `cmudict_text` |
| `POST /api/synthesize` | `{"text"}` | `audio_url` / `spectrogram_url` / `latin_text` / `cmudict_text` / `reference_audio` / `reference_text` |
| `GET /generated/<file>` | — | wav / 频谱 png 字节 |

模型与参考音频（固定单说话人，不可在页面上改）：

```
GPT_weights_v2Pro/manchu_speaker-e15.ckpt
SoVITS_weights_v2Pro/manchu_speaker_e8_s5928.pth
reference/00000016.wav  +  reference/00000016.txt
```

---

## 6. 服务编排：`scripts/services.sh`

三个服务**各自用不同的 conda 环境**，互不加载对方模型，门户只做渲染 + 代理：

| 服务 | 端口 | 解释器 |
|---|---|---|
| OCR 识别 | 8080 | `/home/leyesi/miniconda3/envs/manju_layout/bin/python` |
| TTS 合成 | 7868 | `/home/leyesi/miniconda3/envs/GPT/bin/python` |
| 门户 | 8000 | `manchu_demo/.venv/bin/python` |

```bash
./scripts/services.sh start|stop|restart|status
```

> ⚠️ **三个服务的进程名都是 `app.py`（或含 `app.py`）**，因此脚本里 PID 定位与 kill **一律按解释器绝对路径匹配**，切勿写 `pkill -f "python app.py"`——会误杀 TTS。

---

## 7. 端到端验证（真实推理，非 mock）

服务拉起后经门户代理连续跑通：

| 步骤 | 结果 |
|---|---|
| `GET /api/tts/health` | `{"portal":"ok","upstream_alive":true}` |
| `POST /api/tts/convert` | 返回规范化拉丁序列 + CMUdict 音素序列 |
| `POST /api/tts/synthesize` | 返回 `audio_url` / `spectrogram_url`（已改写为 `/api/tts/media/...`） |
| `GET /api/tts/media/<wav>` | 真实音频字节，**时长 2.26 秒**，24 kHz 单声道 |
| 频谱图 | PNG 正常返回并在页面渲染 |
| 页面 DOM | 上表 18 个 id 全部通过契约校验 |

---

## 8. 踩坑记录

| # | 现象 | 处理 |
|---|---|---|
| 1 | 服务看似"启动了"但 curl 不通 | 用 `ss -lntp | grep :端口` 确认端口归属，再 `pgrep -af` 看进程真实命令行，不要只看 `ps` 的截断输出 |
| 2 | 门户返回 000（连不上） | 门户必须在 `manchu_demo` 目录下、用绝对路径 `.venv/bin/python app.py` 启动；脚本里已用 `( cd "$PORTAL_DIR" && ... )` 固化 |
| 3 | 偶发 403，但服务端 access log 无记录 | 未能从代码层面复现定位：项目与上游服务源码中均无 403 分支，日志也无对应条目。当时的处理是先确认端口未被占用 → 重拉门户 → 恢复 200。**后续若再现，先抓 `ss -lntp` 看 8000 到底是谁在听** |
| 4 | uvicorn 访问日志缺失 | 上游用自定义 `--log-config` 覆盖了默认 access log，排查时不要依赖它的访问日志，改用 `/healthz` 探活 |
| 5 | 首帧合成极慢 | GPT-SoVITS 首次加载权重约 20~60 秒，`services.sh` 的 `wait_up` 最多等 120 秒；页面上也做了"首次加载较慢"的提示 |
| 6 | `services.sh status` 误报 TTS "未运行"（实际在跑，合成正常） | 进程 `argv[0]` 只是 `python`（无解释器路径），用 `pgrep -f "<绝对路径> app.py"` 匹配不到；已改为 `ss -lntp` **按监听端口反查 PID**（`pid_on_port`），门户同理 |

---

## 9. 待办 / 后续

- [ ] **参考音频可上传**：当前固定 `00000016.wav`，多说话人需前端上传 + 后端切换
- [ ] **合成进度反馈**：CPU 合成数十秒，建议改 SSE 推送阶段进度（与阶段 3「演示保障」一起做）
- [ ] **合成结果缓存**：同一文本重复合成直接命中缓存
- [ ] **长文本分段**：当前一次请求合成整段，长句建议按句切分后拼接
- [ ] **Windows 侧 TTS 服务收编**：Windows 机上另有一套 `D:\manchu_TTS`（conda `manchu_tts`），与本机副本的关系待明确，正式部署前需择一
- [ ] 音频产物定期清理（`generated/` 会持续增长）

---

## 10. 与前面几项的一致性

| 约定 | 本模块是否遵守 |
|---|---|
| 页面 `extends base.html`，样式走 design token | ✅ |
| 前端不出现 `localhost:端口`，只用 `/api/<module>/...` | ✅（7868 只出现在服务端配置） |
| 满文⇄拉丁规则全站一份 | ✅ 复用 `manju-rules.js` |
| 服务未就绪时页面可降级提示 | ✅ `svcBanner` 提示 + 状态灯 |
