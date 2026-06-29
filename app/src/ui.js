// UI 渲染：统计、列表、提示、toast、模式切换、视角跳转交互。
import { state, round, escapeHtml, firstUncollectedIndex } from './state.js';
import { hint, readout, controls } from './scene.js';
// 循环 import：selectItem 在事件回调里调用 flyToLocalCoord，彼时模块已加载完成。
import { flyToLocalCoord, rebuildMarkers, refreshMarkerColors, clearMarkerMeshes } from './loader.js';
import { saveDraft } from './state.js';

const listEl = document.getElementById('list');
const listFoot = document.getElementById('listFoot');
const toastEl = document.getElementById('toast');

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

// 列表点击用事件委托：只绑定一次监听器，靠 data-index 定位被点的项。
listEl.addEventListener('click', (event) => {
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
    items.push(
      `<li class="${classes}" data-index="${index}" title="${escapeHtml(title)}">` +
      `<span class="idx">${index + 1}</span>` +
      `<span class="name">${escapeHtml(item.name)}<span class="coord">${coord}</span></span>` +
      `<span class="badge">${item.center ? '完成' : '待点'}</span>` +
      `</li>`
    );
  });
  listEl.innerHTML = items.join('');
  const done = state.structures.filter(item => item.center).length;
  listFoot.textContent = `当前显示 ${visible}/${state.structures.length} 项，已采集 ${done} 项`;
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
    hint.innerHTML = '欢迎使用。点击 <b>选择 GLB 模型</b> 或拖入模型文件，再导入名称清单即可开始。<br>也可点击 <b>加载示例项目</b> 体验完整流程。';
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
// 清空坐标
// ---------------------------------------------------------------------------
export function clearCoordinates() {
  state.structures.forEach(item => {
    item.center = null;
    item.status = '待采集';
  });
  state.activeIndex = state.structures.length ? 0 : -1;
  clearMarkerMeshes();
  state.dirty = true;
  saveDraft();
  renderAll();
  showToast('坐标已清空，名称列表保留');
}

export { rebuildMarkers };
