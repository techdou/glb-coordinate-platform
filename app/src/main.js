// 应用入口：初始化、事件绑定、渲染循环。
import { THREE, scene, camera, renderer, controls, viewer, readout, raycaster, pointer } from './scene.js';
import { state, restoreDraft, escapeHtml, round, firstUncollectedIndex, saveDraft } from './state.js';
import { normalizeStructures, parsePastedText } from './structures.js';
import {
  loadModel, collectAtPointer, rebuildMarkers,
  fitCamera, setTopView, setIsoView
} from './loader.js';
import {
  setMode, renderAll, renderList, updateHint, showToast,
  clearCoordinates, clearCoordsOnly, clearAll,
  clearSelectedCoords, selectAll, clearSelection, selectItem
} from './ui.js';
import {
  exportNameMap, exportFullProject, migrateLegacyCenteredCoordinates,
  undoLegacyMigration, exportDraftFile, importDraftFile
} from './export.js';
import { initCompress } from './compress.js';
import { initExportDemo } from './export-demo.js';
import { initTheme } from './theme.js';

// ---------------------------------------------------------------------------
// DOM 元素
// ---------------------------------------------------------------------------
const modelInput = document.getElementById('modelInput');
const jsonInput = document.getElementById('jsonInput');
const draftInput = document.getElementById('draftInput');
const pasteDialog = document.getElementById('pasteDialog');
const pasteText = document.getElementById('pasteText');
const clearDialog = document.getElementById('clearDialog');

// ---------------------------------------------------------------------------
// 按钮事件
// ---------------------------------------------------------------------------
document.getElementById('btnModel').addEventListener('click', () => modelInput.click());
document.getElementById('btnJson').addEventListener('click', () => jsonInput.click());
document.getElementById('btnPaste').addEventListener('click', openPasteDialog);
document.getElementById('btnExportMap').addEventListener('click', exportNameMap);
document.getElementById('btnExportFull').addEventListener('click', exportFullProject);
document.getElementById('btnExportDraft').addEventListener('click', exportDraftFile);
document.getElementById('btnImportDraft').addEventListener('click', () => draftInput.click());
document.getElementById('btnMigrateLegacy').addEventListener('click', migrateLegacyCenteredCoordinates);
document.getElementById('btnUndoMigrate').addEventListener('click', undoLegacyMigration);
document.getElementById('btnClear').addEventListener('click', clearCoordinates);

document.getElementById('modeCollect').addEventListener('click', () => setMode('collect'));
document.getElementById('modeBrowse').addEventListener('click', () => setMode('browse'));
document.getElementById('search').addEventListener('input', renderList);

// 视角按钮
document.getElementById('viewFit').addEventListener('click', fitCamera);
document.getElementById('viewTop').addEventListener('click', setTopView);
document.getElementById('viewIso').addEventListener('click', setIsoView);

// 粘贴对话框
document.getElementById('pasteCancel').addEventListener('click', () => pasteDialog.close());
document.getElementById('pasteApply').addEventListener('click', applyPastedList);

// 清空对话框：取消 / 仅清坐标 / 清空全部
document.getElementById('clearCancel').addEventListener('click', () => clearDialog.close());
document.getElementById('clearCoordsOnly').addEventListener('click', () => {
  clearDialog.close();
  clearCoordsOnly();
});
document.getElementById('clearAll').addEventListener('click', () => {
  clearDialog.close();
  clearAll();
});

// 列表底部：选择性清空操作条
document.getElementById('btnClearSelected').addEventListener('click', clearSelectedCoords);
document.getElementById('btnSelectAll').addEventListener('click', selectAll);
document.getElementById('btnClearSelect').addEventListener('click', clearSelection);

// 文件输入
modelInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const objectUrl = URL.createObjectURL(file);
  try {
    await loadModel(objectUrl, file.name, file);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  modelInput.value = '';
});

jsonInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    replaceStructures(normalizeStructures(parsed), `已导入 ${file.name}`);
  } catch (error) {
    showToast(`JSON 解析失败：${error.message}`, true);
  } finally {
    jsonInput.value = '';
  }
});

draftInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  await importDraftFile(file);
  draftInput.value = '';
});

