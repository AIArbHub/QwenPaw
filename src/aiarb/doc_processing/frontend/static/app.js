// AI Arb文档处理前端JavaScript - 接入真实后端 API 版本

const API_BASE = '/doc';
let selectedFiles = [];
let currentTaskId = null;
let pollTimer = null;

// Tab导航
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(tabName + 'Tab').classList.add('active');
    if (event) event.target.classList.add('active');
}

function showResultTab(tabName) {
    document.querySelectorAll('.result-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(tabName + 'Tab').classList.add('active');
    if (event) event.target.classList.add('active');
}

// 文件上传处理
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const fileList = document.getElementById('fileList');
const selectedFilesEl = document.getElementById('selectedFiles');

if (uploadArea) {
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files);
        addFiles(files);
    });
}

if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        addFiles(files);
    });
}

function addFiles(files) {
    files.forEach(file => {
        if (!selectedFiles.find(f => f.name === file.name && f.size === file.size)) {
            selectedFiles.push(file);
        }
    });
    updateFileList();
}

function updateFileList() {
    if (!fileList) return;
    if (selectedFiles.length === 0) {
        fileList.style.display = 'none';
        return;
    }
    selectedFilesEl.innerHTML = '';
    selectedFiles.forEach((file, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="file-icon ${getFileType(file.name)}">📄</span>
            ${file.name} 
            <small>(${(file.size / 1024 / 1024).toFixed(2)} MB)</small>
            <button class="btn-secondary" style="float:right;font-size:11px;padding:2px 8px;" onclick="removeFile(${index})">删除</button>
        `;
        selectedFilesEl.appendChild(li);
    });
    fileList.style.display = 'block';
}

function getFileType(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    switch (ext) {
        case 'pdf': return 'pdf';
        case 'docx': case 'doc': return 'docx';
        case 'xlsx': case 'xls': return 'xlsx';
        case 'pptx': case 'ppt': return 'pptx';
        case 'png': case 'jpg': case 'jpeg': case 'gif': return 'image';
        default: return '';
    }
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    updateFileList();
}

function clearFiles() {
    selectedFiles = [];
    if (fileInput) fileInput.value = '';
    updateFileList();
}

// 处理策略说明
const engineStrategy = document.getElementById('engineStrategy');
const strategyNote = document.getElementById('strategyNote');
const strategyDescriptions = {
    'local_only': '所有处理均在本地完成，数据不离开您的电脑',
    'hybrid': '优先本地处理，需要时自动切换到云端',
    'cloud_only': '全部走云端处理，需要配置云端组件'
};
if (engineStrategy) {
    engineStrategy.addEventListener('change', function() {
        if (strategyNote) strategyNote.textContent = strategyDescriptions[this.value] || '';
    });
}

// 开始处理 - 接入真实后端 API
async function startProcessing() {
    if (selectedFiles.length === 0) {
        alert('请先选择文件');
        return;
    }
    
    showProgressDialog();
    updateProgress(5, '准备中...');
    
    const strategy = (document.getElementById('engineStrategy') || {}).value || 'local_only';
    const autoOcr = document.getElementById('autoOcr') ? document.getElementById('autoOcr').checked : false;
    const enableRedaction = document.getElementById('enableRedaction') ? document.getElementById('enableRedaction').checked : false;
    const outputFormat = document.getElementById('outputFormat') ? document.getElementById('outputFormat').value : 'text';
    const autoConfirmCloud = document.getElementById('autoConfirmCloud') ? document.getElementById('autoConfirmCloud').checked : false;
    
    try {
        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            updateProgress(Math.round((i / selectedFiles.length) * 100), `正在提交: ${file.name}`);
            
            const formData = new FormData();
            formData.append('file_path', file.name);
            formData.append('auto_ocr', autoOcr.toString());
            formData.append('enable_redaction', enableRedaction.toString());
            formData.append('engine_strategy', strategy);
            formData.append('output_format', outputFormat);
            formData.append('advanced_features', 'false');
            formData.append('auto_confirm_cloud', autoConfirmCloud.toString());
            
            const resp = await fetch(`${API_BASE}/parse`, {
                method: 'POST',
                body: formData
            });
            
            const data = await resp.json();
            
            if (data.success && data.task_id) {
                currentTaskId = data.task_id;
                await pollTaskStatus(data.task_id, i, selectedFiles.length);
            } else {
                throw new Error(data.detail || data.error || '提交解析任务失败');
            }
        }
        
        updateProgress(100, '处理完成');
        hideProgressDialog();
        showNotification('处理完成', 'success');
        
    } catch (error) {
        console.error('处理失败:', error);
        hideProgressDialog();
        alert('处理失败: ' + error.message);
    }
}

// 轮询任务状态 - 接入真实 API
async function pollTaskStatus(taskId, fileIndex, totalFiles) {
    const maxAttempts = 120;
    let attempts = 0;
    
    return new Promise((resolve, reject) => {
        const poll = async () => {
            attempts++;
            if (attempts > maxAttempts) {
                reject(new Error('任务超时'));
                return;
            }
            
            try {
                const resp = await fetch(`${API_BASE}/status/${taskId}`);
                if (resp.ok) {
                    const status = await resp.json();
                    const baseProgress = Math.round((fileIndex / totalFiles) * 100);
                    const fileProgress = Math.round((status.progress / 100) * (100 / totalFiles));
                    const totalProgress = Math.min(baseProgress + fileProgress, 100);
                    
                    if (status.status === 'completed') {
                        updateProgress(totalProgress, `文件 ${fileIndex + 1}/${totalFiles} 处理完成`);
                        await fetchAndShowResult(taskId);
                        resolve();
                        return;
                    } else if (status.status === 'failed') {
                        reject(new Error(status.error || '处理失败'));
                        return;
                    } else if (status.status === 'requires_confirmation') {
                        reject(new Error(status.error || '需要确认云端处理'));
                        return;
                    }
                    
                    updateProgress(totalProgress, `正在处理文件 ${fileIndex + 1}/${totalFiles}... (${status.progress.toFixed(0)}%)`);
                }
                pollTimer = setTimeout(poll, 2000);
            } catch (e) {
                reject(e);
            }
        };
        poll();
    });
}

// 获取并显示结果 - 接入真实 API
async function fetchAndShowResult(taskId) {
    try {
        const resp = await fetch(`${API_BASE}/result/${taskId}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.success && data.result) {
            const result = data.result;
            const extractedText = result.text || result.markdown || '（无文本内容）';
            const origEl = document.getElementById('originalPreview');
            const resultEl = document.getElementById('extractedResult');
            if (origEl) origEl.textContent = extractedText;
            if (resultEl) resultEl.textContent = result.markdown || extractedText;
            
            const metadata = document.getElementById('metadataInfo');
            if (metadata) {
                const engineInfo = result.engine_info || {};
                metadata.innerHTML = `
                    <dt>处理引擎</dt><dd>${engineInfo.engine || 'basic_parser'}</dd>
                    <dt>文档类型</dt><dd>${engineInfo.document_type || '未知'}</dd>
                    <dt>处理策略</dt><dd>${engineInfo.routing_reason || 'local_only'}</dd>
                    <dt>处理时间</dt><dd>${new Date().toLocaleString()}</dd>
                    <dt>是否云端处理</dt><dd>${engineInfo.engine && engineInfo.engine.includes('cloud') ? '是 ☁️' : '否 🔒'}</dd>
                    <dt>页面数量</dt><dd>${result.metadata?.page_count || '未知'}</dd>
                    <dt>表格数量</dt><dd>${result.tables?.length || 0} 个</dd>
                `;
            }
            const resultsSection = document.getElementById('resultsSection');
            if (resultsSection) resultsSection.style.display = 'block';
        }
    } catch (e) { console.error('获取结果失败:', e); }
}

