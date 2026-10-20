/* ============================================================
   满文古籍 OCR · 标注工作台前端逻辑

   功能：
   ① 鼠标拖动框（四角可缩放）
   ② 拖动 / 增删后，按「列优先（从上到下 → 从左到右）」自动重新编号
   ③ 框的长高比超出 48×320 标准（h/w > 320/48）时，框与列表项高亮为醒目蓝色
   ④ AI 模型接入：
        · AI 画框：POST 整图到 <base>/detect，返回文本框坐标
        · AI 预测：逐框裁剪竖排字块（不旋转），POST 到 <base>/recognize
          （model 内部按版面分析切分竖条、逆时针旋转 90° 后识别，
           单框模式传 skip_layout=1，沿用参考工具的处理方式）

   接口约定（与 modules/ocr 代理一致）：
        POST {base}/detect        FormData: image        → { boxes:[{x,y,w,h}], box_count }
        POST {base}/recognize     FormData: image / model_type / skip_layout
                                                       → { columns:[{column,text,type}] }
   ============================================================ */
(function () {
  'use strict';

  const API_DEFAULT = window.OCR_API_DEFAULT || '/api/ocr';

  const $ = id => document.getElementById(id);

  // ---------- DOM ----------
  const fileInput = $('fileInput');
  const uploadBtn = $('uploadBtn');
  const aiDetectBtn = $('aiDetectBtn');
  const aiPredictBtn = $('aiPredictBtn');
  const addBoxBtn = $('addBoxBtn');
  const clearBtn = $('clearBtn');
  const exportBtn = $('exportBtn');
  const serverUrlInput = $('serverUrl');
  const status = $('status');

  const origImg = $('origImg');
  const imgWrap = $('imgWrap');
  const bboxLayer = $('bboxLayer');
  const mainPanel = $('mainPanel');
  const emptyHint = $('emptyHint');
  const leftPanel = $('leftPanel');
  const resizer = $('resizer');
  const annotationList = $('annotationList');

  const totalCount = $('totalCount');
  const okCount = $('okCount');
  const warnCount = $('warnCount');

  // ---------- 状态 ----------
  let boxes = [];
  let selectedBox = null;
  let isDragging = false;
  let isResizing = false;
  let resizeHandle = null;
  let dragStart = { x: 0, y: 0 };
  let boxStart = { x: 0, y: 0, w: 0, h: 0 };
  let imageScale = 1;          // 原图像素 / 显示像素
  let imgNaturalSize = { w: 0, h: 0 };
  let nextBoxId = 0;
  let isManualOrder = false;    // true 时不再自动列优先重排（用户手动改序号）
  let currentImageName = '';

  // 48×≤320 标准：旋转后高 48、宽 ≤ 320
  const TARGET_H = 48;
  const MAX_W = 320;
  const MAX_RATIO = MAX_W / TARGET_H;   // ≈ 6.67

  // ------------------------------------------------------------
  // 后端地址
  // ------------------------------------------------------------
  function getBaseUrl() {
    const url = (serverUrlInput && serverUrlInput.value || '').trim();
    return (url || API_DEFAULT).replace(/\/+$/, '');
  }
  const getDetectUrl = () => getBaseUrl() + '/detect';
  const getRecognizeUrl = () => getBaseUrl() + '/recognize';

  function setStatus(text, revert) {
    status.textContent = text;
    if (revert) setTimeout(() => { status.textContent = '就绪'; }, 2500);
  }

  // ------------------------------------------------------------
  // 上传 / 加载
  // ------------------------------------------------------------
  uploadBtn.onclick = () => fileInput.click();

  fileInput.addEventListener('change', function () {
    const file = this.files[0];
    if (!file) return;
    currentImageName = file.name.replace(/\.[^/.]+$/, '');
    const reader = new FileReader();
    reader.onload = e => {
      origImg.onload = () => {
        emptyHint.style.display = 'none';
        mainPanel.style.display = 'flex';
        imgNaturalSize = { w: origImg.naturalWidth, h: origImg.naturalHeight };
        imageScale = origImg.naturalWidth / origImg.offsetWidth;
        // 让标注层与图片显示尺寸一致
        bboxLayer.style.width = origImg.offsetWidth + 'px';
        bboxLayer.style.height = origImg.offsetHeight + 'px';
        aiDetectBtn.disabled = false;
        addBoxBtn.disabled = false;
        clearBtn.disabled = false;
        setStatus('图片已加载，可「AI 画框」或「添加框」');
      };
      origImg.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  // ------------------------------------------------------------
  // 框的创建 / 渲染
  // ------------------------------------------------------------
  function addBox(x, y, w, h, text, skipRefresh) {
    const id = nextBoxId++;
    const el = document.createElement('div');
    el.className = 'bbox';
    el.id = `box-${id}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;

    const indexLabel = document.createElement('div');
    indexLabel.className = 'bbox-index';
    indexLabel.textContent = '?';
    el.appendChild(indexLabel);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteBox(id); };
    el.appendChild(deleteBtn);

    ['tl', 'tr', 'bl', 'br'].forEach(pos => {
      const handle = document.createElement('div');
      handle.className = `resize-handle ${pos}`;
      handle.onmousedown = (e) => startResize(e, id, pos);
      el.appendChild(handle);
    });

    const wordWarning = document.createElement('div');
    wordWarning.className = 'word-warning';
    wordWarning.textContent = '⚠ 超长';
    el.appendChild(wordWarning);

    el.addEventListener('mousedown', (e) => startDrag(e, id));
    bboxLayer.appendChild(el);

    const nextOrder = isManualOrder ? boxes.filter(b => b !== null).length : -1;
    boxes.push({ id, x, y, w, h, text: text || '', element: el, displayOrder: nextOrder });
    if (!skipRefresh) { refreshAll(); selectBox(id); }
    return id;
  }

  function updateBoxPosition(id) {
    const box = boxes.find(b => b && b.id === id);
    if (!box) return;
    box.element.style.left = `${box.x}px`;
    box.element.style.top = `${box.y}px`;
    box.element.style.width = `${box.w}px`;
    box.element.style.height = `${box.h}px`;
  }

  // 长宽比是否合格：h/w ≤ 320/48 且 旋转后宽 ≤ 320
  function boxRatioInfo(box) {
    const ratio = box.h / box.w;
    const exportW = Math.round(box.h * TARGET_H / box.w);
    const isOk = ratio <= MAX_RATIO && exportW <= MAX_W;
    const isWarning = ratio > MAX_RATIO;   // 超出 48×320 标准 → 蓝色高亮
    return { isOk, isWarning, exportW };
  }

  function updateRatioTip(id) {
    const box = boxes.find(b => b && b.id === id);
    if (!box) return;
    const { isOk, isWarning } = boxRatioInfo(box);
    box.element.className = 'bbox ' + (isOk ? '' : isWarning ? 'warning' : 'error');
    const annoItem = $('anno-' + id);
    if (annoItem) annoItem.className = 'annotation-item ' + (isOk ? '' : isWarning ? 'warning' : 'error');
    const sizeEl = $('size-' + id);
    if (sizeEl) {
      const { exportW } = boxRatioInfo(box);
      sizeEl.textContent = `${TARGET_H}×${exportW}`;
      sizeEl.className = 'anno-size ' + (isOk ? 'ok' : isWarning ? 'warning' : 'error');
    }
  }

  // ------------------------------------------------------------
  // 自动编号（列优先：左→右按中心 x，列内上→下按 y）
  // ------------------------------------------------------------
  function refreshAll(autoSelect = true, autoSort = true) {
    const validBoxes = boxes.filter(b => b !== null);
    if (validBoxes.length === 0) {
      annotationList.innerHTML = '';
      updateStats();
      exportBtn.disabled = true;
      return;
    }

    let ordered;
    if (autoSort && !isManualOrder) {
      validBoxes.sort((a, b) => (a.x + a.w / 2) - (b.x + b.w / 2));
      const widths = validBoxes.map(b => b.w).sort((a, b) => a - b);
      const medianColWidth = widths[Math.floor(widths.length / 2)] || 60;
      const colThreshold = Math.min(Math.max(20, medianColWidth * 0.55), medianColWidth * 1.2);
      const columns = [];
      let currentCol = [validBoxes[0]];
      for (let i = 1; i < validBoxes.length; i++) {
        const prevCenter = currentCol[currentCol.length - 1].x + currentCol[currentCol.length - 1].w / 2;
        const currCenter = validBoxes[i].x + validBoxes[i].w / 2;
        if (Math.abs(currCenter - prevCenter) > colThreshold) {
          columns.push(currentCol);
          currentCol = [validBoxes[i]];
        } else {
          currentCol.push(validBoxes[i]);
        }
      }
      columns.push(currentCol);
      ordered = [];
      columns.forEach(col => { col.sort((a, b) => a.y - b.y); ordered.push(...col); });
    } else {
      ordered = [...validBoxes].sort((a, b) => a.displayOrder - b.displayOrder);
    }

    ordered.forEach((box, order) => {
      box.displayOrder = order;
      const label = box.element.querySelector('.bbox-index');
      if (label) label.textContent = order + 1;
    });

    annotationList.innerHTML = '';
    ordered.forEach((box, order) => addAnnotationItem(box, order));
    updateStats();
    exportBtn.disabled = false;
    if (autoSelect && ordered.length > 0) selectBox(ordered[0].id);
  }

  function addAnnotationItem(box, order) {
    const item = document.createElement('div');
    item.className = 'annotation-item';
    item.id = `anno-${box.id}`;
    item.onclick = () => selectBox(box.id);

    const { isOk, isWarning, exportW } = boxRatioInfo(box);

    item.innerHTML = `
      <input type="number" class="anno-index" id="order-${box.id}"
             value="${order + 1}" min="1" max="${boxes.filter(b => b !== null).length}"
             onchange="window.__ocr.forceReorder(${box.id}, parseInt(this.value))"
             onclick="event.stopPropagation();"
             onfocus="this.select();"
             title="点击蓝色序号圆圈 → 输入新序号 → 回车确认">
      <textarea class="anno-input" id="input-${box.id}" placeholder="输入满文标注..."
                onfocus="window.__ocr.selectBox(${box.id})"
                oninput="window.__ocr.updateText(${box.id}, this.value)">${box.text || ''}</textarea>
      <div class="anno-size ${isOk ? 'ok' : isWarning ? 'warning' : 'error'}" id="size-${box.id}">${TARGET_H}×${exportW}</div>
      <button class="anno-delete" onclick="window.__ocr.deleteBox(${box.id})">×</button>
    `;
    annotationList.appendChild(item);
  }

  function updateStats() {
    const valid = boxes.filter(b => b !== null);
    let ok = 0, warn = 0;
    valid.forEach(b => { const r = boxRatioInfo(b); if (r.isOk) ok++; else warn++; });
    totalCount.textContent = valid.length;
    okCount.textContent = ok;
    warnCount.textContent = warn;
  }

  // ------------------------------------------------------------
  // 拖动 / 缩放
  // ------------------------------------------------------------
  function startDrag(e, id) {
    if (e.target.classList.contains('delete-btn') || e.target.classList.contains('resize-handle')) return;
    e.preventDefault();
    isDragging = true;
    selectedBox = id;
    const box = boxes.find(b => b && b.id === id);
    dragStart = { x: e.clientX, y: e.clientY };
    boxStart = { x: box.x, y: box.y, w: box.w, h: box.h };
    selectBox(id);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', stopDrag);
  }
  function onDrag(e) {
    if (!isDragging || selectedBox === null) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    const box = boxes.find(b => b && b.id === selectedBox);
    box.x = Math.max(0, boxStart.x + dx);
    box.y = Math.max(0, boxStart.y + dy);
    updateBoxPosition(selectedBox);
  }
  function stopDrag() {
    if (!isDragging) return;
    isDragging = false;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', stopDrag);
    if (selectedBox !== null) {
      // 拖动后按列优先重新编号（② 核心）
      refreshAll(false, true);
      selectBox(selectedBox);
    }
  }

  function startResize(e, id, handle) {
    e.preventDefault();
    e.stopPropagation();
    isResizing = true;
    resizeHandle = handle;
    selectedBox = id;
    const box = boxes.find(b => b && b.id === id);
    dragStart = { x: e.clientX, y: e.clientY };
    boxStart = { x: box.x, y: box.y, w: box.w, h: box.h };
    selectBox(id);
    document.addEventListener('mousemove', onResize);
    document.addEventListener('mouseup', stopResize);
  }
  function onResize(e) {
    if (!isResizing || selectedBox === null) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    const box = boxes.find(b => b && b.id === selectedBox);
    switch (resizeHandle) {
      case 'br': box.w = Math.max(10, boxStart.w + dx); box.h = Math.max(10, boxStart.h + dy); break;
      case 'bl': box.w = Math.max(10, boxStart.w - dx); box.h = Math.max(10, boxStart.h + dy); box.x = boxStart.x + (boxStart.w - box.w); break;
      case 'tr': box.w = Math.max(10, boxStart.w + dx); box.h = Math.max(10, boxStart.h - dy); box.y = boxStart.y + (boxStart.h - box.h); break;
      case 'tl': box.w = Math.max(10, boxStart.w - dx); box.h = Math.max(10, boxStart.h - dy); box.x = boxStart.x + (boxStart.w - box.w); box.y = boxStart.y + (boxStart.h - box.h); break;
    }
    updateBoxPosition(selectedBox);
    updateRatioTip(selectedBox);   // 缩放时实时更新蓝色高亮（③）
  }
  function stopResize() {
    if (!isResizing) return;
    isResizing = false;
    resizeHandle = null;
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', stopResize);
    if (selectedBox !== null) { updateRatioTip(selectedBox); refreshAll(false, true); selectBox(selectedBox); }
  }

  // ------------------------------------------------------------
  // 选择 / 删除 / 清空
  // ------------------------------------------------------------
  function selectBox(id) {
    if (id === null) {
      boxes.forEach(b => { if (b) b.element.classList.remove('selected'); });
      document.querySelectorAll('.annotation-item').forEach(item => item.classList.remove('active'));
      selectedBox = null;
      return;
    }
    boxes.forEach(b => { if (b) b.element.classList.toggle('selected', b.id === id); });
    document.querySelectorAll('.annotation-item').forEach(item => item.classList.toggle('active', item.id === `anno-${id}`));
    selectedBox = id;
  }

  function updateText(id, value) {
    const box = boxes.find(b => b && b.id === id);
    if (box) box.text = value;
  }

  // 手动改序号：插入式重排并锁定手动模式，避免被自动排序覆盖
  function forceReorder(boxId, newOrder) {
    const valid = boxes.filter(b => b !== null);
    if (valid.length === 0) return;
    let targetIndex = Math.max(1, Math.min(newOrder, valid.length)) - 1;
    const sorted = [...valid].sort((a, b) => a.displayOrder - b.displayOrder);
    const currentIdx = sorted.findIndex(b => b.id === boxId);
    if (currentIdx === -1 || currentIdx === targetIndex) { refreshAll(false, false); selectBox(boxId); return; }
    isManualOrder = true;
    const [moved] = sorted.splice(currentIdx, 1);
    sorted.splice(targetIndex, 0, moved);
    sorted.forEach((box, idx) => { box.displayOrder = idx; });
    refreshAll(false, false);
    selectBox(boxId);
  }

  function deleteBox(id) {
    const idx = boxes.findIndex(b => b && b.id === id);
    if (idx >= 0) {
      if (boxes[idx].element) boxes[idx].element.remove();
      boxes[idx] = null;
      if (selectedBox === id) selectedBox = null;
      refreshAll();
    }
  }

  function clearAll() {
    boxes.forEach(b => { if (b && b.element) b.element.remove(); });
    boxes = [];
    selectedBox = null;
    nextBoxId = 0;
    isManualOrder = false;
    annotationList.innerHTML = '';
    updateStats();
    aiPredictBtn.disabled = true;
    exportBtn.disabled = true;
  }

  addBoxBtn.onclick = () => {
    const id = addBox(40, 40, 24, 120, '', true);
    refreshAll();
    selectBox(id);
    setStatus('已添加新框，可拖动调整');
  };

  clearBtn.onclick = () => { clearAll(); setStatus('已清空'); };

  // ------------------------------------------------------------
  // AI 画框（检测文本框）
  // ------------------------------------------------------------
  aiDetectBtn.onclick = aiDetect;

  async function aiDetect() {
    if (!origImg.src) { setStatus('请先上传图片'); return; }
    setStatus('🤖 AI 正在检测文本框...');
    try {
      const response = await fetch(origImg.src);
      const blob = await response.blob();
      const file = new File([blob], (currentImageName || 'image') + '.jpg', { type: 'image/jpeg' });
      const formData = new FormData();
      formData.append('image', file);

      const detectResp = await fetch(getDetectUrl(), { method: 'POST', body: formData });
      if (!detectResp.ok) throw new Error('检测失败: ' + detectResp.status);
      const result = await detectResp.json();

      if (!result.boxes || result.boxes.length === 0) {
        setStatus('⚠️ AI 未检测到文本框');
        return;
      }

      // 清空现有框
      boxes.forEach(b => { if (b && b.element) b.element.remove(); });
      boxes = [];
      selectedBox = null;
      nextBoxId = 0;
      isManualOrder = false;

      result.boxes.forEach(box => {
        const x = box.x / imageScale;
        const y = box.y / imageScale;
        const w = box.w / imageScale;
        const h = box.h / imageScale;
        addBox(x, y, w, h, '', true);
      });
      refreshAll();
      aiPredictBtn.disabled = false;
      setStatus(`🎉 AI 画框完成！共 ${result.boxes.length} 框`);
    } catch (err) {
      console.error('AI 检测错误:', err);
      setStatus('❌ AI 检测失败：' + err.message + '（请确认检测服务可用）');
    }
  }

  // ------------------------------------------------------------
  // AI 预测（逐框识别，单框模式跳过版面分析）
  // 注意：裁剪竖排字块后「不旋转」直接送后端，后端内部按版面分析
  //       切分竖条并逆时针旋转 90° 后识别（沿用参考工具处理方式）
  // ------------------------------------------------------------
  aiPredictBtn.onclick = aiPredict;

  async function aiPredict() {
    const valid = boxes.filter(b => b !== null);
    if (valid.length === 0) { setStatus('请先画框或添加框'); return; }
    setStatus('🔮 AI 预测中...');
    let success = 0, fail = 0;
    for (const box of valid) {
      try {
        const origX = Math.round(box.x * imageScale);
        const origY = Math.round(box.y * imageScale);
        const origW = Math.round(box.w * imageScale);
        const origH = Math.round(box.h * imageScale);
        if (origW <= 0 || origH <= 0) { fail++; continue; }

        const canvas = document.createElement('canvas');
        canvas.width = origW;
        canvas.height = origH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(origImg, origX, origY, origW, origH, 0, 0, origW, origH);

        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob null')), 'image/png');
        });
        const file = new File([blob], `box_${box.id}.png`, { type: 'image/png' });
        const formData = new FormData();
        formData.append('image', file);
        formData.append('model_type', 'ancient');
        formData.append('skip_layout', '1');   // 单框模式：跳过版面分析，直送 OCR

        const resp = await fetch(getRecognizeUrl(), { method: 'POST', body: formData });
        if (!resp.ok) { fail++; continue; }
        const result = await resp.json();
        let text = '';
        if (result && result.columns && Array.isArray(result.columns) && result.columns.length > 0) {
          text = result.columns[0].text || '';
        }
        box.text = text || '';
        const input = $('input-' + box.id);
        if (input) input.value = text || '';
        success++;
      } catch (err) {
        console.error(`🔮 AI预测 框 ${box.displayOrder + 1} 失败:`, err);
        fail++;
      }
    }
    setStatus(`🔮 AI 预测完成！成功 ${success}，失败 ${fail}`, true);
  }

  // ------------------------------------------------------------
  // 导出（标注结果 txt）
  // ------------------------------------------------------------
  exportBtn.onclick = () => {
    const valid = boxes.filter(b => b !== null).sort((a, b) => a.displayOrder - b.displayOrder);
    if (!valid.length) { setStatus('无标注可导出'); return; }
    let content = `满文古籍 OCR 标注结果\n图片: ${currentImageName || 'unknown'}\n生成时间: ${new Date().toLocaleString()}\n标准: 旋转后 高48 × 宽≤320\n================================\n\n`;
    valid.forEach(box => {
      const { exportW } = boxRatioInfo(box);
      const flag = boxRatioInfo(box).isOk ? '✓' : '✗超长';
      content += `第${box.displayOrder + 1}列\t${box.text || '(空)'}\t[原图 ${Math.round(box.w * imageScale)}×${Math.round(box.h * imageScale)} → 48×${exportW}] ${flag}\n`;
    });
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ocr_annot_${currentImageName || 'manju'}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`已导出 ${valid.length} 框标注结果`);
  };

  // ------------------------------------------------------------
  // 左右分栏拖拽
  // ------------------------------------------------------------
  let isPanelResizing = false;
  resizer.addEventListener('mousedown', () => {
    isPanelResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!isPanelResizing) return;
    const rect = mainPanel.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width * 100;
    if (pct > 15 && pct < 80) leftPanel.style.width = pct + '%';
  });
  document.addEventListener('mouseup', () => {
    isPanelResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // 暴露给内联 on* 处理器
  window.__ocr = { selectBox, deleteBox, updateText, forceReorder };

  // 窗口尺寸变化时同步标注层尺寸
  window.addEventListener('resize', () => {
    if (origImg && origImg.src && origImg.offsetWidth) {
      imageScale = origImg.naturalWidth / origImg.offsetWidth;
      bboxLayer.style.width = origImg.offsetWidth + 'px';
      bboxLayer.style.height = origImg.offsetHeight + 'px';
    }
  });
})();
