/* ============================================================
   满文古籍 OCR · 前端逻辑
   移植自：01ocr/满文古籍OCR智能识别系统_竖版_批量版 汉字识别开关.html
   改动：后端地址由 localhost:端口 改为网关相对路径 /api/ocr（可用输入框临时覆盖）
   接口：POST {base}/recognize  FormData: image / model_type / recognize_chinese
   返回：{ original_image, columns:[{column,text,type}], column_thumbs:[], layout_used }
        失败返回 { error }
   ============================================================ */
(function () {
  'use strict';

  const API_DEFAULT = window.OCR_API_DEFAULT || '/api/ocr';

  const $ = id => document.getElementById(id);

  const fileInput = $('fileInput');
  const uploadBtn = $('uploadBtn');
  const batchBtn = $('batchBtn');
  const batchFileInput = $('batchFileInput');
  const recognizeStandardBtn = $('recognizeStandardBtn');
  const recognizeAncientBtn = $('recognizeAncientBtn');
  const toggleThumbBtn = $('toggleThumbBtn');
  const recognizeChineseBtn = $('recognizeChineseBtn');
  const exportBtn = $('exportBtn');
  const refreshView = $('refreshView');
  const serverUrlInput = $('serverUrl');
  const status = $('status');
  const origImg = $('origImg');
  const mainPanel = $('mainPanel');
  const emptyHint = $('emptyHint');
  const leftPanel = $('leftPanel');
  const resizer = $('resizer');
  const columnsContainer = $('columnsContainer');

  let originalImgData = null;
  let columnResults = [];
  let showThumbs = true;
  let recognizeChinese = false;
  let lastModelType = 'ancient';
  let batchResults = [];
  let batchPendingFiles = [];
  let currentImageName = '';

  // ------------------------------------------------------------
  // 后端地址：默认走门户网关 /api/ocr，调试时可在工具栏临时覆盖
  // ------------------------------------------------------------
  function getServerUrl() {
    const url = (serverUrlInput && serverUrlInput.value || '').trim();
    return (url || API_DEFAULT).replace(/\/+$/, '');
  }

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
      originalImgData = e.target.result;
      origImg.src = originalImgData;
      mainPanel.style.display = 'flex';
      if (emptyHint) emptyHint.style.display = 'none';
      recognizeStandardBtn.disabled = false;
      recognizeAncientBtn.disabled = false;
      recognizeChineseBtn.disabled = false;
      setStatus('图片已加载，请选择识别模式');
    };
    reader.readAsDataURL(file);
  });

  // ------------------------------------------------------------
  // 识别（单张）
  // ------------------------------------------------------------
  recognizeStandardBtn.onclick = () => doRecognize('standard', '正楷');
  recognizeAncientBtn.onclick = () => doRecognize('ancient', '古籍');

  recognizeChineseBtn.onclick = () => {
    recognizeChinese = !recognizeChinese;
    recognizeChineseBtn.classList.toggle('active', recognizeChinese);
    recognizeChineseBtn.textContent = recognizeChinese ? '🇨🇳 识别汉字(开)' : '🇨🇳 识别汉字';
    if (fileInput.files[0] && columnResults.length > 0) {
      doRecognize(lastModelType, lastModelType === 'ancient' ? '古籍' : '正楷');
    }
  };

  async function doRecognize(modelType, modelLabel) {
    const file = fileInput.files[0];
    if (!file) return;

    lastModelType = modelType;
    setStatus(`正在${modelLabel}识别...`);

    const formData = new FormData();
    formData.append('image', file);
    formData.append('model_type', modelType);
    formData.append('recognize_chinese', recognizeChinese ? '1' : '0');

    try {
      const resp = await fetch(getServerUrl() + '/recognize', { method: 'POST', body: formData });
      const data = await resp.json();
      if (data.error) {
        setStatus('错误: ' + data.error);
        return;
      }
      origImg.src = data.original_image || originalImgData;
      columnResults = data.columns || [];
      window.lastColumnThumbs = data.column_thumbs || [];
      toggleThumbBtn.disabled = false;
      batchBtn.disabled = false;
      exportBtn.disabled = false;
      toggleThumbBtn.classList.add('active');
      batchResults = [];
      renderColumns();
      setStatus(`${modelLabel}识别完成，共 ${columnResults.length} 列`);
    } catch (e) {
      setStatus('连接识别服务失败，请确认后端 ' + getServerUrl() + ' 可用');
    }
  }

  // ------------------------------------------------------------
  // 批量处理
  // ------------------------------------------------------------
  batchBtn.onclick = () => {
    batchFileInput.value = '';
    batchFileInput.click();
  };

  batchFileInput.onchange = async () => {
    const files = Array.from(batchFileInput.files);
    if (!files.length) return;
    batchPendingFiles = files;

    $('btnModelAncient').onclick = () => startBatchProcess('ancient', '古籍');
    $('btnModelStandard').onclick = () => startBatchProcess('standard', '正楷');
    $('btnModelCancel').onclick = () => {
      $('modelSelectOverlay').classList.remove('active');
      batchPendingFiles = [];
      batchFileInput.value = '';
    };

    $('modelSelectOverlay').classList.add('active');
    $('modelSelectCount').textContent = `已选择 ${files.length} 张图片`;
  };

  async function startBatchProcess(modelType, modelLabel) {
    $('modelSelectOverlay').classList.remove('active');
    const files = batchPendingFiles;
    batchPendingFiles = [];

    batchResults = [];
    setStatus(`批量处理开始，共 ${files.length} 张图片，使用 ${modelLabel} 模型...`);
    batchBtn.disabled = true;
    recognizeStandardBtn.disabled = true;
    recognizeAncientBtn.disabled = true;
    exportBtn.disabled = true;

    $('batchOverlay').classList.add('active');
    $('batchProgressModel').textContent = modelLabel + 'AI识别';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pct = Math.round((i / files.length) * 100);
      $('batchProgressBar').style.width = pct + '%';
      $('batchProgressText').textContent = `${i + 1} / ${files.length}`;
      $('batchProgressCurrent').textContent = file.name;
      status.textContent = `正在批量处理 [${i + 1}/${files.length}]: ${file.name} ...`;

      const formData = new FormData();
      formData.append('image', file);
      formData.append('model_type', modelType);
      formData.append('recognize_chinese', recognizeChinese ? '1' : '0');

      try {
        const resp = await fetch(getServerUrl() + '/recognize', { method: 'POST', body: formData });
        const data = await resp.json();
        if (data.error) {
          batchResults.push({ filename: file.name, error: data.error, columns: [] });
          continue;
        }
        batchResults.push({
          filename: file.name,
          columns: data.columns,
          columnCount: data.columns.length,
          layoutUsed: data.layout_used,
          modelType: modelType
        });
      } catch (e) {
        batchResults.push({ filename: file.name, error: '连接服务器失败', columns: [] });
      }
    }

    $('batchProgressBar').style.width = '100%';
    $('batchProgressText').textContent = `${files.length} / ${files.length}`;
    $('batchProgressCurrent').textContent = '处理完成';
    setTimeout(() => {
      $('batchOverlay').classList.remove('active');
      $('batchProgressBar').style.width = '0%';
    }, 800);

    columnResults = [];
    window.lastColumnThumbs = [];
    origImg.src = '';
    columnsContainer.innerHTML = '';
    mainPanel.style.display = 'none';
    if (emptyHint) emptyHint.style.display = '';
    toggleThumbBtn.disabled = true;
    toggleThumbBtn.classList.remove('active');
    recognizeChineseBtn.disabled = true;
    recognizeChineseBtn.classList.remove('active');
    recognizeChineseBtn.textContent = '🇨🇳 识别汉字';

    const successCount = batchResults.filter(r => !r.error).length;
    setStatus(`批量处理完成: ${files.length} 张, 成功 ${successCount} 张, 失败 ${files.length - successCount} 张`);
    batchBtn.disabled = false;
    recognizeStandardBtn.disabled = false;
    recognizeAncientBtn.disabled = false;
    exportBtn.disabled = false;
    batchFileInput.value = '';
  }

  // ------------------------------------------------------------
  // 显示/隐藏列图
  // ------------------------------------------------------------
  toggleThumbBtn.onclick = () => {
    showThumbs = !showThumbs;
    toggleThumbBtn.textContent = showThumbs ? '👁️ 显示列图' : '🚫 隐藏列图';
    toggleThumbBtn.classList.toggle('active', showThumbs);
    renderColumns();
  };

  // ------------------------------------------------------------
  // 导出
  // ------------------------------------------------------------
  exportBtn.onclick = () => {
    if (batchResults && batchResults.length > 0) {
      let content = `满文古籍OCR批量识别结果\n生成时间: ${new Date().toLocaleString()}\n服务: ${getServerUrl()}\n================================\n\n`;
      batchResults.forEach((item, idx) => {
        content += `【文件 ${idx + 1}】${item.filename}\n`;
        if (item.error) {
          content += `  错误: ${item.error}\n`;
        } else {
          content += `  模型: ${item.modelType === 'ancient' ? '古籍' : '正楷'}, 共 ${item.columns ? item.columns.length : 0} 列\n`;
          if (item.columns && item.columns.length > 0) {
            item.columns.forEach(col => {
              if (col.type === 'chinese' && !recognizeChinese) return;
              content += `  第${col.column}列\t${col.text || '(空)'}\n`;
            });
          }
        }
        content += '\n';
      });
      download(content, `batch_ocr_result_${Date.now()}.txt`);
      setStatus(`已导出 ${batchResults.length} 个文件的批量识别结果`);
      return;
    }

    const exportColumns = columnResults.filter(col => {
      if (col.type === 'chinese') return recognizeChinese;
      return true;
    });
    if (!exportColumns.length) {
      setStatus('无识别结果可导出');
      return;
    }
    let content = `满文古籍OCR识别结果\n生成时间: ${new Date().toLocaleString()}\n服务: ${getServerUrl()}\n================================\n\n`;
    exportColumns.forEach(col => {
      content += `第${col.column}列\t${col.text || '(空)'}\n`;
    });
    download(content, `ocr_result_${currentImageName || 'manju'}_${Date.now()}.txt`);
    setStatus(`已导出 ${exportColumns.length} 列识别结果`);
  };

  function download(text, filename) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ------------------------------------------------------------
  // 渲染竖排列（列缩略图用 Canvas 旋转 90°）
  // ------------------------------------------------------------
  const PLACEHOLDER_GOLD = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"%3E%3Crect width="300" height="300" fill="%23f5e6c8"/%3E%3C/svg%3E';
  const PLACEHOLDER_GRAY = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="30" height="200" viewBox="0 0 30 200"%3E%3Crect width="30" height="200" fill="%23e3dbcd"/%3E%3C/svg%3E';

  function renderColumns() {
    columnsContainer.innerHTML = '';
    const hanSize = $('hanSize').value + 'px';
    const manjuSize = $('manjuSize').value + 'px';

    const filteredColumns = columnResults.filter(col => {
      if (col.type === 'chinese') return recognizeChinese;
      return true;
    });

    filteredColumns.forEach((col, idx) => {
      const div = document.createElement('div');
      div.className = 'column';
      if (col.type === 'chinese') div.classList.add('chinese-column');

      const thumbDiv = document.createElement('div');
      thumbDiv.className = 'col-thumb';
      if (!showThumbs) thumbDiv.classList.add('hidden');

      const img = document.createElement('img');
      img.style.display = 'block';
      img.style.maxHeight = '100%';
      img.style.objectFit = 'contain';

      const srcData = (window.lastColumnThumbs && window.lastColumnThumbs[idx])
        ? window.lastColumnThumbs[idx]
        : PLACEHOLDER_GOLD;

      const tempImg = new Image();
      tempImg.crossOrigin = 'anonymous';
      tempImg.onload = function () {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = tempImg.height;
        canvas.height = tempImg.width;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(90 * Math.PI / 180);
        ctx.drawImage(tempImg, -tempImg.width / 2, -tempImg.height / 2);
        img.src = canvas.toDataURL('image/jpeg', 0.9);
      };
      tempImg.onerror = function () {
        img.src = PLACEHOLDER_GRAY;
      };
      tempImg.src = srcData;

      thumbDiv.appendChild(img);

      const contentDiv = document.createElement('div');
      contentDiv.className = 'col-content';

      const isChinese = col.type === 'chinese';
      const titleClass = isChinese ? 'col-title chinese-title' : 'col-title';
      const titleText = isChinese ? `第${col.column}列(汉)` : `第${col.column}列`;
      const textClass = isChinese ? 'chinese-text' : 'manju-text';
      const fontSize = isChinese ? hanSize : manjuSize;

      contentDiv.innerHTML = `
        <div class="${titleClass}" style="font-size:${hanSize}">${titleText}</div>
        <div class="${textClass}" style="font-size:${fontSize}">${col.text || ''}</div>
      `;

      div.appendChild(thumbDiv);
      div.appendChild(contentDiv);
      columnsContainer.appendChild(div);
    });
  }

  refreshView.onclick = renderColumns;

  // ------------------------------------------------------------
  // 左右分栏拖拽
  // ------------------------------------------------------------
  let isResizing = false;
  resizer.addEventListener('mousedown', () => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!isResizing) return;
    const rect = mainPanel.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width * 100;
    if (pct > 15 && pct < 80) leftPanel.style.width = pct + '%';
  });
  document.addEventListener('mouseup', () => {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();