// ---------------------------------------------------------------------------
// 拖拽：支持拖入 GLB / GLTF / JSON 文件
// ---------------------------------------------------------------------------
viewer.addEventListener('dragover', (event) => {
  event.preventDefault();
  viewer.style.outline = '2px dashed var(--accent)';
});
viewer.addEventListener('dragleave', () => {
  viewer.style.outline = '';
});
viewer.addEventListener('drop', async (event) => {
  event.preventDefault();
  viewer.style.outline = '';
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const name = file.name.toLowerCase();
  if (name.endsWith('.glb') || name.endsWith('.gltf') || name.endsWith('.stl')) {
    const objectUrl = URL.createObjectURL(file);
    try {
      await loadModel(objectUrl, file.name, file);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } else if (name.endsWith('.json')) {
    try {
      const parsed = JSON.parse(await file.text());
      replaceStructures(normalizeStructures(parsed), `已导入 ${file.name}`);
    } catch (error) {
      showToast(`JSON 解析失败：${error.message}`, true);
    }
  } else {
    showToast('只支持 .glb / .gltf / .stl / .json 文件', true);
  }
});

// ---------------------------------------------------------------------------
// 采集：区分单击与拖动旋转
// ---------------------------------------------------------------------------
renderer.domElement.addEventListener('pointerdown', (event) => {
  state.lastPointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
});

renderer.domElement.addEventListener('pointerup', (event) => {
  if (state.mode !== 'collect') return;
  if (!state.lastPointerDown) return;
  const dx = Math.abs(event.clientX - state.lastPointerDown.x);
  const dy = Math.abs(event.clientY - state.lastPointerDown.y);
  const elapsed = performance.now() - state.lastPointerDown.time;
  state.lastPointerDown = null;
  if (dx > 4 || dy > 4 || elapsed > 900) return;
  collectAtPointer(event);
});

// ---------------------------------------------------------------------------
// 右键点击：选中已标注的点（marker），命中则切换激活项并飞行定位
// ---------------------------------------------------------------------------
renderer.domElement.addEventListener('contextmenu', (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  // 检测 marker 网格
  const markerMeshes = [...state.markers.values()];
  const hits = raycaster.intersectObjects(markerMeshes, false);
  if (hits.length) {
    event.preventDefault();
    // 找到命中的 marker 对应的 index
    const hitMesh = hits[0].object;
    for (const [index, mesh] of state.markers) {
      if (mesh === hitMesh) {
        selectItem(index);
        showToast(`已选中「${state.structures[index]?.name}」`);
        break;
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 窗口事件
// ---------------------------------------------------------------------------
window.addEventListener('resize', resize);
window.addEventListener('beforeunload', (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

// ---------------------------------------------------------------------------
// 初始化（通用化：空白启动，不自动加载任何模型/清单）
// ---------------------------------------------------------------------------
async function init() {
  initTheme();
  initCompress();
  initExportDemo();
  const restored = restoreDraft();
  renderAll();
  updateHint();
  if (restored) showToast('已恢复浏览器本地草稿');
  animate();
}

// ---------------------------------------------------------------------------
// 粘贴对话框
// ---------------------------------------------------------------------------
function openPasteDialog() {
  pasteText.value = state.structures.map(item => item.name).join('\n');
  pasteDialog.showModal();
  pasteText.focus();
}

function applyPastedList() {
  const text = pasteText.value.trim();
  if (!text) {
    showToast('名称列表为空', true);
    return;
  }
  try {
    const incoming = parsePastedText(text);
    mergeStructures(incoming, `已合并 ${incoming.length} 个名称`);
    pasteDialog.close();
  } catch (error) {
    showToast(`列表解析失败：${error.message}`, true);
  }
}

// ---------------------------------------------------------------------------
// 合并名称列表（append 语义）：保留已有坐标，追加新名称，不覆盖前期工作。
// ---------------------------------------------------------------------------
function mergeStructures(incoming, message) {
  // 以名称为键建立已有项索引，保留 center/status/size_real 等已采集信息
  const existingByName = new Map();
  state.structures.forEach(item => existingByName.set(item.name, item));

  const merged = [];
  const seen = new Set();
  // 先处理 incoming（保留 incoming 的顺序，作为新清单骨架）
  for (const inc of incoming) {
    const old = existingByName.get(inc.name);
    if (old) {
      // 已存在：保留坐标与状态，可更新元信息（size_real/count/note）
      merged.push({
        ...old,
        size_real: inc.size_real ?? old.size_real,
        count: inc.count ?? old.count,
        note: inc.note ?? old.note
      });
      seen.add(inc.name);
    } else {
      // 新名称：直接追加
      merged.push(inc);
    }
  }
  // 旧列表里有但 incoming 里没有的项：保留（避免误删已采集的项）
  for (const old of state.structures) {
    if (!seen.has(old.name) && !incoming.some(i => i.name === old.name)) {
      merged.push(old);
    }
  }

  state.structures = merged;
  state.activeIndex = firstUncollectedIndex();
  state.selected.clear();
  state.dirty = true;
  rebuildMarkers();
  saveDraft();
  renderAll();
  showToast(message);
}

// ---------------------------------------------------------------------------
// 替换名称列表（通用辅助）
// ---------------------------------------------------------------------------
function replaceStructures(structures, message) {
  state.structures = structures;
  state.activeIndex = firstUncollectedIndex();
  state.selected.clear();
  state.dirty = true;
  rebuildMarkers();
  saveDraft();
  renderAll();
  showToast(message);
}

// ---------------------------------------------------------------------------
// 渲染循环
// ---------------------------------------------------------------------------
function resize() {
  const width = viewer.clientWidth;
  const height = viewer.clientHeight;
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  updateReadout();
}

// 缓存上一次内容，仅在变化时写 DOM，避免每帧重建节点触发回流。
let lastReadout = '';
function updateReadout() {
  const target = controls.target;
  const active = state.structures[state.activeIndex];
  const text = [
    `模型：${state.modelLabel || '未加载'}`,
    `焦点：[${round(target.x)}, ${round(target.y)}, ${round(target.z)}]`,
    `当前：${active ? active.name : '无'}`
  ].join('<br>');
  if (text !== lastReadout) {
    readout.innerHTML = [
      `模型：${escapeHtml(state.modelLabel || '未加载')}`,
      `焦点：[${round(target.x)}, ${round(target.y)}, ${round(target.z)}]`,
      `当前：${active ? escapeHtml(active.name) : '无'}`
    ].join('<br>');
    lastReadout = text;
  }
}

init();
