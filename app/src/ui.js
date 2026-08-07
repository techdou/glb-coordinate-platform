// UI 渲染：进度、列表、提示、toast、模式切换、目标胶囊、控件禁用矩阵、撤销。
import { state, round, escapeHtml, firstUncollectedIndex, saveDraft, pushUndo, clearUndoStack } from './state.js';
import { hint, readout, controls } from './scene.js';
// 循环 import：selectItem 在事件回调里调用 flyToLocalCoord，彼时模块已加载完成。
import { flyToLocalCoord, rebuildMarkers, refreshMarkerColors, clearMarkerMeshes, removeMarker, placeMarker } from './loader.js';

const listEl = document.getElementById('list');
const listFoot = document.getElementById('listFoot');
const toastEl = document.getElementById('toast');
const listAction = document.getElementById('listAction');
const listActionCount = document.getElementById('listActionCount');
const btnSelectAll = document.getElementById('btnSelectAll');
const targetChip = document.getElementById('targetChip');
const emptyCta = document.getElementById('emptyCta');

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
  updateTargetChip();
  refreshControlStates();
  updateEmptyState();
}

// 进度条 + 文案（替代原三统计卡：批量采集场景进度感更直观）
export function renderStats() {
  const total = state.structures.length;
  const done = state.structures.filter(item => item.center).length;
  const fill = document.getElementById('statFill');
  const label = document.getElementById('statLabel');
  if (!fill || !label) return;
  fill.style.width = total ? `${(done / total * 100).toFixed(1)}%` : '0%';
  label.textContent = total ? `已采集 ${done}/${total} · 剩余 ${total - done}` : '尚未导入清单';
}

// 当前目标胶囊：viewer 顶部居中，全应用最重要的信息给最大视觉权重。
export function updateTargetChip() {
  if (!targetChip) return;
  const total = state.structures.length;
  const active = state.structures[state.activeIndex];
  if (!total) {
    targetChip.hidden = true;
    return;
  }
  const done = state.structures.filter(item => item.center).length;
  targetChip.hidden = false;
  if (done === total) {
    // 全部采完：chip 变为完成提示，引导导出
    targetChip.dataset.state = 'all-done';
    targetChip.innerHTML = `<span class="chip-name">✓ 全部 ${total} 项已采集，可导出</span>`;
  } else if (active) {
    targetChip.dataset.state = active.center ? 'done-item' : 'active';
    targetChip.innerHTML =
      `<span class="chip-seq">${state.activeIndex + 1}/${total}</span>` +
      `<span class="chip-name">${escapeHtml(active.name)}</span>`;
  } else {
    targetChip.hidden = true;
  }
}

// 空态引导：无模型时 viewer 中央显示拖放 CTA
export function updateEmptyState() {
  if (emptyCta) emptyCta.hidden = !!state.modelRoot;
}

// 控件禁用矩阵：空态下不可用的按钮禁用并说明原因，避免裸奔。
export function refreshControlStates() {
  const hasModel = !!state.modelRoot;
  const hasList = state.structures.length > 0;
  const setDisabled = (id, disabled, tip) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = disabled;
    if (tip) el.setAttribute('data-tip', tip);
  };
  setDisabled('viewFit', !hasModel, hasModel ? '适配模型（视角复位到模型全貌）' : '请先加载模型');
  setDisabled('viewTop', !hasModel, hasModel ? '俯视（正上方视角）' : '请先加载模型');
  setDisabled('viewIso', !hasModel, hasModel ? '等轴斜视（45° 经典视角）' : '请先加载模型');
  setDisabled('btnExportMap', !hasList,
    hasList ? '导出最精简的坐标映射 {名称: [x,y,z]}，给业务系统用' : '请先导入名称清单，再导出坐标');
  setDisabled('mExportFull', !hasList, '');
  setDisabled('mExportDemo', !hasList, '');
  setDisabled('mExportDraft', !hasList, '');
  const search = document.getElementById('search');
  if (search) search.disabled = !hasList;
  const modeCollect = document.getElementById('modeCollect');
  const modeBrowse = document.getElementById('modeBrowse');
  if (modeCollect) modeCollect.disabled = !hasList;
  if (modeBrowse) modeBrowse.disabled = !hasList;
}

