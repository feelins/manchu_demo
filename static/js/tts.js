/* ============================================================
   满语语音合成 TTS · 业务逻辑

   源：`04语音合成/tts加了满文.html` + manchu_TTS/static/app.js
   上游服务：`/home/leyesi/shaopf/manchu_TTS/app.py`（FastAPI :7868）

   移植要点（详见 docs/09-满语语音合成模块移植记录.md）：
   1. 传统满文竖排改为调用 manju-rules.js —— 源页面内联了第三份规则拷贝
   2. API 走门户代理 /api/tts/*，不再同源 /api/*（门户不知道上游的路由）
   3. 合成较慢（CPU 推理，首次还要加载模型），因此加了按钮禁用与耗时统计
   4. 结果区改用「合成成功后才显示」，避免源页面 hidden 类的闪烁

   依赖：js/manju-rules.js（必须先加载）
   ============================================================ */
(function () {
    const API = '/api/tts';

    const el = {
        source: document.getElementById('sourceText'),
        sourceStats: document.getElementById('sourceStats'),
        manchu: document.getElementById('manchuScriptDisplay'),
        latin: document.getElementById('latinText'),
        cmu: document.getElementById('cmuText'),
        btnConvert: document.getElementById('btnConvert'),
        btnSynthesize: document.getElementById('btnSynthesize'),
        btnDemo: document.getElementById('btnDemo'),
        resultArea: document.getElementById('resultArea'),
        audioUrl: document.getElementById('audioUrl'),
        audioPlayer: document.getElementById('audioPlayer'),
        specImage: document.getElementById('specImage'),
        logBox: document.getElementById('logBox'),
        svcDot: document.getElementById('svcDot'),
        svcText: document.getElementById('svcText'),
        svcBanner: document.getElementById('svcBanner'),
    };

    function now() { return new Date().toLocaleTimeString(); }
    function log(msg) {
        el.logBox.textContent += '[' + now() + '] ' + msg + '\n';
        el.logBox.scrollTop = el.logBox.scrollHeight;
    }
    function toast(msg) { log(msg); }

    // ==================== 传统满文实时预览 ====================
    function updateManchuScript() {
        const val = el.source.value || '';
        el.manchu.value = val.trim() ? window.ManjuRules.latin2manju(val) : '';
        el.sourceStats.textContent = val.length + ' 字符';
    }

    // ==================== 与上游通信 ====================
    async function postJson(path, payload, timeoutMs) {
        const ctrl = new AbortController();
        const timer = timeoutMs ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
        try {
            const res = await fetch(API + path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: ctrl.signal,
            });
            const data = await res.json().catch(function () { return {}; });
            if (!res.ok) {
                throw new Error([data.error, data.detail].filter(Boolean).join('｜') ||
                    ('HTTP ' + res.status));
            }
            return data;
        } catch (err) {
            if (err.name === 'AbortError') throw new Error('请求超时（合成可能仍在进行）');
            throw err;
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function setBusy(btn, busy, label) {
        btn.disabled = busy;
        btn.classList.toggle('busy', busy);
        if (label) btn.dataset.label = btn.textContent;
        btn.textContent = busy ? label : (btn.dataset.label || btn.textContent);
    }

    function fillResults(data) {
        el.latin.value = data.latin_text || '';
        el.cmu.value = data.cmudict_text || '';
    }

    // ==================== 文本转化 ====================
    el.btnConvert.addEventListener('click', async function () {
        const text = el.source.value.trim();
        if (!text) { toast('请输入文本后再转化'); return; }
        setBusy(el.btnConvert, true, '转化中…');
        log('正在转化文本（原文 → 拉丁规范化 → CMUdict）…');
        try {
            const data = await postJson('/convert', { text: text }, 30000);
            fillResults(data);
            log('转化完成');
        } catch (err) {
            log('转化失败：' + err.message);
        } finally {
            setBusy(el.btnConvert, false, '');
        }
    });

    // ==================== 语音合成 ====================
    el.btnSynthesize.addEventListener('click', async function () {
        const text = el.source.value.trim();
        if (!text) { toast('请输入文本后再合成'); return; }
        setBusy(el.btnSynthesize, true, '合成中…');
        el.btnConvert.disabled = true;
        const t0 = Date.now();
        log('正在合成语音，CPU 推理请稍候（首次需加载模型）…');
        try {
            const data = await postJson('/synthesize', { text: text });
            fillResults(data);

            const audioPath = data.audio_url || '';
            el.audioUrl.href = audioPath;
            el.audioUrl.textContent = location.origin + audioPath;
            el.audioPlayer.src = audioPath;
            el.specImage.src = data.spectrogram_url || '';
            el.resultArea.hidden = false;

            log('合成完成，耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒');
        } catch (err) {
            el.resultArea.hidden = true;
            log('合成失败：' + err.message);
        } finally {
            setBusy(el.btnSynthesize, false, '');
            el.btnConvert.disabled = false;
        }
    });

    // ==================== 示例 / 清空 ====================
    const DEMO = 'si yabade tiyehebi yaba bu sin bou yabade bi ai tokso';
    if (el.btnDemo) {
        el.btnDemo.addEventListener('click', function () {
            el.source.value = DEMO;
            updateManchuScript();
            log('已填入示例句');
        });
    }
    const btnClear = document.getElementById('btnClear');
    if (btnClear) {
        btnClear.addEventListener('click', function () {
            el.source.value = '';
            el.latin.value = '';
            el.cmu.value = '';
            el.resultArea.hidden = true;
            updateManchuScript();
            log('已清空');
        });
    }

    // 下载音频
    const btnDownload = document.getElementById('btnDownload');
    if (btnDownload) {
        btnDownload.addEventListener('click', function () {
            if (!el.audioPlayer.src) { log('还没有可下载的音频'); return; }
            const a = document.createElement('a');
            a.href = el.audioPlayer.src;
            a.download = 'manchu_tts_' + Date.now() + '.wav';
            a.click();
        });
    }

    // ==================== 服务状态 ====================
    async function checkHealth() {
        try {
            const res = await fetch(API + '/health', { cache: 'no-store' });
            const data = await res.json();
            const alive = data.upstream_alive;
            el.svcDot.className = 'status-dot ' + (alive ? 'ok' : 'err');
            el.svcText.textContent = alive
                ? '已连接（' + (data.upstream || '') + '）'
                : '未连接';
            if (el.svcBanner) el.svcBanner.hidden = alive;
            return alive;
        } catch (err) {
            el.svcDot.className = 'status-dot err';
            el.svcText.textContent = '代理异常';
            if (el.svcBanner) el.svcBanner.hidden = false;
            return false;
        }
    }

    // ==================== 初始化 ====================
    el.source.addEventListener('input', updateManchuScript);
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.key === 'Enter') el.btnSynthesize.click();
    });

    updateManchuScript();
    log('就绪。Ctrl+Enter 可直接合成。');
    checkHealth();
    setInterval(checkHealth, 15000);
})();
