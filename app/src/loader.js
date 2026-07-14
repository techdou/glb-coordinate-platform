// 模型加载、SHA-256 指纹、raycast 采点、marker 网格管理。
import { THREE, scene, camera, controls, grid, renderer, loader, stlLoader, raycaster, pointer, hint, getMarkerColors } from './scene.js';
import { state, round, firstUncollectedIndex, saveDraft } from './state.js';
import { showToast, renderAll, setProgress, updateHint } from './ui.js';

// STL 统一渲染材质：标准 PBR，外观与 GLB 默认光照协调。
const STL_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xb8c4cc,
  metalness: 0.1,
  roughness: 0.75,
  side: THREE.DoubleSide  // STL 多为开放壳体，双面避免"看穿"
});

// 根据扩展名解析模型，统一返回一个 Object3D 根节点。
async function parseModel(url, label) {
  const ext = label.toLowerCase().split('.').pop();
  if (ext === 'stl') {
    const geometry = await stlLoader.loadAsync(url, onModelProgress);
    // STL 可能缺法线，统一重算，保证光照正确。
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, STL_MATERIAL);
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  }
  // glb / gltf
  const gltf = await loader.loadAsync(url, onModelProgress);
  return gltf.scene;
}

// ---------------------------------------------------------------------------
// 模型加载
// ---------------------------------------------------------------------------
export async function loadModel(url, label, file = null) {
  setProgress(`模型加载中：${label}`);
  try {
    const identity = await readModelIdentity(url, file);
    const modelRoot = await parseModel(url, label);

    if (state.modelRoot) {
      scene.remove(state.modelRoot);
      clearMarkerMeshes();
    }

    state.modelRoot = modelRoot;
    state.modelLabel = label;
    state.modelFileSize = identity.size;
    state.modelSha256 = identity.sha256;
    state.modelFile = file;   // 存住原始 File，供「导展示页」打包导出

    const originalBox = new THREE.Box3().setFromObject(state.modelRoot);
    const center = originalBox.getCenter(new THREE.Vector3());
    state.modelOriginalBox = originalBox.clone();
    state.modelCenterOffset = center.clone();
    state.modelRoot.position.sub(center);
    scene.add(state.modelRoot);
    state.modelBox = new THREE.Box3().setFromObject(state.modelRoot);

    const size = state.modelBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    camera.near = maxDim / 10000;
    camera.far = maxDim * 10000;
    camera.updateProjectionMatrix();
    grid.scale.setScalar(Math.max(maxDim / 4, 1));
    grid.position.y = state.modelBox.min.y - maxDim * 0.01;

    rebuildMarkers();
    fitCamera();
    renderAll();
    showToast(`模型已加载：${label}`);
  } catch (error) {
    showToast(`模型加载失败：${error?.message || error}`, true);
  } finally {
    // setProgress 复用 hint 宀器，加载结束后必须恢复正常提示文案。
    updateHint();
  }
}

function onModelProgress(event) {
  if (!event.lengthComputable) return;
  setProgress(`模型加载中：${Math.round(event.loaded / event.total * 100)}%`);
}

async function readModelIdentity(url, file) {
  try {
    const buffer = file
      ? await file.arrayBuffer()
      : await (await fetch(url)).arrayBuffer();
    return {
      size: buffer.byteLength,
      sha256: await sha256Hex(buffer)
    };
  } catch {
    return { size: file?.size ?? null, sha256: null };
  }
}

