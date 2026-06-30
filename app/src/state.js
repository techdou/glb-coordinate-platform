// 全局应用状态（共享单例）+ localStorage 草稿存取 + 通用工具函数。
// 其它模块都从这里 import state 与工具函数，避免循环依赖。

export const STORAGE_KEY = 'generic_coordinate_collector_v1';

export const state = {
  mode: 'collect',
  structures: [],
  activeIndex: 0,
  selected: new Set(),   // 列表勾选项的 index 集合，用于选择性清空
  modelRoot: null,
  modelOriginalBox: null,
  modelBox: null,
  modelCenterOffset: null,
  modelLabel: '',
  modelFileSize: null,
  modelSha256: null,
  modelFile: null,   // 当前加载的原始 File 对象（用于导展示页打包，刷新后丢失）
  markers: new Map(),
  migrationBackup: null,
  lastPointerDown: null,
  dirty: false
};

// ---------------------------------------------------------------------------
// 草稿存取（localStorage）
// ---------------------------------------------------------------------------
export function saveDraft() {
  const payload = {
    structures: state.structures,
    activeIndex: state.activeIndex,
    modelLabel: state.modelLabel,
    modelFileSize: state.modelFileSize,
    modelSha256: state.modelSha256,
    migrationBackup: state.migrationBackup,
    savedAt: new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!draft?.structures?.length) return false;
    state.structures = draft.structures;
    state.activeIndex = Number.isInteger(draft.activeIndex) ? draft.activeIndex : firstUncollectedIndex();
    state.selected.clear();
    state.modelLabel = draft.modelLabel || '';
    state.modelFileSize = draft.modelFileSize ?? null;
    state.modelSha256 = draft.modelSha256 ?? null;
    state.migrationBackup = draft.migrationBackup || null;
    return true;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 通用工具函数
// ---------------------------------------------------------------------------
export function round(value) {
  return Math.round(Number(value) * 100000) / 100000;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function timestamp() {
  const d = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function downloadJson(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export function firstUncollectedIndex(start = 0) {
  for (let i = start; i < state.structures.length; i++) {
    if (!state.structures[i].center) return i;
  }
  for (let i = 0; i < Math.min(start, state.structures.length); i++) {
    if (!state.structures[i].center) return i;
  }
  return -1;
}
