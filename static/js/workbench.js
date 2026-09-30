/* ============================================================
   工作平台（演示版）· 交互

   四个页面共用这一个文件，靠 window.WB_* 变量判断当前在哪页：
     WB_TASKS      -> OCR 标注页
     WB_BAD_ROWS   -> 双行校对页
     WB_SENTENCES  -> 依存句法标注页
     WB_REVIEW_URL -> 审核台

   所有"AI"操作都是模拟（setTimeout + 预置结果），不调用任何模型服务；
   提交走 fetch 写 session，不落盘。
   ============================================================ */
(function () {
    var $ = function (s) { return document.querySelector(s); };

    function toast(msg) {
        var el = document.createElement('div');
        el.className = 'wb-toast';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 2400);
    }

    function post(url, payload, onOk) {
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d && d.ok) { onOk && onOk(d); } else { toast('操作未成功'); }
            })
            .catch(function () { toast('请求失败（演示服务未响应）'); });
    }

    /* ============================================================
       1. OCR 标注页（整页古籍扫描图 + 竖排满文校对）

       下发任务是整页图，框按竖排列从右向左排列；选中框后右侧显示该框的
       裁剪预览，文本框用站内专用满文字体竖排显示（见页面内嵌 @font-face）。
       "AI 画框 / AI 预测"仍是模拟：真实权重在本机但服务未部署。
       ============================================================ */
    if (window.WB_TASKS) {
        var tasks = window.WB_TASKS;
        var curId = window.WB_CURRENT;
        var selected = null;
        var zoom = 1;

        var state = {};
        tasks.forEach(function (t) {
            state[t.id] = t.boxes.map(function (b) {
                return { x: b.x, y: b.y, w: b.w, h: b.h, text: '', conf: 0, suspect: !!b.suspect,
                         src: b.text, confirmed: false, shown: false };
            });
        });

        var layer = $('#boxLayer'), img = $('#pageImg'), wrap = $('#pageWrap');

        function boxes() { return state[curId] || []; }
        function task() { return tasks.filter(function (x) { return x.id === curId; })[0]; }

        function renderBoxes() {
            layer.innerHTML = '';
            boxes().forEach(function (b, i) {
                if (!b.shown) return;
                var d = document.createElement('div');
                d.className = 'wb-box' + (b.suspect && !b.confirmed ? ' suspect' : '') +
                              (b.confirmed ? ' confirmed' : '') + (selected === i ? ' active' : '');
                d.style.left = b.x + '%'; d.style.top = b.y + '%';
                d.style.width = b.w + '%'; d.style.height = b.h + '%';
                var tag = document.createElement('span');
                tag.className = 'tag'; tag.textContent = String(i + 1);
                d.appendChild(tag);
                d.addEventListener('click', function (ev) { ev.stopPropagation(); select(i); });
                layer.appendChild(d);
            });
            var shown = boxes().filter(function (b) { return b.shown; });
            $('#boxCount').textContent = shown.length;
            var done = boxes().filter(function (b) { return b.confirmed; }).length;
            $('#progBar').style.width = (shown.length ? done / shown.length * 100 : 0) + '%';
            $('#progText').textContent = done + ' / ' + shown.length + ' 已确认';
        }

        // 框预览：按框坐标从原图裁剪（满文竖排，裁出来是窄高的一条）
        function renderPreview(b) {
            var pv = $('#previewImage');
            if (!b || !img.naturalWidth) { pv.hidden = true; $('#previewEmpty').hidden = false; return; }
            var sx = img.naturalWidth * b.x / 100, sy = img.naturalHeight * b.y / 100;
            var sw = img.naturalWidth * b.w / 100, sh = img.naturalHeight * b.h / 100;
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(sw));
            c.height = Math.max(1, Math.round(sh));
            c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
            pv.src = c.toDataURL('image/png');
            pv.hidden = false;
            $('#previewEmpty').hidden = true;
        }

        function select(i) {
            selected = i;
            var b = boxes()[i];
            if (!b) { return; }
            $('#propEmpty').hidden = true;
            $('#propBody').hidden = false;
            $('#propText').value = b.text || '';
            $('#propConf').textContent = (b.conf || 0).toFixed(2);
            $('#propFlag').textContent = b.confirmed ? '已确认'
                : (b.suspect ? '置信度偏低，建议核对' : '待确认');
            $('#propFile').textContent = task().file + ' · 第 ' + (i + 1) + ' 列';
            $('#previewInfo').textContent = '第 ' + (i + 1) + ' 列 · ' +
                Math.round(img.naturalWidth * b.w / 100) + '×' +
                Math.round(img.naturalHeight * b.h / 100) + ' px';
            renderPreview(b);
            renderBoxes();
        }

        function loadTask(id) {
            curId = id;
            selected = null;
            $('#propEmpty').hidden = false;
            $('#propBody').hidden = true;
            $('#previewImage').hidden = true;
            $('#previewEmpty').hidden = false;
            $('#previewInfo').textContent = '—';
            var t = task();
            img.src = '/static/' + t.image;
            $('#fileName').textContent = t.file;
            $('#fileMeta').textContent = t.size + ' · 第 ' + t.page + ' 页';
            document.querySelectorAll('.wb-task').forEach(function (el) {
                el.classList.toggle('active', el.dataset.task === id);
            });
            setZoom(1);
            renderBoxes();
        }

        function setZoom(z) {
            zoom = Math.min(2.5, Math.max(0.45, z));
            wrap.style.width = (zoom * 100) + '%';
        }

        img.addEventListener('load', function () {
            if (selected !== null) { renderPreview(boxes()[selected]); }
        });

        document.querySelectorAll('.wb-task').forEach(function (el) {
            el.addEventListener('click', function () { loadTask(el.dataset.task); });
        });

        // 🔍 AI 画框：模拟版面检测（竖排列切分）
        $('#btnDetect').addEventListener('click', function () {
            var btn = this;
            btn.disabled = true; btn.textContent = '⏳ 检测中…';
            setTimeout(function () {
                boxes().forEach(function (b) { b.shown = true; });
                renderBoxes();
                btn.disabled = false; btn.textContent = '🔍 AI 画框';
                toast('模拟检测完成：' + boxes().length + ' 个文本列');
            }, 1000);
        });

        // 🤖 AI 预测：填充识别文本与置信度
        $('#btnPredict').addEventListener('click', function () {
            var shown = boxes().filter(function (b) { return b.shown; });
            if (!shown.length) { toast('请先「AI 画框」或手动添加框'); return; }
            var btn = this;
            btn.disabled = true; btn.textContent = '⏳ 识别中…';
            setTimeout(function () {
                boxes().forEach(function (b, i) {
                    if (!b.shown) return;
                    var src = task().boxes[i];
                    if (src) { b.text = src.text; b.conf = src.conf; }
                });
                renderBoxes();
                if (selected !== null) { select(selected); }
                btn.disabled = false; btn.textContent = '🤖 AI 预测';
                toast('模拟识别完成，请逐列核对');
            }, 1200);
        });

        // ➕ 添加框：接在最左一列（满文从右往左，新列往左加）
        $('#btnAdd').addEventListener('click', function () {
            var list = boxes();
            var minX = list.length ? Math.min.apply(null, list.map(function (b) { return b.x; })) : 84;
            boxes().push({ x: Math.max(4, minX - 5.8), y: 9, w: 5.2, h: 68,
                           text: '', conf: 0, suspect: false, src: '',
                           confirmed: false, shown: true });
            renderBoxes();
            select(boxes().length - 1);
        });

        // 🗑️ 清空
        $('#btnClear').addEventListener('click', function () {
            state[curId] = [];
            selected = null;
            $('#propEmpty').hidden = false;
            $('#propBody').hidden = true;
            $('#previewImage').hidden = true;
            $('#previewEmpty').hidden = false;
            renderBoxes();
        });

        // 缩放
        $('#btnZoomIn').addEventListener('click', function () { setZoom(zoom + 0.2); });
        $('#btnZoomOut').addEventListener('click', function () { setZoom(zoom - 0.2); });
        $('#btnZoomFit').addEventListener('click', function () { setZoom(1); });

        // 编辑文本
        $('#propText').addEventListener('input', function () {
            if (selected === null) return;
            boxes()[selected].text = this.value;
            renderBoxes();
        });

        // ✔ 确认
        $('#btnConfirm').addEventListener('click', function () {
            if (selected === null) { toast('先选中一个框'); return; }
            boxes()[selected].confirmed = true;
            renderBoxes();
            toast('已确认');
        });

        // ✅ 提交
        $('#btnSubmit').addEventListener('click', function () {
            var payload = boxes().filter(function (b) { return b.shown; })
                                 .map(function (b) { return { text: b.text, conf: b.conf }; });
            if (!payload.length) { toast('还没有任何框'); return; }
            post(window.WB_SUBMIT_URL, { task_id: curId, boxes: payload }, function (d) {
                toast('已提交：' + d.submission.title + '（' + d.submission.status + '）');
                setTimeout(function () { location.href = '/workbench/'; }, 1200);
            });
        });

        renderBoxes();
        loadTask(curId);
        return;
    }

    /* ============================================================
       2. 双行校对页
       ============================================================ */
    if (window.WB_BAD_ROWS) {
        var bad = window.WB_BAD_ROWS.slice();
        var ptr = -1;

        function rows() { return Array.prototype.slice.call(document.querySelectorAll('tr.prow')); }

        function focusAt(i) {
            rows().forEach(function (r) { r.classList.remove('current'); });
            var row = rows().filter(function (r) { return +r.dataset.idx === bad[i]; })[0];
            if (!row) return;
            row.classList.add('current');
            row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }

        function step(delta) {
            if (!bad.length) { toast('没有待修复的问题了'); return; }
            ptr = (ptr + delta + bad.length) % bad.length;
            focusAt(ptr);
        }

        $('#btnNext').addEventListener('click', function () { step(1); });
        $('#btnPrev').addEventListener('click', function () { step(-1); });

        $('#btnFix').addEventListener('click', function () {
            if (ptr < 0 || !bad.length) { toast('请先点「下一处」定位问题'); return; }
            var idx = bad[ptr];
            var row = rows().filter(function (r) { return +r.dataset.idx === idx; })[0];
            row.classList.remove('has-error');
            row.classList.add('fixed');
            row.dataset.error = '';
            row.querySelector('.cell-check').innerHTML = '<span class="wb-badge ok">已修复</span>';
            bad.splice(ptr, 1);
            ptr = Math.min(ptr, bad.length - 1);
            $('#badCount').textContent = bad.length;
            toast('第 ' + idx + ' 行已修复，剩余 ' + bad.length + ' 处');
            if (bad.length) { focusAt(ptr); }
        });

        $('#btnSave').addEventListener('click', function () {
            var fixed = rows().filter(function (r) { return r.classList.contains('fixed'); })
                              .map(function (r) { return +r.dataset.idx; });
            post(window.WB_SUBMIT_URL, { fixed: fixed }, function (d) {
                toast('已提交：' + d.submission.title);
                setTimeout(function () { location.href = '/workbench/'; }, 1200);
            });
        });

        return;
    }

    /* ============================================================
       3. 依存句法标注页
       ============================================================ */
    if (window.WB_SENTENCES) {
        var sents = window.WB_SENTENCES;
        var cur = window.WB_CURRENT_SENT;
        var tokenized = false;

        function sent() { return sents.filter(function (s) { return s.id === cur; })[0]; }

        function svg(tag, attrs) {
            var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
            for (var k in attrs) { el.setAttribute(k, attrs[k]); }
            return el;
        }

        function drawTree(tokens) {
            var root = document.getElementById('udTree');
            root.innerHTML = '';
            var defs = svg('defs', {});
            var marker = svg('marker', { id: 'arrow', markerWidth: 8, markerHeight: 8,
                                          refX: 6, refY: 3, orient: 'auto' });
            marker.appendChild(svg('path', { d: 'M0,0 L6,3 L0,6 Z', fill: '#b08d3f' }));
            defs.appendChild(marker);
            root.appendChild(defs);

            var W = 900, base = 150, n = tokens.length;
            var xOf = function (i) { return 70 + i * (W - 140) / Math.max(n - 1, 1); };

            tokens.forEach(function (t, i) {
                var x = xOf(i);
                var label = svg('text', { x: x, y: base + 28, 'text-anchor': 'middle',
                                          'font-size': 15, fill: '#1f2937' });
                label.textContent = t.form;
                root.appendChild(label);
                var upos = svg('text', { x: x, y: base + 44, 'text-anchor': 'middle',
                                         'font-size': 10, fill: '#9ca3af' });
                upos.textContent = t.upos;
                root.appendChild(upos);

                if (t.head === 0) {
                    var r = svg('text', { x: x, y: base - 16, 'text-anchor': 'middle',
                                          'font-size': 11, fill: '#059669' });
                    r.textContent = 'ROOT';
                    root.appendChild(r);
                    return;
                }
                var x1 = xOf(t.head - 1), x2 = x;
                var mx = (x1 + x2) / 2;
                var cy = base - 20 - Math.abs(x2 - x1) * 0.18;
                root.appendChild(svg('path', {
                    d: 'M' + x1 + ',' + (base - 8) + ' Q' + mx + ',' + cy + ' ' + x2 + ',' + (base - 8),
                    fill: 'none', stroke: '#b08d3f', 'stroke-width': 1.6,
                    'marker-end': 'url(#arrow)'
                }));
                var dep = svg('text', { x: mx, y: cy - 5, 'text-anchor': 'middle',
                                        'font-size': 11, fill: '#b08d3f' });
                dep.textContent = t.deprel;
                root.appendChild(dep);
            });
        }

        function render() {
            var s = sent();
            $('#sentenceText').textContent = s.text;
            document.querySelectorAll('.wb-task.text').forEach(function (el) {
                el.classList.toggle('active', el.dataset.sent === s.id);
            });

            var row = $('#tokenRow');
            row.innerHTML = '';
            s.tokens.forEach(function (t, i) {
                var chip = document.createElement('div');
                chip.className = 'wb-token' + (t.head === 0 ? ' root' : '');
                chip.innerHTML = t.form + '<small>' + t.upos + ' · ' + t.deprel + '</small>';
                chip.addEventListener('click', function () {
                    document.querySelectorAll('.wb-token').forEach(function (c) { c.classList.remove('active'); });
                    chip.classList.add('active');
                    var tr = document.querySelectorAll('#conlluBody tr')[i];
                    document.querySelectorAll('#conlluBody tr').forEach(function (r) { r.style.background = ''; });
                    if (tr) tr.style.background = '#fffdf7';
                });
                row.appendChild(chip);
            });
            $('#tokenCount').textContent = s.tokens.length;

            var body = $('#conlluBody');
            body.innerHTML = '';
            s.tokens.forEach(function (t) {
                var tr = document.createElement('tr');
                tr.innerHTML = '<td class="mono">' + t.id + '</td><td class="mono">' + t.form +
                               '</td><td>' + t.upos + '</td><td class="mono">' + t.head +
                               '</td><td>' + t.deprel + '</td>';
                body.appendChild(tr);
            });

            drawTree(s.tokens);
        }

        document.querySelectorAll('.wb-task.text').forEach(function (el) {
            el.addEventListener('click', function () { cur = el.dataset.sent; render(); });
        });

        $('#btnTokenize').addEventListener('click', function () {
            var btn = this;
            btn.disabled = true; btn.textContent = '⏳ 分词中…';
            setTimeout(function () {
                tokenized = true;
                render();
                btn.disabled = false; btn.textContent = '✂️ 重新分词';
                toast('模拟分词完成：' + sent().tokens.length + ' 个词');
            }, 800);
        });

        $('#btnExport').addEventListener('click', function () {
            var s = sent();
            var lines = ['# sent_id = ' + s.id, '# text = ' + s.text, '# text_zh = ' + (s.zh || '')];
            s.tokens.forEach(function (t) {
                lines.push([t.id, t.form, '_', t.upos, '_', '_', t.head, t.deprel, '_', '_'].join('\t'));
            });
            var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = s.id + '.conllu';
            a.click();
            toast('已导出 ' + s.id + '.conllu（浏览器本地生成）');
        });

        $('#btnSubmit').addEventListener('click', function () {
            post(window.WB_SUBMIT_URL, { sentences: [cur] }, function (d) {
                toast('已提交：' + d.submission.title);
                setTimeout(function () { location.href = '/workbench/'; }, 1200);
            });
        });

        render();
        return;
    }

    /* ============================================================
       4. 重置演示数据（工作台首页）
       ============================================================ */
    if (window.WB_RESET_URL) {
        var btnReset = document.getElementById('btnReset');
        if (btnReset) {
            btnReset.addEventListener('click', function () {
                post(window.WB_RESET_URL, {}, function () {
                    toast('演示数据已重置');
                    setTimeout(function () { location.reload(); }, 800);
                });
            });
        }
    }

    /* ============================================================
       5. 审核台
       ============================================================ */
    if (window.WB_REVIEW_URL) {
        document.querySelectorAll('.wb-review').forEach(function (card) {
            var id = card.dataset.id;
            var input = card.querySelector('.wb-input.inline');
            card.querySelectorAll('button').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var approve = btn.dataset.act === 'approve';
                    var comment = (input && input.value || '').trim();
                    if (!approve && !comment) { toast('驳回请填写意见'); input && input.focus(); return; }
                    post(window.WB_REVIEW_URL, { id: id, approve: approve, comment: comment }, function () {
                        toast(approve ? '已通过' : '已驳回');
                        card.remove();
                        var h3 = document.querySelector('.wb-h3');
                        if (h3) { h3.textContent = '待我验收（' + document.querySelectorAll('.wb-review').length + '）'; }
                        if (!document.querySelectorAll('.wb-review').length) {
                            var list = document.querySelector('.wb-review-list');
                            if (list) { list.innerHTML = '<div class="wb-empty">已全部处理完。</div>'; }
                        }
                    });
                });
            });
        });
    }
})();