async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// 采点（raycast）
// ---------------------------------------------------------------------------
export function collectAtPointer(event) {
  if (!state.modelRoot) {
    showToast('请先加载模型（GLB / STL）', true);
    return;
  }
  if (!state.structures.length) {
    showToast('请先导入或粘贴名称列表', true);
    return;
  }
  if (state.activeIndex < 0) state.activeIndex = firstUncollectedIndex();
  if (state.activeIndex < 0) {
    showToast('全部点位已经采集完成');
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(state.modelRoot, true);
  if (!hits.length) {
    showToast('没有点到模型表面，请靠近目标位置后再点', true);
    return;
  }

  const worldPoint = hits[0].point.clone();
  const localPoint = state.modelRoot.worldToLocal(worldPoint.clone());
  const coord = [round(localPoint.x), round(localPoint.y), round(localPoint.z)];
  const item = state.structures[state.activeIndex];
  item.center = coord;
  item.status = '已采集';
  placeMarker(state.activeIndex, coord);
  state.dirty = true;
  saveDraft();

  // 不自动跳转：保持当前选中项，由用户自主点击列表切换下一个。
  renderAll();
  const allDone = state.structures.every(s => s.center);
  if (allDone) {
    showToast(`已记录「${item.name}」，全部点位采集完成，可导出坐标 JSON`);
  } else {
    showToast(`已记录「${item.name}」的坐标，可在列表点击切换下一个`);
  }
}

// ---------------------------------------------------------------------------
// marker 网格管理
// ---------------------------------------------------------------------------

// marker 配色随主题变化（从 scene.js 的 getMarkerColors 动态读取）。

export function placeMarker(index, localCoord) {
  if (!state.modelRoot || !localCoord) return;
  const old = state.markers.get(index);
  if (old) disposeMarker(old);
  const world = state.modelRoot.localToWorld(new THREE.Vector3(...localCoord));
  const radius = markerRadius();
  const geometry = new THREE.SphereGeometry(radius, 18, 18);
  const colors = getMarkerColors();
  const material = new THREE.MeshBasicMaterial({
    color: index === state.activeIndex ? colors.active : colors.done
  });
  const marker = new THREE.Mesh(geometry, material);
  marker.position.copy(world);
  marker.userData.marker = true;
  scene.add(marker);
  state.markers.set(index, marker);
}

// 释放单个 marker 的 GPU 资源，避免重复采点导致内存累积。
function disposeMarker(marker) {
  scene.remove(marker);
  marker.geometry?.dispose();
  if (Array.isArray(marker.material)) marker.material.forEach(m => m.dispose());
  else marker.material?.dispose();
}

// 按 index 移除单个 marker（选择性清空坐标用）。
export function removeMarker(index) {
  const marker = state.markers.get(index);
  if (marker) {
    disposeMarker(marker);
    state.markers.delete(index);
  }
}

// 选中项变化或主题切换时只重设颜色，不重建网格（比 rebuildMarkers 轻量）。
export function refreshMarkerColors() {
  const colors = getMarkerColors();
  for (const [index, marker] of state.markers) {
    marker.material.color.setHex(index === state.activeIndex ? colors.active : colors.done);
  }
}

export function markerRadius() {
  if (!state.modelBox) return 0.015;
  const size = state.modelBox.getSize(new THREE.Vector3());
  return Math.max(Math.max(size.x, size.y, size.z) * 0.006, 0.004);
}

export function rebuildMarkers() {
  clearMarkerMeshes();
  state.structures.forEach((item, index) => {
    if (item.center) placeMarker(index, item.center);
  });
}

export function clearMarkerMeshes() {
  for (const marker of state.markers.values()) disposeMarker(marker);
  state.markers.clear();
}

// ---------------------------------------------------------------------------
// 视角控制
// ---------------------------------------------------------------------------
export function fitCamera() {
  if (!state.modelBox) return;
  const sphere = state.modelBox.getBoundingSphere(new THREE.Sphere());
  const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.25;
  const direction = new THREE.Vector3(1, 0.75, 1).normalize();
  camera.position.copy(sphere.center).addScaledVector(direction, distance);
  controls.target.copy(sphere.center);
  controls.update();
}

export function setTopView() {
  if (!state.modelBox) return;
  const sphere = state.modelBox.getBoundingSphere(new THREE.Sphere());
  // Z 轴加微小偏移，避免相机正对 -Y 时 OrbitControls 俯仰角为 0 触发 gimbal lock（视角卡住）。
  camera.position.set(sphere.center.x, sphere.center.y + sphere.radius * 2.6, sphere.center.z + 0.0001);
  controls.target.copy(sphere.center);
  controls.update();
}

export function setIsoView() {
  fitCamera();
}

export function flyToLocalCoord(localCoord, distanceScale = 0.75) {
  if (!state.modelRoot || !localCoord) return;
  const world = state.modelRoot.localToWorld(new THREE.Vector3(...localCoord));
  const boxSize = state.modelBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1);
  const distance = Math.max(boxSize.length() * 0.22 * distanceScale, markerRadius() * 16);
  let direction = new THREE.Vector3().subVectors(camera.position, controls.target);
  if (direction.lengthSq() < 0.0001) direction.set(1, 0.75, 1);
  direction.normalize();
  animateCamera(world.clone().addScaledVector(direction, distance), world, 700);
}

function animateCamera(toPosition, toTarget, duration) {
  const fromPosition = camera.position.clone();
  const fromTarget = controls.target.clone();
  const started = performance.now();
  function frame() {
    const raw = Math.min((performance.now() - started) / duration, 1);
    const t = raw < .5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    camera.position.lerpVectors(fromPosition, toPosition, t);
    controls.target.lerpVectors(fromTarget, toTarget, t);
    controls.update();
    if (raw < 1) requestAnimationFrame(frame);
  }
  frame();
}
