// UI 渲染：统计、列表、提示、toast、模式切换、视角跳转交互。
import { state, round, escapeHtml, firstUncollectedIndex } from './state.js';
import { hint, readout, controls } from './scene.js';
// 循环 import：selectItem 在事件回调里调用 flyToLocalCoord，彼时模块已加载完成。
import { flyToLocalCoord, rebuildMarkers, refreshMarkerColors, clearMarkerMeshes, removeMarker } from './loader.js';
import { saveDraft } from './state.js';

const listEl = document.getElementById('list');
const listFoot = document.getElementById('listFoot');
const toastEl = document.getElementById('toast');
const listAction = document.getElementById('listAction');
const listActionCount = document.getElementById('listActionCount');
const btnSelectAll = document.getElementById('btnSelectAll');

// ---------------------------------------------------------------------------
// 模式切换
// ---------------------------------------------------------------------------
export function setMode(mode) {
  state.mode = mode;
  document.getElementById('modeCollect').classList.toggle('active', mode === 'collect');
  document.getElementById('modeBrowse').classList.toggle('active', mode === 'browse');
  renderList();
  updateHint();
}

export function getMode() {
  return state.mode;
}

// ---------------------------------------------------------------------------
// 统一渲染
// ---------------------------------------------------------------------------
export function renderAll() {
  renderStats();
  renderList();
  updateHint();
}

export function renderStats() {
  const done = state.structures.filter(item => item.center).length;
  document.getElementById('statTotal').textContent = state.structures.length;
  document.getElementById('statDone').textContent = done;
  document.getElementById('statLeft').textContent = Math.max(state.structures.length - done, 0);
}

// 列表点击用事件委托：复选框单独处理，其余点击走选中。
listEl.addEventListener('click', (event) => {
  const checkbox = event.target.closest('input[data-check]');
  if (checkbox) {
    toggleSelect(Number(checkbox.dataset.index), checkbox.checked);
    return;
  }
  const li = event.target.closest('li[data-index]');
  if (!li) return;
  selectItem(Number(li.dataset.index));
});

export function renderList() {
  const query = document.getElementById('search').value.trim().toLowerCase();
  const items = [];
  let visible = 0;
  state.structures.forEach((item, index) => {
    if (query && !item.name.toLowerCase().includes(query)) return;
    visible++;
    const classes = `item ${item.center ? 'done' : ''} ${index === state.activeIndex ? 'active' : ''}`.trim();
    const coord = item.center ? `[${item.center.map(v => Number(v).toFixed(4)).join(', ')}]` : '未采集';
    const title = [item.name, item.size_real, item.count, item.note].filter(Boolean).join('\n');
    const checked = state.selected.has(index) ? 'checked' : '';
    items.push(
      `<li class="${classes}" data-index="${index}" title="${escapeHtml(title)}">` +
      `<input type="checkbox" class="row-check" data-check="${index}" ${checked} title="勾选以批量清空坐标">` +
      `<span class="idx">${index + 1}</span>` +
      `<span class="name">${escapeHtml(item.name)}<span class="coord">${coord}</span></span>` +
      `<span class="badge">${item.center ? '完成' : '待点'}</span>` +
      `</li>`
    );
  });
  listEl.innerHTML = items.join('');
  const done = state.structures.filter(item => item.center).length;
  listFoot.textContent = `当前显示 ${visible}/${state.structures.length} 项，已采集 ${done} 项`;
  updateListAction();
}

// 切换某项勾选状态，刷新底部操作条。
function toggleSelect(index, checked) {
  if (checked) state.selected.add(index);
  else state.selected.delete(index);
  updateListAction();
}

export function updateListAction() {
  const count = state.selected.size;
  listAction.hidden = count === 0;
  listActionCount.textContent = `已选 ${count} 项`;
  // 仅显示项参与全选，避免误操作不可见项。
  const visibleTotal = state.structures.length;
  btnSelectAll.textContent = (count >= visibleTotal && count > 0) ? '取消全选' : '全选';
}

