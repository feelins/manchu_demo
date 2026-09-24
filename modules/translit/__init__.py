"""传统满文 ⇄ 拉丁满文双向转换（蓝图）

形态说明（与 OCR 模块不同）：
本模块是**纯前端实现** —— 转换规则表、docx 解析（zip 解码）
与 docx 生成全部在浏览器端完成，**不依赖任何后端推理服务**。

调研结论（2026-09-24，详见 docs/07-文字转换模块移植记录.md）：
- 本机不存在专门的满文⇄拉丁转换服务
- TTS 服务的 /api/convert 只做「文本规范化 + 音素预测」，不是双向互转规则引擎，
  无法替代本模块
→ 因此移植为纯静态页，无代理路由，也无额外服务需启动。

后续若要把规则迁移到服务端（便于批处理接口化），
可在此蓝图内新增 /api/translit/convert，前端复用同一套规则表即可。
"""

from flask import Blueprint, render_template

translit_bp = Blueprint("translit", __name__, url_prefix="/translit")


@translit_bp.route("/")
def index():
    return render_template("translit/index.html")
