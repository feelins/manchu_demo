/* ============================================================
   满汉双向翻译 · 业务逻辑

   源：`03满汉双向翻译/满汉翻译_三栏_完美版 三模型.html` 的 <script>（494–928 行）
   移植日期：2026-09-24，相对源页面的改动见 docs/08-满汉双向翻译模块移植记录.md 第 5 节：

   1. 不再直连 http://localhost:800x，统一走门户代理 /api/translate/*
      （原因：浏览器所在机器不一定是跑模型的机器；且 8005 是 OpenAI 协议，
        与 8001/8003 的 /translate 不兼容，差异已在 Flask 代理层抹平）
   2. 中间栏的「拉丁 → 传统满文」改用 manju-rules.js，与文字转换模块同源
   3. 历史记录存全文而非源页面的 40 字截断（原文回放会被截断）
   4. 复制优先 navigator.clipboard，失败才回退 execCommand
   5. 健康轮询由 3s 放宽到 10s（源对每个模型单独探测，过于频繁）

   依赖：js/manju-rules.js（必须先加载）
   ============================================================ */
(function () {
    const API = '/api/translate';
    const HEALTH_INTERVAL = 10000;

    let currentDirection = 'mnc2zho';
    let modelStatus = {};        // key -> bool，健康探测结果
    let historyData = [];

    function $(id) { return document.getElementById(id); }
    function showToast(msg) {
        const t = $('toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(function () { t.classList.remove('show'); }, 2600);
    }
    function escapeHtml(text) {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    // ==================== 中间栏：拉丁 → 传统满文 ====================
    function updateMiddlePanel() {
        const input = $('inputText').value;
        const output = $('outputText').value;
        // 满→汉时中间栏跟随输入；汉→满时跟随输出（与源一致）
        const latinText = currentDirection === 'mnc2zho' ? input : output;
        const source = currentDirection === 'mnc2zho' ? '输入' : '输出';

        if (latinText.trim()) {
            const manju = window.ManjuRules.latin2manju(latinText);
            $('middleText').value = manju;
            $('middleStats').textContent = manju.length + ' 字符 | 来源：' + source;
            $('middleStatus').textContent = '已转换（来自' + source + '）';
        } else {
            $('middleText').value = '';
            $('middleStats').textContent = '0 字符';
            $('middleStatus').textContent = '等待拉丁满文…';
        }
        $('inputStats').textContent = input.length + ' 字符';
        $('outputStats').textContent = output.length + ' 字符';
    }

    // ==================== 方向切换 ====================
    const DIR_CONFIG = {
        mnc2zho: {
            label: '满语 → 汉语',
            inputLang: '满语', outputLang: '汉语',
            inputTag: 'manchu', outputTag: 'chinese',
            inputPh: '请输入满语拉丁转写…',
            outputPh: '汉语翻译结果…',
        },
        zho2mnc: {
            label: '汉语 → 满语',
            inputLang: '汉语', outputLang: '满语',
            inputTag: 'chinese', outputTag: 'manchu',
            inputPh: '请输入汉语…',
            outputPh: '满语拉丁转写结果…',
        },
    };

    window.setDirection = function (dir) {
        const cfg = DIR_CONFIG[dir];
        if (!cfg) return;
        currentDirection = dir;

        $('btnMnc2Zho').classList.toggle('active', dir === 'mnc2zho');
        $('btnZho2Mnc').classList.toggle('active', dir === 'zho2mnc');

        const it = $('inputLangTag'), ot = $('outputLangTag');
        it.textContent = cfg.inputLang;
        it.className = 'lang-tag ' + cfg.inputTag;
        ot.textContent = cfg.outputLang;
        ot.className = 'lang-tag ' + cfg.outputTag;

        $('inputText').placeholder = cfg.inputPh;
        $('outputText').placeholder = cfg.outputPh;
        $('currentDirection').textContent = cfg.label;
        updateMiddlePanel();
    };

    // ==================== 服务健康探测 ====================
    function currentModel() { return $('modelSelect').value; }

    function refreshServiceUI() {
        const alive = modelStatus[currentModel()];
        const dot = $('svcDot'), txt = $('svcText');
        dot.className = 'status-dot ' + (alive ? 'ok' : (alive === false ? 'err' : 'wait'));
        txt.textContent = alive ? '已启动' : (alive === false ? '未启动' : '检测中…');

        const spec = (window.MODELS || []).find(function (m) { return m.key === currentModel(); });
        $('modelVersionDisplay').textContent =
            (spec ? spec.short : '—') + (alive ? ' · 在线' : '');

        // 三个模型都没起来时，给出可执行的提示，而不是让用户对着空输出猜原因
        const banner = $('svcBanner');
        if (banner) {
            banner.hidden = Object.keys(modelStatus).some(function (k) { return modelStatus[k]; });
        }
    }

    async function checkHealth() {
        try {
            const res = await fetch(API + '/health', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            const sel = $('modelSelect');
            (data.models || []).forEach(function (m) {
                modelStatus[m.key] = !!m.alive;
                const opt = sel.querySelector('option[value="' + m.key + '"]');
                if (!opt) return;
                const base = opt.dataset.label || opt.textContent;
                opt.dataset.label = base;
                opt.textContent = base + (m.alive ? '（在线）' : '（离线）');
            });
            refreshServiceUI();
        } catch (err) {
            modelStatus = {};
            refreshServiceUI();
        }
    }

    // ==================== 翻译 ====================
    let translating = false;

    window.doTranslate = async function () {
        if (translating) return;
        const text = $('inputText').value.trim();
        if (!text) { showToast('请输入待翻译文本'); return; }

        translating = true;
        const btn = $('btnTranslate');
        btn.disabled = true;
        btn.classList.add('busy');
        showToast('正在翻译…');

        try {
            const res = await fetch(API + '/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    direction: currentDirection,
                    model: currentModel(),
                }),
            });
            const data = await res.json().catch(function () { return {}; });
            if (!res.ok) {
                throw new Error([data.error, data.hint].filter(Boolean).join('｜') ||
                    ('HTTP ' + res.status));
            }
            const translation = data.translation || '';
            $('outputText').value = translation;
            updateMiddlePanel();
            addToHistory(currentDirection, text, translation);
            showToast('翻译完成');
        } catch (err) {
            showToast('翻译失败：' + err.message);
        } finally {
            translating = false;
            btn.disabled = false;
            btn.classList.remove('busy');
        }
    };

    // ==================== 操作 ====================
    window.clearInput = function () {
        $('inputText').value = '';
        updateMiddlePanel();
    };
    window.clearAll = function () {
        $('inputText').value = '';
        $('outputText').value = '';
        updateMiddlePanel();
    };
    window.copyOutput = async function () {
        const val = $('outputText').value;
        if (!val) { showToast('没有可复制的内容'); return; }
        try {
            await navigator.clipboard.writeText(val);
            showToast('已复制到剪贴板');
        } catch (err) {
            const el = $('outputText');
            el.select();
            document.execCommand('copy');
            showToast('已复制到剪贴板');
        }
    };
    window.saveResult = function () {
        const input = $('inputText').value;
        const output = $('outputText').value;
        if (!output) { showToast('没有可保存的结果'); return; }
        const middle = $('middleText').value;
        const dirLabel = currentDirection === 'mnc2zho' ? '满→汉' : '汉→满';
        const modelName = ($('modelSelect').selectedOptions[0] || {}).dataset || {};
        const content = '[' + dirLabel + '] ' + new Date().toLocaleString() +
            '\n模型：' + (modelName.label || '') +
            '\n\n原文：\n' + input +
            '\n\n传统满文：\n' + middle +
            '\n\n译文：\n' + output;
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'translation_' + Date.now() + '.txt';
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('已保存');
    };

    // ==================== 历史记录（存全文） ====================
    const HISTORY_KEY = 'manchu_translate_history';

    function addToHistory(dir, source, result) {
        let history = [];
        try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { history = []; }
        history.unshift({
            time: new Date().toLocaleString(),
            direction: dir,
            source: source,
            result: result,
        });
        if (history.length > 20) history = history.slice(0, 20);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        renderHistory();
    }

    function truncate(s, n) {
        s = (s || '').replace(/\s+/g, ' ').trim();
        return s.length > n ? s.slice(0, n) + '…' : s;
    }

    function renderHistory() {
        let history = [];
        try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { history = []; }
        historyData = history;
        const list = $('historyList');
        if (!history.length) {
            list.innerHTML = '<div class="hist-empty">暂无记录</div>';
            return;
        }
        list.innerHTML = history.map(function (item, i) {
            const dirText = item.direction === 'mnc2zho' ? '满→汉' : '汉→满';
            return '<div class="hist-item" data-idx="' + i + '">' +
                '<span class="hist-dir">' + dirText + '</span>' +
                '<div class="hist-text">' + escapeHtml(truncate(item.source, 40)) + '</div>' +
                '<div class="hist-time">' + escapeHtml(item.time) + '</div>' +
                '</div>';
        }).join('');
    }

    function bindHistoryClick() {
        $('historyList').addEventListener('click', function (e) {
            const item = e.target.closest('.hist-item');
            if (!item) return;
            const data = historyData[parseInt(item.getAttribute('data-idx'), 10)];
            if (!data) return;
            window.setDirection(data.direction);
            $('inputText').value = data.source;
            $('outputText').value = data.result;
            updateMiddlePanel();
            showToast('已载入历史记录');
        });
    }

    window.clearHistory = function () {
        localStorage.removeItem(HISTORY_KEY);
        historyData = [];
        renderHistory();
        showToast('历史已清空');
    };

    // ==================== 字体检测 ====================
    async function checkFont() {
        let loaded = false;
        try {
            if (document.fonts && document.fonts.check) {
                loaded = document.fonts.check("20px 'Buleku'", "\u1820");
                if (!loaded) {
                    await document.fonts.load("20px 'Buleku'", "\u1820");
                    loaded = document.fonts.check("20px 'Buleku'", "\u1820");
                }
            }
        } catch (e) { loaded = false; }

        const el = $('middleText');
        if (loaded) {
            $('fontStatus').textContent = '字体正常';
            $('fontStatus').className = 'font-status ok';
            $('fontInfo').textContent = 'Buleku 已加载';
        } else {
            $('fontStatus').textContent = '字体未加载';
            $('fontStatus').className = 'font-status fail';
            $('fontInfo').textContent = '中间栏可能显示为方块';
            el.classList.add('font-fallback');
        }
    }

    // ==================== 示例句 ====================
    const DEMO = {
        mnc2zho: 'sini hala ai?',
        zho2mnc: '你叫什么名字？',
    };
    window.fillDemo = function () {
        $('inputText').value = DEMO[currentDirection] || DEMO.mnc2zho;
        updateMiddlePanel();
        showToast('已填入示例');
    };

    // ==================== 初始化 ====================
    function init() {
        const sel = $('modelSelect');
        sel.querySelectorAll('option').forEach(function (o) { o.dataset.label = o.textContent; });
        sel.addEventListener('change', function () {
            refreshServiceUI();
            checkHealth();
        });

        ['inputText', 'outputText'].forEach(function (id) {
            $(id).addEventListener('input', updateMiddlePanel);
        });

        window.setDirection('mnc2zho');
        renderHistory();
        bindHistoryClick();
        checkFont();
        checkHealth();
        setInterval(checkHealth, HEALTH_INTERVAL);

        // Ctrl+Enter 快捷翻译，与文字转换模块保持一致
        document.addEventListener('keydown', function (e) {
            if (e.ctrlKey && e.key === 'Enter') window.doTranslate();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
