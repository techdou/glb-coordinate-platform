// 导出功能：坐标 JSON、完整工程、迁移旧版坐标、撤销迁移，以及草稿导入/导出。
import { THREE } from './scene.js';
import { state, round, firstUncollectedIndex, saveDraft, downloadJson, timestamp } from './state.js';
import { normalizeStructures } from './structures.js';
import { rebuildMarkers, clearMarkerMeshes } from './loader.js';
import { renderAll, showToast, updateHint } from './ui.js';
import { STORAGE_KEY } from './state.js';

// ---------------------------------------------------------------------------
// 导出坐标 JSON（{名称: [x,y,z]} 业务格式）
// ---------------------------------------------------------------------------
export function exportNameMap() {
  if (!state.structures.length) {
    showToast('没有可导出的名称列表', true);
    return;
  }
  const missing = state.structures.filter(item => !item.center);
  if (missing.length) {
    showToast(`还有 ${missing.length} 个未采集；导出的值会是 null`, true);
  }
  // 重名检测：同名时后者覆盖前者，导出值不可靠，需明确提示。
  const map = {};
  const duplicates = [];
  for (const item of state.structures) {
    if (map[item.name] !== undefined && !duplicates.includes(item.name)) {
      duplicates.push(item.name);
    }
    map[item.name] = item.center ?? null;
  }
  downloadJson(map, `coordinates_${timestamp()}.json`);
  state.dirty = false;
  if (duplicates.length) {
    showToast(`警告：检测到 ${duplicates.length} 个重名（如「${duplicates[0]}」），同名键后者覆盖前者`, true);
  }
}

// ---------------------------------------------------------------------------
// 导出完整工程（含模型指纹、坐标系说明）
// ---------------------------------------------------------------------------
export function exportFullProject() {
  const full = {
    meta: {
      tool: 'generic-3d-coordinate-collector',
      schemaVersion: '1.0.0',
      model: state.modelLabel,
      coordinateSystem: 'GLB model local coordinates',
      generatedAt: new Date().toISOString()
    },
    modelState: {
      fileName: state.modelLabel || null,
      fileSizeBytes: state.modelFileSize,
      sha256: state.modelSha256,
      identityHint: 'Use the same GLB file, or a file with unchanged origin, scale, rotation, and geometry.',
      localBoundingBox: boxToPlain(state.modelOriginalBox),
      localSize: sizeToPlain(state.modelOriginalBox),
      localCenter: vectorToPlain(state.modelCenterOffset),
      note: 'Coordinates are valid for the same model geometry, origin, scale, and orientation. Legacy centered scene coordinates must be migrated first.',
      viewerTransform: {
        displayCenterOffset: vectorToPlain(state.modelCenterOffset),
        explanation: 'The viewer subtracts this center only for display. Exported marker centers remain in original GLB local coordinates.'
      }
    },
    structures: state.structures
  };
  downloadJson(full, `coordinate_project_${timestamp()}.json`);
  state.dirty = false;
}

export function vectorToPlain(vector) {
  return vector ? [round(vector.x), round(vector.y), round(vector.z)] : null;
}

export function boxToPlain(box) {
  if (!box) return null;
  return { min: vectorToPlain(box.min), max: vectorToPlain(box.max) };
}

export function sizeToPlain(box) {
  if (!box) return null;
  return vectorToPlain(box.getSize(new THREE.Vector3()));
}

// ---------------------------------------------------------------------------
// 迁移旧版坐标（居中场景坐标 → GLB 原始局部坐标）
// ---------------------------------------------------------------------------
export function migrateLegacyCenteredCoordinates() {
  if (!state.modelRoot || !state.modelCenterOffset) {
    showToast('请先加载对应 GLB 模型，再迁移旧版坐标', true);
    return;
  }
  const withCoords = state.structures.filter(item => item.center);
  if (!withCoords.length) {
    showToast('当前没有可迁移的坐标', true);
    return;
  }
  const ok = confirm(
    '这会把"旧版居中场景坐标"转换为"GLB 原始局部坐标"。\n\n' +
    '只适用于优化前工具导出的坐标；如果这些坐标已经来自新版工具，请不要迁移。\n\n' +
    '工具会先保存一份撤销备份。'
  );
  if (!ok) return;

  state.migrationBackup = {
    createdAt: new Date().toISOString(),
    modelLabel: state.modelLabel,
    centerOffset: [
      round(state.modelCenterOffset.x),
      round(state.modelCenterOffset.y),
      round(state.modelCenterOffset.z)
    ],
    structures: JSON.parse(JSON.stringify(state.structures))
  };

  const offset = state.modelCenterOffset;
  for (const item of withCoords) {
    item.center = [
      round(Number(item.center[0]) + offset.x),
      round(Number(item.center[1]) + offset.y),
      round(Number(item.center[2]) + offset.z)
    ];
    item.status = '已采集';
  }
  state.dirty = true;
  rebuildMarkers();
  saveDraft();
  renderAll();
  showToast(`已迁移 ${withCoords.length} 个旧版坐标；如位置不对，点击"撤销迁移"`);
}

export function undoLegacyMigration() {
  if (!state.migrationBackup?.structures?.length) {
    showToast('没有可撤销的迁移备份', true);
    return;
  }
  const ok = confirm('确认恢复到迁移前的坐标吗？');
  if (!ok) return;

  state.structures = normalizeStructures(state.migrationBackup.structures);
  state.activeIndex = firstUncollectedIndex();
  state.selected.clear();
  state.migrationBackup = null;
  state.dirty = true;
  rebuildMarkers();
  saveDraft();
  renderAll();
  showToast('已撤销旧版坐标迁移');
}

// ---------------------------------------------------------------------------
// 草稿导入 / 导出（文件形式，便于跨浏览器/跨设备迁移进度）
// ---------------------------------------------------------------------------
export function exportDraftFile() {
  const payload = {
    type: 'generic-3d-coordinate-collector-draft',
    schemaVersion: '1.0.0',
    exportedAt: new Date().toISOString(),
    storageKey: STORAGE_KEY,
    draft: JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
  };
  if (!payload.draft?.structures?.length) {
    showToast('当前没有可导出的草稿', true);
    return;
  }
  downloadJson(payload, `draft_${timestamp()}.json`);
  showToast('草稿已导出');
}

export async function importDraftFile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const draft = parsed.draft ?? parsed; // 兼容直接粘贴的草稿或工程文件
    if (!draft?.structures?.length) {
      showToast('文件里没有可识别的草稿数据', true);
      return;
    }
    // 在内存里恢复，避免整页 reload 丢失已加载的模型与视角。
    state.structures = normalizeStructures(draft.structures);
    state.activeIndex = firstUncollectedIndex();
    state.selected.clear();
    state.modelLabel = draft.modelLabel || state.modelLabel || '';
    state.modelFileSize = draft.modelFileSize ?? state.modelFileSize ?? null;
    state.modelSha256 = draft.modelSha256 ?? state.modelSha256 ?? null;
    state.migrationBackup = draft.migrationBackup || null;
    state.dirty = true;
    rebuildMarkers();
    saveDraft();
    renderAll();
    updateHint();
    showToast(`已导入草稿：${state.structures.length} 个名称（模型需自行重新加载）`);
  } catch (error) {
    showToast(`草稿解析失败：${error.message}`, true);
  }
}
