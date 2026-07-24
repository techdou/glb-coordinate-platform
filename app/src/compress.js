// 前端 GLB 压缩：通过 /api/compress 上传到本地服务器，下载压缩结果。
import { showToast } from './ui.js';
import { timestamp } from './state.js';

// 压缩对话框的 DOM 引用与状态。
let dialogEl = null;
let inputEl = null;
let fileInputEl = null;
let nameEl = null;
let runBtn = null;
let statusEl = null;
let selectedFile = null;

// 初始化压缩对话框（由 main.js 在启动时调用一次）。
export function initCompress() {
  dialogEl = document.getElementById('compressDialog');
  inputEl = document.getElementById('compressQuality');
  fileInputEl = document.getElementById('compressInput');
  nameEl = document.getElementById('compressFileName');
  runBtn = document.getElementById('compressRun');
  statusEl = document.getElementById('compressStatus');

  document.getElementById('mCompress').addEventListener('click', openCompressDialog);
  document.getElementById('compressPick').addEventListener('click', () => fileInputEl.click());
  fileInputEl.addEventListener('change', onFilePicked);
  document.getElementById('compressCancel').addEventListener('click', () => dialogEl.close());
  runBtn.addEventListener('click', runCompress);
}

function openCompressDialog() {
  // 重置状态
  selectedFile = null;
  fileInputEl.value = '';
  nameEl.textContent = '未选择';
  runBtn.disabled = true;
  hideStatus();
  dialogEl.showModal();
}

function onFilePicked(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.glb')) {
    showToast('只支持 .glb 文件', true);
    fileInputEl.value = '';
    return;
  }
  selectedFile = file;
  nameEl.textContent = `${file.name}（${formatSize(file.size)}）`;
  runBtn.disabled = false;
  hideStatus();
}

async function runCompress() {
  if (!selectedFile) {
    showToast('请先选择 GLB 文件', true);
    return;
  }
  const quality = inputEl.value;
  // 锁定按钮，显示进度态（fetch 拿不到上传/压缩进度，用文案占位）。
  runBtn.disabled = true;
  document.getElementById('compressPick').disabled = true;
  showStatus(`正在压缩「${selectedFile.name}」...（首次会通过 npx 下载 gltf-transform，请耐心等待）`, 'progress');

  const form = new FormData();
  form.append('file', selectedFile);
  form.append('quality', quality);

  try {
    const resp = await fetch('/api/compress', { method: 'POST', body: form });
    if (!resp.ok) {
      // 错误响应是 JSON
      let msg = `服务器返回 ${resp.status}`;
      try {
        const err = await resp.json();
        msg = err.error || msg;
      } catch { /* 忽略解析失败 */
      }
      throw new Error(msg);
    }
    // 成功：读响应头里的压缩元信息 + 下载二进制
    const srcSize = resp.headers.get('X-Src-Size');
    const dstSize = resp.headers.get('X-Dst-Size');
    const ratio = resp.headers.get('X-Ratio');
    const blob = await resp.blob();
    downloadBlob(blob, `compressed_${stripExt(selectedFile.name)}_${quality}_${timestamp()}.glb`);

    const summary = srcSize && dstSize
      ? `完成：${formatSize(Number(srcSize))} → ${formatSize(Number(dstSize))}，缩减 ${ratio}%`
      : '压缩完成';
    showStatus(summary, 'success');
    showToast(summary);
  } catch (error) {
    const msg = error?.message || String(error);
    // Node.js/npx 缺失的典型错误，给出更友好的指引
    const friendly = msg.includes('gltf-transform') || msg.includes('npx')
      ? `${msg}\n\n请确认本机已安装 Node.js（自带 npx），并重启服务器后重试。`
      : msg;
    showStatus(friendly, 'error');
    showToast('压缩失败，详见对话框', true);
  } finally {
    runBtn.disabled = false;
    document.getElementById('compressPick').disabled = false;
  }
}

function showStatus(text, kind) {
  statusEl.hidden = false;
  statusEl.className = `compress-status ${kind}`;
  statusEl.textContent = text;
}

function hideStatus() {
  statusEl.hidden = true;
  statusEl.textContent = '';
}

// 把字节格式化为易读的 KB/MB。
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// 去掉文件扩展名。
function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

// 下载二进制 Blob（与 state.js 的 downloadJson 同款方式，但用于二进制）。
function downloadBlob(blob, fileName) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}
