/* ============================================================
   语料集 · 页面交互

   1. 平行语料页：把拉丁满文反写成传统满文（规则复用全站唯一的 manju-rules.js）
   2. 平行语料页：按汉文 / 拉丁满文关键词过滤行
   3. OCR 页：真实古籍 / 合成 两个页签切换
   4. 语音页：多个播放器互斥（同时只播一条）

   依赖：js/manju-rules.js（仅平行语料页需要）
   ============================================================ */
(function () {
    // ---------- 1+2. 平行语料：反写与过滤 ----------
    var manjuCells = document.querySelectorAll('td.cell-manju');

    function fillManju() {
        manjuCells.forEach(function (td) {
            var latin = td.dataset.latin || '';
            // 反写结果仅作展示参考：原始语料是拉丁转写，不等于古籍字形
            td.textContent = window.ManjuRules ? window.ManjuRules.latin2manju(latin) : '';
        });
    }

    var filter = document.getElementById('filter');
    var rows = document.querySelectorAll('#pairTable tbody tr');

    if (filter && rows.length) {
        filter.addEventListener('input', function () {
            var kw = filter.value.trim().toLowerCase();
            rows.forEach(function (tr) {
                if (!kw) { tr.hidden = false; return; }
                var text = (tr.textContent + ' ' + (tr.querySelector('.cell-latin') || {}).textContent || '').toLowerCase();
                tr.hidden = text.indexOf(kw) === -1;
            });
        });
    }

    // ---------- 3. OCR 页签 ----------
    var tabs = document.querySelectorAll('.tab-btn');
    if (tabs.length) {
        tabs.forEach(function (btn) {
            btn.addEventListener('click', function () {
                tabs.forEach(function (b) { b.classList.toggle('active', b === btn); });
                document.querySelectorAll('.tab-panel').forEach(function (p) {
                    p.hidden = p.id !== 'tab-' + btn.dataset.tab;
                });
            });
        });
    }

    // ---------- 4. 音频互斥 ----------
    var players = document.querySelectorAll('audio');
    players.forEach(function (a) {
        a.addEventListener('play', function () {
            players.forEach(function (other) {
                if (other !== a) other.pause();
            });
        });
    });

    fillManju();
})();
