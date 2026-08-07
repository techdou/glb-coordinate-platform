// 全局应用状态（共享单例）+ localStorage 草稿存取 + 通用工具函数。
// 其它模块都从这里 import state 与工具函数，避免循环依赖。

export const STORAGE_KEY = 'generic_coordinate_collector_v1';
const SETTINGS_KEY = 'generic_coordinate_collector_settings_v1';

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
  dirty: false,
  // 用户偏好设置（localStorage 持久化）
  settings: loadSettings(),
  // 采点撤销栈（session 级，不持久化）：每条 { index, prevCenter }
  undoStack: [],
  // 二次确认标记：覆盖已采坐标 / Delete 清除坐标，防止误操作
  pendingOverwriteIndex: -1,
  pendingDeleteIndex: -1,
  // shift 连选的锚点（列表复选框）
  lastCheckIndex: -1
};

// ---------------------------------------------------------------------------
// 用户偏好设置（localStorage 持久化）
// ---------------------------------------------------------------------------
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    return { autoAdvance: saved?.autoAdvance !== false };   // 默认开启自动前进
  } catch {
    return { autoAdvance: true };
  }
}

export function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

// ---------------------------------------------------------------------------
// 采点撤销栈：记录每次采点/清除前的旧坐标，Ctrl+Z 逐步回退。
// 清空类操作会清栈（快照恢复语义不同，避免误恢复）。
// ---------------------------------------------------------------------------
const UNDO_LIMIT = 50;

export function pushUndo(index, prevCenter) {
  state.undoStack.push({ index, prevCenter: prevCenter ? [...prevCenter] : null });
  if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
}

export function clearUndoStack() {
  state.undoStack.length = 0;
}

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