function copyResult() {
    const el = document.getElementById('extractedResult');
    if (!el) return;
    navigator.clipboard.writeText(el.textContent).then(() => showNotification('已复制到剪贴板', 'success')).catch(() => alert('复制失败，请手动复制'));
}

function downloadResult() {
    if (!currentTaskId) { showNotification('无可用任务结果', 'warning'); return; }
    window.open(`${API_BASE}/download/${currentTaskId}/text`, '_blank');
}

function showProgressDialog() { const el = document.getElementById('progressOverlay'); if (el) el.style.display = 'flex'; }
function hideProgressDialog() { const el = document.getElementById('progressOverlay'); if (el) el.style.display = 'none'; }
function cancelProcessing() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } hideProgressDialog(); }
function updateProgress(progress, text) { const f=document.getElementById('progressFill'), p=document.getElementById('progressText'); if(f) f.style.width=progress+'%'; if(p) p.textContent=text; }

function showNotification(message, type='info') {
    const n=document.createElement('div');
    n.style.cssText=`position:fixed;top:20px;right:20px;background:${type==='success'?'#10b981':type==='error'?'#ef4444':type==='warning'?'#f59e0b':'#3b82f6'};color:white;padding:12px 24px;border-radius:6px;z-index:9999;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 0.3s ease;`;
    n.textContent=message; document.body.appendChild(n);
    setTimeout(()=>{n.style.opacity='0';setTimeout(()=>n.remove(),300);},3000);
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('AI Arb文档处理前端已加载');
    if (strategyNote && engineStrategy) strategyNote.textContent = strategyDescriptions[engineStrategy.value] || '';
    if (!window.fetch) alert('您的浏览器版本过旧，请升级浏览器后使用');
});