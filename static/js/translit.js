        // 规则表来自 manju-rules.js（全站唯一来源，/translit/ 与 /translate/ 共用）。
        // 修改规则请改 static/js/manju-rules.js，切勿在本文件再内联一份。
        const u = window.ManjuRules.u;
        const MANJU_TO_LATIN_RULES = window.ManjuRules.MANJU_TO_LATIN_RULES;
        const LATIN_TO_MANJU_RULES = window.ManjuRules.LATIN_TO_MANJU_RULES;
        const applyRules = window.ManjuRules.applyRules;

        let currentMode = 'to-latin';
        window.setMode = function(mode) {
            currentMode = mode;
            document.querySelectorAll('.mode-btn').forEach(function(btn) {
                btn.classList.toggle('active', btn.dataset.mode === mode);
            });
            const labelInput = document.getElementById('label-input');
            const labelOutput = document.getElementById('label-output');
            const input = document.getElementById('input');
            const output = document.getElementById('output');
            if (mode === 'to-latin') {
                labelInput.textContent = '满文输入'; labelOutput.textContent = '拉丁转写';
                input.placeholder = '在此输入满文 Unicode 文本...';
                output.placeholder = '转换结果将显示在这里...';
                // 输入框竖排(满文)，输出框横排(拉丁)
                input.className = 'vertical-mode';
                output.className = 'horizontal-mode';
                output.readOnly = true;
            } else {
                labelInput.textContent = '拉丁输入'; labelOutput.textContent = '满文输出';
                input.placeholder = '在此输入拉丁转写文本...';
                output.placeholder = '转换结果将显示在这里...';
                // 输入框横排(拉丁)，输出框竖排(满文)
                input.className = 'horizontal-mode';
                output.className = 'vertical-mode';
                output.readOnly = true;
            }
            document.getElementById('output').value = '';
            updateStats();
        };

        window.convert = function() {
            const input = document.getElementById('input').value;
            if (!input.trim()) { showToast('请输入要转换的文本'); return; }
            let result;
            if (currentMode === 'to-latin') result = applyRules(input, MANJU_TO_LATIN_RULES);
            else result = applyRules(input, LATIN_TO_MANJU_RULES);
            document.getElementById('output').value = result;
            updateStats();
            showToast('转换完成');
        };

        window.swapText = function() {
            const input = document.getElementById('input');
            const output = document.getElementById('output');
            const temp = input.value; input.value = output.value; output.value = temp;
            updateStats();
            setMode(currentMode === 'to-latin' ? 'to-manju' : 'to-latin');
        };
        window.clearInput = function() { document.getElementById('input').value = ''; updateStats(); };
        window.clearOutput = function() { document.getElementById('output').value = ''; updateStats(); };
        window.pasteInput = async function() {
            try { const text = await navigator.clipboard.readText(); document.getElementById('input').value = text; updateStats(); showToast('已粘贴'); }
            catch (err) { showToast('无法访问剪贴板，请手动粘贴'); }
        };
        window.copyOutput = async function() {
            const output = document.getElementById('output');
            if (!output.value) { showToast('没有可复制的内容'); return; }
            try { await navigator.clipboard.writeText(output.value); showToast('已复制到剪贴板'); }
            catch (err) { output.select(); document.execCommand('copy'); showToast('已复制到剪贴板'); }
        };
        function updateStats() {
            document.getElementById('input-stats').textContent = document.getElementById('input').value.length + ' 字符';
            document.getElementById('output-stats').textContent = document.getElementById('output').value.length + ' 字符';
        }
        function showToast(message) {
            const toast = document.getElementById('toast');
            toast.textContent = message; toast.classList.add('show');
            setTimeout(function() { toast.classList.remove('show'); }, 2000);
        }
        document.getElementById('input').addEventListener('input', updateStats);
        document.getElementById('output').addEventListener('input', updateStats);
        document.addEventListener('keydown', function(e) { if (e.ctrlKey && e.key === 'Enter') convert(); });

        // ==================== ZIP 工具 ====================
        const CRC32_TABLE = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            CRC32_TABLE[i] = c;
        }
        function crc32Bytes(bytes) {
            let crc = ~0;
            for (let i = 0; i < bytes.length; i++) crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
            return ~0 ^ crc;
        }

        function createZip(files) {
            let centralDir = [], localFiles = [], offset = 0;
            for (const file of files) {
                const nameBytes = new TextEncoder().encode(file.name);
                const content = file.content instanceof Uint8Array ? file.content : new TextEncoder().encode(file.content);
                const uncompressedSize = content.length;
                const crc = crc32Bytes(content);

                const localHeader = new Uint8Array(30 + nameBytes.length);
                let p = 0;
                localHeader[p++] = 0x50; localHeader[p++] = 0x4B; localHeader[p++] = 0x03; localHeader[p++] = 0x04;
                localHeader[p++] = 20; localHeader[p++] = 0;
                localHeader[p++] = 0; localHeader[p++] = 0;
                localHeader[p++] = 0; localHeader[p++] = 0;
                localHeader[p++] = 0; localHeader[p++] = 0;
                localHeader[p++] = 0; localHeader[p++] = 0;
                localHeader[p++] = crc & 0xFF; localHeader[p++] = (crc >> 8) & 0xFF; localHeader[p++] = (crc >> 16) & 0xFF; localHeader[p++] = (crc >> 24) & 0xFF;
                localHeader[p++] = uncompressedSize & 0xFF; localHeader[p++] = (uncompressedSize >> 8) & 0xFF; localHeader[p++] = (uncompressedSize >> 16) & 0xFF; localHeader[p++] = (uncompressedSize >> 24) & 0xFF;
                localHeader[p++] = uncompressedSize & 0xFF; localHeader[p++] = (uncompressedSize >> 8) & 0xFF; localHeader[p++] = (uncompressedSize >> 16) & 0xFF; localHeader[p++] = (uncompressedSize >> 24) & 0xFF;
                localHeader[p++] = nameBytes.length & 0xFF; localHeader[p++] = (nameBytes.length >> 8) & 0xFF;
                localHeader[p++] = 0; localHeader[p++] = 0;
                localHeader.set(nameBytes, p);

                localFiles.push(localHeader);
                localFiles.push(content);

                const centralHeader = new Uint8Array(46 + nameBytes.length);
                p = 0;
                centralHeader[p++] = 0x50; centralHeader[p++] = 0x4B; centralHeader[p++] = 0x01; centralHeader[p++] = 0x02;
                centralHeader[p++] = 20; centralHeader[p++] = 0;
                centralHeader[p++] = 20; centralHeader[p++] = 0;
                centralHeader[p++] = 0; centralHeader[p++] = 0;
                centralHeader[p++] = 0; centralHeader[p++] = 0;
                centralHeader[p++] = 0; centralHeader[p++] = 0;
                centralHeader[p++] = 0; centralHeader[p++] = 0;
                centralHeader[p++] = crc & 0xFF; centralHeader[p++] = (crc >> 8) & 0xFF; centralHeader[p++] = (crc >> 16) & 0xFF; centralHeader[p++] = (crc >> 24) & 0xFF;
                centralHeader[p++] = uncompressedSize & 0xFF; centralHeader[p++] = (uncompressedSize >> 8) & 0xFF; centralHeader[p++] = (uncompressedSize >> 16) & 0xFF; centralHeader[p++] = (uncompressedSize >> 24) & 0xFF;
                centralHeader[p++] = uncompressedSize & 0xFF; centralHeader[p++] = (uncompressedSize >> 8) & 0xFF; centralHeader[p++] = (uncompressedSize >> 16) & 0xFF; centralHeader[p++] = (uncompressedSize >> 24) & 0xFF;
                centralHeader[p++] = nameBytes.length & 0xFF; centralHeader[p++] = (nameBytes.length >> 8) & 0xFF;
                centralHeader[p++] = 0; centralHeader[p++] = 0;
                centralHeader[p++] = 0; centralHeader[p++] = 0;
                centralHeader[p++] = 0; centralHeader[p++] = 0;
                centralHeader[p++] = 0; centralHeader[p++] = 0; centralHeader[p++] = 0; centralHeader[p++] = 0;
                centralHeader[p++] = offset & 0xFF; centralHeader[p++] = (offset >> 8) & 0xFF; centralHeader[p++] = (offset >> 16) & 0xFF; centralHeader[p++] = (offset >> 24) & 0xFF;
                centralHeader.set(nameBytes, p);
                centralDir.push(centralHeader);
                offset += localHeader.length + content.length;
            }
            const centralDirSize = centralDir.reduce((s, h) => s + h.length, 0);
            const centralDirOffset = offset;
            const eocd = new Uint8Array(22);
            let p = 0;
            eocd[p++] = 0x50; eocd[p++] = 0x4B; eocd[p++] = 0x05; eocd[p++] = 0x06;
            eocd[p++] = 0; eocd[p++] = 0;
            eocd[p++] = 0; eocd[p++] = 0;
            eocd[p++] = files.length & 0xFF; eocd[p++] = (files.length >> 8) & 0xFF;
            eocd[p++] = files.length & 0xFF; eocd[p++] = (files.length >> 8) & 0xFF;
            eocd[p++] = centralDirSize & 0xFF; eocd[p++] = (centralDirSize >> 8) & 0xFF; eocd[p++] = (centralDirSize >> 16) & 0xFF; eocd[p++] = (centralDirSize >> 24) & 0xFF;
            eocd[p++] = centralDirOffset & 0xFF; eocd[p++] = (centralDirOffset >> 8) & 0xFF; eocd[p++] = (centralDirOffset >> 16) & 0xFF; eocd[p++] = (centralDirOffset >> 24) & 0xFF;
            eocd[p++] = 0; eocd[p++] = 0;
            let totalSize = localFiles.reduce((s, f) => s + f.length, 0) + centralDirSize + eocd.length;
            let result = new Uint8Array(totalSize);
            let pos = 0;
            for (const f of localFiles) { result.set(f, pos); pos += f.length; }
            for (const h of centralDir) { result.set(h, pos); pos += h.length; }
            result.set(eocd, pos);
            return result;
        }

        async function parseZipAsync(data) {
            const files = {};
            let pos = 0;
            while (pos < data.length - 30) {
                if (data[pos] !== 0x50 || data[pos+1] !== 0x4B || data[pos+2] !== 0x03 || data[pos+3] !== 0x04) {
                    pos++;
                    continue;
                }
                const method = data[pos+8] | (data[pos+9] << 8);
                const compressedSize = data[pos+18] | (data[pos+19] << 8) | (data[pos+20] << 16) | (data[pos+21] << 24);
                const uncompressedSize = data[pos+22] | (data[pos+23] << 8) | (data[pos+24] << 16) | (data[pos+25] << 24);
                const nameLen = data[pos+26] | (data[pos+27] << 8);
                const extraLen = data[pos+28] | (data[pos+29] << 8);
                const name = new TextDecoder().decode(data.slice(pos+30, pos+30+nameLen));
                const contentOffset = pos + 30 + nameLen + extraLen;

                let content;
                if (method === 0) {
                    content = data.slice(contentOffset, contentOffset + uncompressedSize);
                } else if (method === 8) {
                    const compressed = data.slice(contentOffset, contentOffset + compressedSize);
                    try {
                        const ds = new DecompressionStream('deflate-raw');
                        const writer = ds.writable.getWriter();
                        const reader = ds.readable.getReader();
                        writer.write(compressed);
                        writer.close();
                        const chunks = [];
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            chunks.push(value);
                        }
                        let totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                        content = new Uint8Array(totalLength);
                        let offset = 0;
                        for (const chunk of chunks) {
                            content.set(chunk, offset);
                            offset += chunk.length;
                        }
                    } catch (e) {
                        throw new Error('解压失败：浏览器不支持 deflate-raw 解压。请使用 Chrome/Edge 80+ 或 Firefox 103+');
                    }
                } else {
                    throw new Error('不支持的压缩方法: ' + method);
                }
                files[name] = content;
                pos = contentOffset + compressedSize;
            }
            return files;
        }

        function xmlEscape(str) {
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        }

        // ==================== 逐段落处理 Word 文档 ====================
        // 关键改进：保留 <w:p> 段落结构，逐段落转换
        async function processDocxByParagraph(docxBytes, rules) {
            const files = await parseZipAsync(docxBytes);
            const docXml = files['word/document.xml'];
            if (!docXml) return null;

            let xml = new TextDecoder().decode(docXml);

            // 提取 body 内容（<w:body> 和 </w:body> 之间）
            const bodyStart = xml.indexOf('<w:body>');
            const bodyEnd = xml.lastIndexOf('</w:body>');
            if (bodyStart === -1 || bodyEnd === -1) return null;

            const header = xml.substring(0, bodyStart + 8); // 包含 <w:body>
            const footer = xml.substring(bodyEnd); // 包含 </w:body>...</w:document>
            const bodyContent = xml.substring(bodyStart + 8, bodyEnd);

            // 按 <w:p> 分割段落
            // 注意：<w:p> 可能带有命名空间前缀，如 <w:p ...>
            const paragraphs = [];
            let pPos = 0;
            while (true) {
                const pStart = bodyContent.indexOf('<w:p', pPos);
                if (pStart === -1) break;
                const pEnd = bodyContent.indexOf('</w:p>', pStart);
                if (pEnd === -1) break;
                paragraphs.push({
                    start: pStart,
                    end: pEnd + 6,
                    xml: bodyContent.substring(pStart, pEnd + 6)
                });
                pPos = pEnd + 6;
            }

            // 收集段落之间的非段落内容（如 <w:sectPr> 等）
            let nonParagraphParts = [];
            let lastEnd = 0;
            for (const para of paragraphs) {
                if (para.start > lastEnd) {
                    nonParagraphParts.push(bodyContent.substring(lastEnd, para.start));
                }
                lastEnd = para.end;
            }
            if (lastEnd < bodyContent.length) {
                nonParagraphParts.push(bodyContent.substring(lastEnd));
            }

            // 逐段落转换
            const convertedParagraphs = [];
            for (let i = 0; i < paragraphs.length; i++) {
                const para = paragraphs[i];
                // 提取段落中的所有 <w:t> 文本
                const texts = [];
                const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
                let match;
                while ((match = tRegex.exec(para.xml)) !== null) texts.push(match[1]);
                const paraText = texts.join('');

                // 转换文本
                const convertedText = applyRules(paraText, rules);

                // 重建段落 XML
                let newParaXml;
                if (convertedText === '') {
                    // 如果转换后为空，保留原段落结构但清空文本
                    newParaXml = para.xml.replace(/<w:t[^>]*>[^<]*<\/w:t>/g, function(m) {
                        const tagMatch = m.match(/(<w:t[^>]*>)[^<]*(<\/w:t>)/);
                        return tagMatch ? tagMatch[1] + '' + tagMatch[2] : m;
                    });
                } else {
                    // 找到第一个 <w:r> 包含 <w:t> 的位置，替换其内容
                    // 简化策略：保留段落属性和第一个 run 的属性，只替换文本
                    const firstTMatch = para.xml.match(/(<w:r(?:[^>]*?)>(?:.*?)<w:t(?:[^>]*?)>)[^<]*(<\/w:t>(?:.*?)<\/w:r>)/);
                    if (firstTMatch) {
                        // 保留第一个 <w:r>...<w:t>...</w:t>...</w:r>，替换文本
                        const beforeFirstR = para.xml.substring(0, para.xml.indexOf(firstTMatch[0]));
                        const afterFirstR = para.xml.substring(para.xml.indexOf(firstTMatch[0]) + firstTMatch[0].length);
                        newParaXml = beforeFirstR + firstTMatch[1] + xmlEscape(convertedText) + firstTMatch[2] + afterFirstR;
                        // 删除其他 <w:r> 中的文本（保留空的 run 结构或删除）
                        // 更简单的做法：删除所有其他的 <w:r>...</w:r>
                        newParaXml = newParaXml.replace(/<w:r>.*?<\/w:r>/g, function(m, offset, string) {
                            // 如果这不是第一个 run（包含我们替换的文本），删除它
                            if (string.indexOf(firstTMatch[0]) !== -1 && offset > string.indexOf(firstTMatch[0])) {
                                return '';
                            }
                            return m;
                        });
                    } else {
                        // 回退：直接替换所有 <w:t> 的内容
                        let first = true;
                        newParaXml = para.xml.replace(/<w:t[^>]*>[^<]*<\/w:t>/g, function(m) {
                            if (first) {
                                first = false;
                                const tagMatch = m.match(/(<w:t[^>]*>)[^<]*(<\/w:t>)/);
                                return tagMatch ? tagMatch[1] + xmlEscape(convertedText) + tagMatch[2] : m;
                            }
                            return '';
                        });
                    }
                }
                convertedParagraphs.push(newParaXml);
            }

            // 重建 body
            let newBody = '';
            for (let i = 0; i < convertedParagraphs.length; i++) {
                if (nonParagraphParts[i]) newBody += nonParagraphParts[i];
                newBody += convertedParagraphs[i];
            }
            if (nonParagraphParts[convertedParagraphs.length]) {
                newBody += nonParagraphParts[convertedParagraphs.length];
            }

            const newXml = header + newBody + footer;

            // 重新打包
            const newFiles = [];
            for (const name in files) {
                if (name === 'word/document.xml') {
                    newFiles.push({ name: name, content: new TextEncoder().encode(newXml) });
                } else {
                    newFiles.push({ name: name, content: files[name] });
                }
            }
            return createZip(newFiles);
        }

        // ==================== 生成新的 .docx ====================
        function createDocxBlob(text, title) {
            const escapedText = xmlEscape(text);
            const escapedTitle = xmlEscape(title || '转换结果');
            const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
            const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
    <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
            const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <w:body>
        <w:p>
            <w:pPr>
                <w:pStyle w:val="Title"/>
                <w:jc w:val="center"/>
            </w:pPr>
            <w:r>
                <w:rPr>
                    <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:cs="Microsoft YaHei"/>
                    <w:b/>
                    <w:sz w:val="32"/>
                </w:rPr>
                <w:t>${escapedTitle}</w:t>
            </w:r>
        </w:p>
        <w:p>
            <w:pPr>
                <w:spacing w:line="360" w:lineRule="auto"/>
            </w:pPr>
            <w:r>
                <w:rPr>
                    <w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:cs="Microsoft YaHei"/>
                    <w:sz w:val="24"/>
                </w:rPr>
                <w:t>${escapedText}</w:t>
            </w:r>
        </w:p>
        <w:sectPr>
            <w:pgSz w:w="11906" w:h="16838"/>
            <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
        </w:sectPr>
    </w:body>
</w:document>`;
            const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;
            const files = [
                { name: '[Content_Types].xml', content: contentTypes },
                { name: '_rels/.rels', content: rels },
                { name: 'word/_rels/document.xml.rels', content: docRels },
                { name: 'word/document.xml', content: document }
            ];
            return createZip(files);
        }

        window.downloadCurrentWord = function() {
            const output = document.getElementById('output').value;
            if (!output.trim()) { showToast('没有可导出的内容，请先执行转换'); return; }
            const modeStr = currentMode === 'to-latin' ? '满文转拉丁' : '拉丁转满文';
            const filename = 'converted_' + modeStr + '_' + new Date().getTime() + '.docx';
            const blob = createDocxBlob(output, modeStr + '转换结果');
            const url = URL.createObjectURL(new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
            const a = document.createElement('a'); a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
            showToast('Word 文档已导出');
        };

        // ==================== 文件批量处理 ====================
        let fileQueue = [];
        let processedResults = [];

        window.handleFileSelect = function(event) { addFilesToQueue(Array.from(event.target.files)); };
        window.handleFolderSelect = function(event) { addFilesToQueue(Array.from(event.target.files)); };

        function addFilesToQueue(files) {
            const textFiles = files.filter(function(f) {
                const name = f.name.toLowerCase();
                return name.endsWith('.txt') || name.endsWith('.csv') || name.endsWith('.md') ||
                       name.endsWith('.json') || name.endsWith('.xml') || name.endsWith('.html') ||
                       name.endsWith('.htm') || name.endsWith('.docx');
            });
            if (textFiles.length === 0) { showToast('未找到支持的文本文件'); return; }
            textFiles.forEach(function(file) { fileQueue.push({ file: file, name: file.name, status: 'pending', result: null, isDocx: file.name.toLowerCase().endsWith('.docx') }); });
            renderFileList();
            document.getElementById('batchActions').style.display = 'flex';
            showToast('已添加 ' + textFiles.length + ' 个文件');
        }

        function renderFileList() {
            const list = document.getElementById('fileList');
            list.innerHTML = '';
            fileQueue.forEach(function(item) {
                const div = document.createElement('div'); div.className = 'file-item';
                const statusClass = item.status === 'done' ? '' : (item.status === 'error' ? 'error' : 'pending');
                const statusText = item.status === 'done' ? '✓ 完成' : (item.status === 'error' ? '✗ 失败' : '○ 待处理');
                const typeLabel = item.isDocx ? ' [Word]' : '';
                div.innerHTML = '<span class="name">' + escapeHtml(item.name) + typeLabel + '</span><span class="status ' + statusClass + '">' + statusText + '</span>';
                list.appendChild(div);
            });
        }
        function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }

        window.processFiles = async function() {
            if (fileQueue.length === 0) { showToast('没有待处理的文件'); return; }
            const progressBar = document.getElementById('progressBar');
            const progressFill = document.getElementById('progressFill');
            const processBtn = document.getElementById('processBtn');
            progressBar.classList.add('active'); processBtn.disabled = true;
            processedResults = [];
            for (let i = 0; i < fileQueue.length; i++) {
                const item = fileQueue[i]; item.status = 'pending';
                try {
                    let result;
                    if (item.isDocx) {
                        const arrayBuffer = await item.file.arrayBuffer();
                        const bytes = new Uint8Array(arrayBuffer);
                        const rules = currentMode === 'to-latin' ? MANJU_TO_LATIN_RULES : LATIN_TO_MANJU_RULES;
                        const newDocx = await processDocxByParagraph(bytes, rules);
                        if (!newDocx) { throw new Error('无法处理 Word 文档'); }
                        item.convertedDocx = newDocx;
                        item.status = 'done';
                        processedResults.push({ name: item.name, isDocx: true, docxBytes: newDocx });
                    } else {
                        const text = await readFileAsText(item.file);
                        if (currentMode === 'to-latin') result = applyRules(text, MANJU_TO_LATIN_RULES);
                        else result = applyRules(text, LATIN_TO_MANJU_RULES);
                        item.result = result; item.status = 'done';
                        processedResults.push({ name: item.name, content: result, isDocx: false });
                    }
                } catch (err) { 
                    console.error('处理文件出错:', err);
                    item.status = 'error'; item.result = null; 
                }
                renderFileList();
                progressFill.style.width = ((i + 1) / fileQueue.length * 100) + '%';
            }
            progressBar.classList.remove('active'); progressFill.style.width = '0%';
            processBtn.disabled = false;
            if (processedResults.length > 0) {
                document.getElementById('wordBtn').style.display = 'inline-block';
                document.getElementById('txtBtn').style.display = 'inline-block';
                showToast('批量转换完成：' + processedResults.length + '/' + fileQueue.length + ' 成功');
            } else { showToast('所有文件处理失败'); }
        };

        function readFileAsText(file) {
            return new Promise(function(resolve, reject) {
                const reader = new FileReader();
                reader.onload = function(e) { resolve(e.target.result); };
                reader.onerror = function(e) { reject(e); };
                reader.readAsText(file, 'UTF-8');
            });
        }

        window.clearFiles = function() {
            fileQueue = []; processedResults = [];
            renderFileList();
            document.getElementById('batchActions').style.display = 'none';
            document.getElementById('wordBtn').style.display = 'none';
            document.getElementById('txtBtn').style.display = 'none';
            document.getElementById('progressFill').style.width = '0%';
            showToast('已清空文件列表');
        };

        window.downloadAll = function() {
            if (processedResults.length === 0) { showToast('没有可下载的内容'); return; }
            const txtResults = processedResults.filter(function(r) { return !r.isDocx; });
            if (txtResults.length === 0) { showToast('没有 TXT 文件可导出（Word 文件请用"导出 Word"）'); return; }
            if (txtResults.length === 1) {
                downloadTxtFile(txtResults[0].name, txtResults[0].content);
            } else {
                const files = txtResults.map(function(r) { return { name: r.name, content: r.content }; });
                const zipBlob = createZip(files);
                const url = URL.createObjectURL(new Blob([zipBlob], { type: 'application/zip' }));
                const a = document.createElement('a'); a.href = url; a.download = 'converted_files.zip';
                document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                showToast('已打包下载 ' + txtResults.length + ' 个文件');
            }
        };

        window.downloadAllWord = function() {
            if (processedResults.length === 0) { showToast('没有可导出的内容'); return; }
            const docxResults = processedResults.filter(function(r) { return r.isDocx; });
            if (docxResults.length === 0) { showToast('没有 Word 文件可导出'); return; }
            if (docxResults.length === 1) {
                const baseName = docxResults[0].name.replace(/\.[^/.]+$/, '');
                const url = URL.createObjectURL(new Blob([docxResults[0].docxBytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
                const a = document.createElement('a'); a.href = url; a.download = baseName + '_converted.docx';
                document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                showToast('Word 文档已导出');
            } else {
                showToast('正在生成 Word 文档包，请稍候...');
                const files = docxResults.map(function(r) {
                    const baseName = r.name.replace(/\.[^/.]+$/, '');
                    return { name: baseName + '_converted.docx', content: r.docxBytes };
                });
                const zipBlob = createZip(files);
                const url = URL.createObjectURL(new Blob([zipBlob], { type: 'application/zip' }));
                const a = document.createElement('a'); a.href = url; a.download = 'converted_word_files.zip';
                document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                showToast('Word 文档包已导出：' + docxResults.length + ' 个文件');
            }
        };

        function downloadTxtFile(filename, content) {
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = filename;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        }
