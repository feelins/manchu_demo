# OCR 服务现状调研与联调记录

> 调研时间：2026-09-24　调研人：AI 协助　对象：`/home/leyesi/ocr_deploy/server.py` + `/manju_dataset`
> 结论一句话：**能跑通，但当前 8080 上跑的是「降级模式」，改一行配置即可恢复完整能力。**
>
> ✅ **2026-09-24 更新：已全部打通。** 门户 8000 `/ocr/` 页面 → `/api/ocr/recognize` 代理 → 8080
> 推理服务，端到端实测通过（3.4s/张，`layout_used=True`，满文输出正常）。详见第 9 节。

---

## 1. 结论速览

| 问题 | 答案 |
|---|---|
| OCR 功能能跑通吗？ | **能**。实测 `POST /api/recognize` 返回真实满文，见第 5 节 |
| 现在 8080 上的服务正常吗？ | ✅ **已修复**（原：版面分析未加载，`layout_used=False`，只出 1 列且内容错乱） |
| 是不是在这台电脑训练的？ | **是**。完整训练流水线都在本机 `/manju_dataset`，见第 3 节 |
| 能定位到模型吗？ | **能**。三个模型路径全部确认存在，见第 2 节 |
| 有测试图片吗？ | **有**，本机共 2000+ 张，见第 4 节 |

---

## 2. 模型清单（全部在本机，已验证存在）

### 2.1 版面分析（Mask R-CNN，决定「分成几列」）

| 项 | 路径 |
|---|---|
| 配置 | `/manju_dataset/mmdetection/configs/manju/mask_rcnn_r50_fpn_manju_800_v6.py` |
| 权重 | `/manju_dataset/mmdetection/work_dirs/mask_rcnn_r50_fpn_manju_800_v8/best_coco_segm_mAP_epoch_30.pth` |
| 大小 / 时间 | 188 MB，训练于 2026-06-30 00:12 |
| 副本 | `/home/leyesi/ocr_deploy/model_v8.pth`（同名 188 MB，应是部署拷贝） |

同目录还有迭代版本（说明训练在此地多轮进行）：
`v1_backup / v2 / v3 / v6 / v8`，其中 v8 有 `epoch_50/55/60.pth` 与 `last_checkpoint`。

### 2.2 文字识别（SVTR，决定「每列是什么字」）

| 模型 | 目录 | 说明 |
|---|---|---|
| 正楷 `standard` | `/home/leyesi/ocr_deploy/svtr_base_manju/` | `inference.json` + `inference.pdiparams`(30 MB) + 字典 |
| 古籍 `ancient` | `/home/leyesi/ocr_deploy/svtr_finetune_manju_v6/` | 同上，2026-06-09 更新 |
| 备用 | `svtr_finetune_manju_v2_1024/`（1024 宽度） | 当前服务未启用 |
| 训练中间产物 | `manju_10fonts_final_v3/latest.pdparams`（16 MB） | 10 字体合成数据微调 |

- 字典：`manju_dict_from_data_fixed.txt`，**41 个有效字符**（+blank = 42 类），两个模型一致
- 中文 OCR：PaddleOCR（`lang='ch'`，`use_gpu=False`），负责汉字列

---

## 3. 训练痕迹：**确认在本机训练**

`/manju_dataset` 属主 `leyesi`，内含完整训练流水线，不是拷贝来的推理环境：

```
/manju_dataset/
├── labelme2coco.py / fix_labelme2coco.py      # 标注转换
├── fix_empty_annotations.py / fix_manchu_bottom.py / check_new_labels.py
├── split_dataset_800.py / merge_and_split_v6.py / merge_and_split_v8.py   # 数据集切分
├── preannotate.py                              # 预标注
├── instances_train.json / instances_val.json   # COCO 标注
├── images/ images_800/ images_new/ images_02/  # 原始与切分图
├── images.rar (590 MB) / images02.zip (508 MB) # 原始数据归档
├── split_800/ split_all/ split_v8/             # train/val/test 切分
├── torch_install.log                           # 环境安装日志
└── mmdetection/                                # 训练框架 + work_dirs（v1→v8）
```

训练时间线（按文件 mtime）：5-21 起步 → 6-03 (v1/v2/v3) → 6-18/19 (v6) → 6-29/30 (v8)，
与 `ocr_deploy` 里模型文件的日期完全对应。

⚠️ **但 GPU 现在不可用**：
```
$ nvidia-smi
NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver.
```
训练时的 GPU 当前处于驱动失效状态（未重启/驱动掉线/硬件变更），这正是版面分析加载失败的直接原因。

---

## 4. 测试图片（可直接用于演示/回归）

| 目录 | 数量 | 说明 |
|---|---|---|
| `/manju_dataset/split_v8/test/` | **351 张** | 推荐。如 `asj212a.jpg`（2675×1876） |
| `/manju_dataset/images_800/` | 1622 张（含同名 `.json` 标注） | 800 尺度，`ja001.jpg`（3136×2144） |
| `/manju_dataset/images_new/` | — | 如 `asj001d.jpg`（2711×1932） |
| `/manju_dataset/split_all/test`、`split_800/test` | — | 早期切分 |
| `/manju_dataset/mmdetection/demo/demo.jpg` | 1 张 | mmdet 自带演示图（非满文） |