// 列表点击用事件委托：空态按钮、复选框（支持 shift 连选）单独处理，其余点击走选中。
listEl.addEventListener('click', (event) => {
  // 空态引导按钮：复用工具栏按钮的既有逻辑
  const emptyBtn = event.target.closest('[data-empty-action]');
  if (emptyBtn) {
    const targetId = emptyBtn.dataset.emptyAction === 'json' ? 'btnJson' : 'btnPaste';
    document.getElementById(targetId)?.click();
    return;
  }
  const checkbox = event.target.closest('input[data-check]');
  if (checkbox) {
    const index = Number(checkbox.dataset.index);
    // shift+点击：以上次勾选项为锚点做范围连选
    if (event.shiftKey && state.lastCheckIndex >= 0 && state.lastCheckIndex !== index) {
      const from = Math.min(state.lastCheckIndex, index);
      const to = Math.max(state.lastCheckIndex, index);
      for (let i = from; i <= to; i++) {
        if (checkbox.checked) state.selected.add(i);
        else state.selected.delete(i);
      }
      state.lastCheckIndex = index;
      renderList();
    } else {
      toggleSelect(index, checkbox.checked);
      state.lastCheckIndex = index;
    }
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
      `<input type="checkbox" class="row-check" data-check="${index}" ${checked} data-tip="勾选以批量清空坐标（shift+点击连选）">` +
      `<span class="idx">${index + 1}</span>` +
      `<span class="name">${escapeHtml(item.name)}<span class="coord">${coord}</span></span>` +
      `<span class="badge">${item.center ? '完成' : '待点'}</span>` +
      `</li>`
    );
  });
  // 空态：无清单时内嵌引导；搜索无结果时给出反馈（替代一块空白）
  if (!items.length) {
    listEl.innerHTML = query
      ? `<li class="list-empty">没有匹配「${escapeHtml(query)}」的名称</li>`
      : `<li class="list-empty">` +
        `<p>尚未导入名称清单</p>` +
        `<div class="list-empty-actions">` +
        `<button type="button" class="tool-btn small" data-empty-action="json">导入 JSON 清单</button>` +
        `<button type="button" class="tool-btn small" data-empty-action="paste">粘贴名称列表</button>` +
        `</div></li>`;
  } else {
    listEl.innerHTML = items.join('');
  }
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

// 选中列表项：设为激活、飞行定位、刷新 marker 颜色。供列表点击与右键选中 marker 调用。
export function selectItem(index) {
  state.activeIndex = index;
  if (state.mode === 'browse' && state.structures[index]?.center) {
    flyToLocalCoord(state.structures[index].center);
  }
  if (state.mode === 'collect' && state.structures[index]?.center) {
    flyToLocalCoord(state.structures[index].center, 1.2);
  }
  refreshMarkerColors();
  renderAll();
  scrollActiveIntoView();
}

// 键盘导航/自动前进后，保证激活行在列表视口内（长列表不失明）。
export function scrollActiveIntoView() {
  listEl.querySelector('li.active')?.scrollIntoView({ block: 'nearest' });
}

// 采点成功后给列表行一次短暂的绿色闪烁（确认感反馈）。
export function flashListItem(index) {
  const li = listEl.querySelector(`li[data-index="${index}"]`);
  if (!li) return;
  li.classList.remove('flash');
  void li.offsetWidth;   // 强制重排，保证连续采点时动画可重复触发
  li.classList.add('flash');
}

// ---------------------------------------------------------------------------
// 撤销（Ctrl+Z）：恢复上一次采点/清除前的坐标
// ---------------------------------------------------------------------------
export function undoLast() {
  const entry = state.undoStack.pop();
  if (!entry) {
    showToast('没有可撤销的操作');
    return;
  }
  const item = state.structures[entry.index];
  if (!item) {
    showToast('撤销失败：列表已变化', 'error');
    return;
  }
  item.center = entry.prevCenter;
  item.status = entry.prevCenter ? '已采集' : '待采集';
  if (entry.prevCenter) placeMarker(entry.index, entry.prevCenter);
  else removeMarker(entry.index);
  state.activeIndex = entry.index;
  state.pendingOverwriteIndex = -1;
  state.pendingDeleteIndex = -1;
  pendingDeleteTime = 0;
  state.dirty = true;
  saveDraft();
  renderAll();
  refreshMarkerColors();
  scrollActiveIntoView();
  showToast(`已撤销：「${item.name}」${entry.prevCenter ? '恢复原坐标' : '恢复为未采集'}`, 'success');
}

