// 加载示例项目：仅由用户点击按钮触发，不再自动加载。
// 兼容两种部署：
//   1. 完整部署：examples/ljw/ 含模型 + 清单，全部加载
//   2. 打包版（exe）：只含清单，无模型 → 仅载入清单并提示用户自带模型
import { EXAMPLE_PROJECTS, state, saveDraft, firstUncollectedIndex } from './state.js';
import { normalizeStructures } from './structures.js';
import { loadModel } from './loader.js';
import { renderAll, showToast } from './ui.js';

// 示例项目列表（供下拉菜单渲染）。默认取第一个。
export function listExamples() {
  return EXAMPLE_PROJECTS;
}

// 检测模型文件是否存在（HEAD 请求）。
async function modelExists(fileName) {
  try {
    const response = await fetch(fileName, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

// 加载指定示例：先取清单，再尝试加载模型（缺失则优雅降级）。
export async function loadExample(exampleId = EXAMPLE_PROJECTS[0].id) {
  const example = EXAMPLE_PROJECTS.find(item => item.id === exampleId);
  if (!example) {
    showToast('找不到该示例项目', true);
    return;
  }

  // 1. 加载名称清单（清单必须存在，否则整个示例无法使用）
  try {
    const response = await fetch(example.structuresFile);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.structures = normalizeStructures(data);
    state.activeIndex = firstUncollectedIndex();
  } catch (error) {
    showToast(`示例清单加载失败：${error.message}`, true);
    return;
  }

  // 2. 按候选列表查找存在的模型（压缩版优先）
  let modelFile = null;
  for (const fileName of example.modelCandidates) {
    if (await modelExists(fileName)) {
      modelFile = fileName;
      break;
    }
  }

  // 3. 加载模型；若模型不存在则优雅降级（清单已就绪，提示用户自带模型）
  if (modelFile) {
    try {
      await loadModel(modelFile, modelFile.split('/').pop());
      state.dirty = true;
      saveDraft();
      renderAll();
      showToast(`已加载示例项目「${example.title}」`);
    } catch (error) {
      state.dirty = true;
      saveDraft();
      renderAll();
      showToast(`清单已加载，但模型加载失败：${error.message}`, true);
    }
  } else {
    // 打包版等无内置模型的场景：清单加载成功，引导用户自带模型
    state.dirty = true;
    saveDraft();
    renderAll();
    showToast(`示例清单已加载（${state.structures.length} 项）。示例模型未内置，请点「选择 GLB 模型」导入你的模型`);
  }
}