**推荐演示样例**（已实测可用）：`/manju_dataset/split_v8/test/asj212a.jpg`

已从中抽取 6 张存入仓库，见 **[`samples/ocr/`](./samples/ocr/README.md)**（含实测结果表）：
`asj212a / asj214b / ja003 / ja008 / nz003d / nz004a`，覆盖三个来源类别，均识别正常。

---

## 5. 实测记录

### 5.1 当前 8080 服务（降级状态）

进程：`python server.py --host 0.0.0.0 --port 8080`（pid 91550，已运行 2 天 21 小时，日志 `/tmp/ocr_server.log`）

```
POST /api/recognize  model_type=ancient
→ 耗时 0.3s  列数=1  layout_used=False
  第1列 [manchu]: 'ᠪᠠᡝ '
```
异常：整图当一个框，输出几乎无意义。

日志中的根因：
```
[INFO] 版面分析模块加载成功
[LayoutAnalyzer] 加载模型...
  设备: cuda:0
[ERROR] 版面分析模型初始化失败: No CUDA GPUs are available
```

### 5.2 CPU 版验证（临时副本，端口 8090，已清理）

做法：`sed 's/device="cuda:0"/device="cpu"/' server.py > server_cpu_test.py`，在 `ocr_deploy` 目录内启动。

```
[INFO] 版面分析模型(v7)初始化完成
[INFO] 中文OCR (PaddleOCR) 初始化完成
[INFO] [standard] 维度已对齐: 42 = 42
[INFO] [ancient]  维度已对齐: 42 = 42
```

识别结果（同一张 `asj212a.jpg`，`model_type=ancient`）：

```
耗时 3.4s   列数 8（5 满文 + 3 汉字）  layout_used=True   缩略图 10 张
第1列 [manchu]: 'ᠪᡝᠯᡥᡝᡥᡝᠪᡳ  ᠈ ᡝᡵᡝᠨᡳ  ᡩᠣᠪᠣᠮᡝ ᡝᡵᡝᠨᡳ ᠵᡠᡴᡨᡝᠮᡝ᠈ ᠠᠮᠪᠠ'
第2列 [manchu]: 'ᠪᡨᡠᡵᡳ ᠪᡝ ᠠᠯᡳᠮᠪᡳ ᠉ ᡵᡝ '
第3列 [manchu]: 'ᡨᡝᡵᡝ᠈ ᠵᡳᡴ ᠰᡝᡵᡝ ᠪᡠᠯᠠ ᠯᠠᠰᠠᡵᡳ ᠮᠣᡠᡈ ᡤᡳᡝᡵᡠᠨ '
第4列 [manchu]: 'ᡳᡵᡤᡝᠨ \u202fᡳ  ᡩᡝᡳᠵᡳᡵᡝᠩᡤᡝ᠈ ᡥᡡᠸᠠᠯᡳᠶᠠᠰᡠᠨ ᠨᡝᠴᡳᠨ  ᠠᠮᠪᠠᠰᠠ ᠰᠠᡳᠰᠠ᠈'
第5列 [manchu]: 'ᡤᡝᡵᡝᠨ ᡝᠨᡩᡠᡵᡳ  \u202fᡳ ᡤᠣᠰᡳᡵᡠᠩᡤᡝ ᠉ '
```

**结论：模型本身完好，识别质量正常，CPU 推理 3.4s/张，完全可用于演示。**

---

## 6. 问题与修复方案（✅ 2026-09-24 均已修复）

### 问题 1（阻塞）：版面分析硬编码 CUDA

`server.py` 第 73 行：
```python
device="cuda:0",
```
GPU 不可用时直接抛异常 → `layout_analyzer = None` → 所有请求降级为「单框直送」。

**修复**（改成自动检测，GPU 恢复后仍优先用 GPU）：
```python
import torch
DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
...
device=DEVICE,
```

### 问题 2（小）：关闭汉字识别时仍返回空的汉字列

`recognize_chinese=0` 时返回里仍带 `type:"chinese"` 且 `text:""` 的列，前端会渲染出空列。
建议在 `server.py` 组装 `results` 时按开关过滤，或前端忽略空文本列。

### 问题 3：服务用 `--port 8080` 硬启动，无守护/自愈

现为前台 nohup 进程（pid 91550），重启机器即失效。后续应纳入统一启动脚本 / systemd。

---

## 7. 运行命令备忘

> 日常启停推荐直接用 `./scripts/services.sh start|stop|restart|status`（见 9.5）。
> 下面是手动方式，仅调试时需要。