// ---------------------------------------------------------------------------
// Delete 清除当前项坐标：二次确认（3 秒内再按一次才执行），可 Ctrl+Z 撤销
// ---------------------------------------------------------------------------
let pendingDeleteTime = 0;
export function requestDeleteActiveCoord() {
  const index = state.activeIndex;
  const item = state.structures[index];
  if (!item?.center) {
    showToast('当前项没有坐标可清除');
    return;
  }
  const fresh = state.pendingDeleteIndex === index && performance.now() - pendingDeleteTime < 3000;
  if (!fresh) {
    state.pendingDeleteIndex = index;
    pendingDeleteTime = performance.now();
    showToast(`再按一次 Delete 清除「${item.name}」的坐标`);
    return;
  }
  state.pendingDeleteIndex = -1;
  pendingDeleteTime = 0;
  pushUndo(index, item.center);
  item.center = null;
  item.status = '待采集';
  removeMarker(index);
  state.dirty = true;
  saveDraft();
  renderAll();
  showToast(`已清除「${item.name}」的坐标（Ctrl+Z 可撤销）`, 'success');
}

// ---------------------------------------------------------------------------
// 提示文案（通用化：不再引用具体模型文件名）
// ---------------------------------------------------------------------------
export function updateHint() {
  const active = state.structures[state.activeIndex];
  if (!state.modelRoot && !state.structures.length) {
    hint.innerHTML = '欢迎使用。点击 <b>选择 GLB / STL 模型</b> 或拖入模型文件，再导入名称清单即可开始。';
    return;
  }
  if (!state.modelRoot) {
    hint.innerHTML = '请加载模型：点击 <b>选择 GLB / STL 模型</b>，或将 .glb / .stl 文件拖入窗口。';
    return;
  }
  if (!state.structures.length) {
    hint.innerHTML = '模型已就绪。请 <b>导入 JSON 清单</b>，或 <b>粘贴名称列表</b>（一行一个名称）。';
    return;
  }
  if (state.mode === 'collect') {
    hint.innerHTML = active
      ? `采集模式：选中 <b>${escapeHtml(active.name)}</b>，单击模型表面记录坐标；右键点标记可重新选中。<br><b>Enter</b> 下一未采集项 · <b>↑↓</b> 切换 · <b>Ctrl+Z</b> 撤销 · <b>Delete</b> 清当前坐标 · <b>Esc</b> 取消勾选`
      : '采集模式：全部名称已经有坐标，可以导出坐标 JSON。';
  } else {
    hint.innerHTML = '浏览模式：点击左侧名称，相机会飞到已采集坐标。没有坐标的名称需要回到采集模式补点。';
  }
}

// 进度条 DOM（首次使用时获取）
const progressOverlay = document.getElementById('progressOverlay');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

// 设置加载进度：text 可含百分比（如"模型加载中：45%"），自动解析并更新进度条。
export function setProgress(text) {
  hint.innerHTML = escapeHtml(text);
  if (!progressOverlay) return;
  progressOverlay.hidden = false;
  progressText.textContent = text;
  // 解析百分比
  const m = String(text).match(/(\d+(?:\.\d+)?)\s*%/);
  progressFill.style.width = m ? (m[1] + '%') : '30%';
}

// 隐藏进度条（加载完成时调用）。
export function hideProgress() {
  if (progressOverlay) progressOverlay.hidden = true;
  if (progressFill) progressFill.style.width = '0%';
}

// ---------------------------------------------------------------------------
// toast：info（默认）/ success（绿边）/ error（红边）；兼容旧的 showToast(msg, true) 错误写法
// ---------------------------------------------------------------------------
let toastTimer = null;
export function showToast(message, type = 'info') {
  const kind = type === true ? 'error' : (type || 'info');
  toastEl.textContent = message;
  toastEl.dataset.kind = kind;
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
  clearUndoStack();
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
  clearUndoStack();
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
    // 统一清空：无论原来有无坐标，都置空 center、删 marker、重置状态。
    if (item.center) cleared++;
    item.center = null;
    item.status = '待采集';
    removeMarker(index);
  }
  state.selected.clear();
  if (state.activeIndex < 0) state.activeIndex = firstUncollectedIndex();
  clearUndoStack();
  state.dirty = true;
  saveDraft();
  renderAll();
  showToast(cleared ? `已清空 ${cleared} 个选中名称的坐标` : `已重置 ${indices.length} 个选中项（原无坐标）`);
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
