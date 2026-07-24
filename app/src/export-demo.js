// 导展示页：把当前模型 + 坐标打包成可直接运行的 zip（index.html + data.json + model.glb）。
// 供二次开发参考：解压双击 index.html 即见"模型 + 标记点 + 侧边名称列表联动"。
import { THREE } from './scene.js';
import { state, round, escapeHtml, timestamp } from './state.js';
import { showToast } from './ui.js';
import { vectorToPlain, boxToPlain, sizeToPlain } from './export.js';

export function initExportDemo() {
  const btn = document.getElementById('mExportDemo');
  if (!btn) return;
  btn.addEventListener('click', exportDemo);
}

async function exportDemo() {
  // 1. 校验：至少要有名称列表
  const withCoords = state.structures.filter(item => item.center);
  if (!state.structures.length) {
    showToast('没有名称列表，无法导展示页', true);
    return;
  }
  if (!withCoords.length) {
    showToast('请先采集至少一个坐标点，再导展示页', true);
    return;
  }

  // 2. 收集元信息（坐标对齐所需：中心偏移、包围盒）
  const meta = {
    modelLabel: state.modelLabel || 'model.glb',
    modelFileName: (state.modelLabel || 'model.glb').split(/[\\/]/).pop(),
    hasModel: !!state.modelFile,
    coordinateSystem: 'GLB model local coordinates',
    centerOffset: vectorToPlain(state.modelCenterOffset),
    boundingBox: boxToPlain(state.modelOriginalBox),
    size: sizeToPlain(state.modelOriginalBox),
    structures: state.structures.map(item => ({
      name: item.name,
      center: item.center,
      note: item.note || null,
      size_real: item.size_real || null
    })),
    exportedAt: new Date().toISOString()
  };

  // 3. 组装 FormData，发给后端打包
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  if (state.modelFile) {
    form.append('file', state.modelFile, meta.modelFileName);
  }

  showToast('正在打包导展示页...');
  try {
    const resp = await fetch('/api/export-demo', { method: 'POST', body: form });
    if (!resp.ok) {
      let msg = `服务器返回 ${resp.status}`;
      try { const err = await resp.json(); msg = err.error || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    const blob = await resp.blob();
    downloadBlob(blob, `demo_${timestamp()}.zip`);
    const hint = meta.hasModel
      ? `已导出 ${withCoords.length} 个点位的展示页（含模型）`
      : `已导出 ${withCoords.length} 个点位的展示页（无模型，需手动放入 model.glb）`;
    showToast(hint);
  } catch (error) {
    showToast(`导展示页失败：${error?.message || error}`, true);
  }
}

// ---- 二进制下载 ----
function downloadBlob(blob, fileName) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}