```bash
# 环境（唯一装有 paddle + mmdet + flask 的环境）
PY=/home/leyesi/miniconda3/envs/manju_layout/bin/python
# paddle 3.3.1 / mmdet 3.0.0 / mmcv 2.0.1 / flask 3.1.3 / cv2 4.11.0 / torch 2.0.1+cu118

cd /home/leyesi/ocr_deploy
$PY server.py --host 0.0.0.0 --port 8080

# 健康检查
curl -X POST -F "image=@/manju_dataset/split_v8/test/asj212a.jpg" \
     -F "model_type=ancient" -F "recognize_chinese=0" \
     http://127.0.0.1:8080/api/recognize
```

⚠️ 其它 conda 环境（`manju_ocr`、`paddle`、`manchu_ocr_env` 等）依赖都不完整，
`manju_layout` 是**唯一**能跑通完整链路的。

---

## 9. 打通记录（2026-09-24 完成）

### 9.1 调用链

```
浏览器
  └─ 门户 8000  /ocr/                  渲染页面（templates/ocr/index.html + static/js/ocr.js）
  └─ 门户 8000  POST /api/ocr/recognize  ← 新增反向代理（modules/ocr/__init__.py）
       └─ OCR 服务 8080 /api/recognize    ← 真实推理（paddle SVTR + mmdet 版面分析）
```

前端统一用相对路径 `/api/ocr`，**不再硬编码 `localhost:8080`**，
避免了从其它机器访问门户时 `localhost` 指向访问者自己导致失败的问题。

### 9.2 改动清单

| 文件 | 改动 |
|---|---|
| `/home/leyesi/ocr_deploy/server.py` | 版面分析设备由硬编码 `cuda:0` 改为自动检测（有 GPU 用 cuda，否则 cpu）。已备份 `server.py.bak_20260924` |
| `modules/ocr/__init__.py` | 新增 `ocr_api_bp`（前缀 `/api/ocr`）：`/recognize` 透传代理 + `/health` 上游探活；未开启汉字识别时剔除空汉字列 |
| `app.py` | 注册 `ocr_api_bp`（接口蓝图与页面蓝图分离，避免被 `/ocr` 前缀污染） |
| `scripts/services.sh` | 一键 start / stop / restart / status |

### 9.3 端到端实测

```
GET  /api/ocr/health
→ {"portal":"ok","upstream":"http://127.0.0.1:8080","upstream_alive":true}

POST /api/ocr/recognize  (split_v8/test/asj212a.jpg, model_type=ancient, 汉字关)
→ 耗时 3.3s  列数 5  缩略图 5  layout_used=True  类型 {manchu}
  第1列 'ᠪᡝᠯᡥᡝᡥᡝᠪᡳ  ᠈ ᡝᡵᡝᠨᡳ  ᡩᠣᠪᠣᠮᡝ ᡝᡵᡝᠨᡳ ᠵᡠᡴᡨᡝᠮᡝ'

POST /api/ocr/recognize  (同上, 汉字开)
→ 耗时 3.4s  列数 10  类型 {manchu, chinese}
```

### 9.4 踩坑记录

1. **蓝图前缀污染**：接口路由最初写在 `url_prefix="/ocr"` 的蓝图里，
   实际路径变成 `/ocr/api/ocr/recognize`，前端 `/api/ocr` 404。
   → 拆成两个蓝图：`ocr_bp`（`/ocr`）与 `ocr_api_bp`（`/api/ocr`）。
2. **werkzeug 流只能读一次**：先访问 `request.form` 再 `request.get_data()` 会拿到空 body，
   透传到上游报 400（缺少 image）。
   → 必须先 `get_data()`（werkzeug 会缓存），再读 `request.form`。
3. **空汉字列**：后端在 `recognize_chinese=0` 时仍返回 `type:"chinese"` 且 `text:""` 的列，
   导致「共 N 列」虚高。→ 在代理层按索引同步剔除 columns 与 column_thumbs。

### 9.5 启停

```bash
cd /home/leyesi/shaopf/manchu_demo
./scripts/services.sh start     # 先起 8080，再起 8000
./scripts/services.sh status    # 查看存活 + 代理健康检查
./scripts/services.sh stop
./scripts/services.sh restart
```

OCR 服务加载模型约需 60~90 秒，脚本会轮询等待。
上游地址可用环境变量覆盖：`OCR_UPSTREAM=http://192.168.x.x:8080`。

---

## 10. 后续待办

| # | 事项 | 状态 |
|---|---|---|
| 1 | 修复 `device` 硬编码 → 重启 8080，确认 `layout_used=True` | ✅ 完成 |
| 2 | 门户新增 `/api/ocr/recognize` 代理，转发到 8080 | ✅ 完成 |
| 3 | 测试图样例已归档至 `docs/samples/ocr/`；若要演示秒回，可再预生成识别结果缓存 | ✅ 样例已归档 |
| 4 | 确认 GPU 驱动状态；恢复后自动切回 CUDA 提速（代码已支持自动检测） | 待办 |
| 5 | 两个服务纳入 systemd / supervisor，开机自启与崩溃自愈 | 待办 |