function selectItem(index) {
  state.activeIndex = index;
  if (state.mode === 'browse' && state.structures[index]?.center) {
    flyToLocalCoord(state.structures[index].center);
  }
  if (state.mode === 'collect' && state.structures[index]?.center) {
    flyToLocalCoord(state.structures[index].center, 1.2);
  }
  refreshMarkerColors();
  renderAll();
}

// ---------------------------------------------------------------------------
// 提示文案（通用化：不再引用具体模型文件名）
// ---------------------------------------------------------------------------
export function updateHint() {
  const active = state.structures[state.activeIndex];
  if (!state.modelRoot && !state.structures.length) {
    hint.innerHTML = '欢迎使用。点击 <b>选择 GLB 模型</b> 或拖入模型文件，再导入名称清单即可开始。';
    return;
  }
  if (!state.modelRoot) {
    hint.innerHTML = '请加载 GLB 模型：点击 <b>选择 GLB 模型</b>，或将 .glb 文件拖入窗口。';
    return;
  }
  if (!state.structures.length) {
    hint.innerHTML = '模型已就绪。请 <b>导入 JSON 清单</b>，或 <b>粘贴名称列表</b>（一行一个名称）。';
    return;
  }
  if (state.mode === 'collect') {
    hint.innerHTML = active
      ? `采集模式：当前选中 <b>${escapeHtml(active.name)}</b>。在模型对应位置单击，坐标会写入该名称并自动跳到下一个。`
      : '采集模式：全部名称已经有坐标，可以导出坐标 JSON。';
  } else {
    hint.innerHTML = '浏览模式：点击左侧名称，相机会飞到已采集坐标。没有坐标的名称需要回到采集模式补点。';
  }
}

export function setProgress(text) {
  hint.innerHTML = escapeHtml(text);
}

// ---------------------------------------------------------------------------
// toast
// ---------------------------------------------------------------------------
let toastTimer = null;
export function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.style.borderColor = isError ? 'rgba(239,107,115,.55)' : 'rgba(255,255,255,.14)';
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------------------
// 清空：弹对话框选范围（仅坐标 / 全部）
// ---------------------------------------------------------------------------
const clearDialog = document.getElementById('clearDialog');

export function clearCoordinates() {
  if (!state.structures.length) {
    showToast('当前没有名称列表，无需清空', true);
    return;
  }
  clearDialog.showModal();
}

// 仅清空坐标，保留名称列表，可重新采集。
export function clearCoordsOnly() {
  state.structures.forEach(item => {
    item.center = null;
    item.status = '待采集';
  });
  state.selected.clear();
  state.activeIndex = state.structures.length ? 0 : -1;
  clearMarkerMeshes();
  state.dirty = true;
  saveDraft();
  renderAll();
  showToast('坐标已清空，名称列表保留');
}

// 清空名称列表与坐标，回到空白工作台（已加载的模型保留）。
export function clearAll() {
  state.structures = [];
  state.activeIndex = -1;
  state.selected.clear();
  state.migrationBackup = null;
  clearMarkerMeshes();
  state.dirty = true;
  saveDraft();
  renderAll();
  showToast('名称列表与坐标已清空');
}

// 清空勾选项的坐标（保留名称本身），便于重新采集这几个点。
export function clearSelectedCoords() {
  if (!state.selected.size) {
    showToast('请先在列表勾选要清空的名称', true);
    return;
  }
  const indices = [...state.selected];
  let cleared = 0;
  for (const index of indices) {
    const item = state.structures[index];
    if (!item) continue;
    if (item.center) {
      item.center = null;
      item.status = '待采集';
      removeMarker(index);
      cleared++;
    }
  }
  state.selected.clear();
  if (state.activeIndex < 0) state.activeIndex = firstUncollectedIndex();
  state.dirty = true;
  saveDraft();
  renderAll();
  showToast(cleared ? `已清空 ${cleared} 个选中名称的坐标` : '所选名称本来就没有坐标');
}

// 全选 / 取消全选（作用于当前列表的全部项）。
export function selectAll() {
  if (state.selected.size >= state.structures.length) {
    state.selected.clear();
  } else {
    state.selected = new Set(state.structures.map((_, i) => i));
  }
  renderList();
}

export function clearSelection() {
  state.selected.clear();
  renderList();
}

export { rebuildMarkers };
