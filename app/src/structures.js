// 名称清单解析：支持 5 种输入格式，统一归一化为 structure 数组。
import { round, firstUncollectedIndex } from './state.js';

export function normalizeStructures(input) {
  const raw = Array.isArray(input)
    ? input
    : Array.isArray(input?.structures)
      ? input.structures
      : objectMapToStructures(input);

  return raw.map((entry, index) => {
    if (typeof entry === 'string') {
      return createStructure(entry, index);
    }
    const name = String(entry.name ?? entry.title ?? entry.label ?? entry.id ?? `点位 ${index + 1}`).trim();
    const center = normalizeCoord(entry.center ?? entry.coords ?? entry.coordinate ?? entry.position ?? entry.value);
    return {
      id: entry.id ?? index + 1,
      name,
      center,
      status: center ? '已采集' : (entry.status === '已校准' ? '已采集' : '待采集'),
      size_real: entry.size_real,
      count: entry.count,
      note: entry.note
    };
  }).filter(item => item.name);
}

function objectMapToStructures(input) {
  if (!input || typeof input !== 'object') return [];
  return Object.entries(input)
    .filter(([key]) => !key.startsWith('_'))
    .map(([name, value], index) => ({ id: index + 1, name, center: value }));
}

export function createStructure(name, index) {
  return {
    id: index + 1,
    name: String(name).trim(),
    center: null,
    status: '待采集'
  };
}

export function normalizeCoord(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  const coord = value.slice(0, 3).map(Number);
  return coord.every(Number.isFinite) ? coord.map(round) : null;
}

// 解析粘贴文本：一行一个名称，或 JSON（5 种格式）
export function parsePastedText(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return normalizeStructures(JSON.parse(trimmed));
  }
  return trimmed.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((name, index) => createStructure(name.replace(/^\d+[\.\)、\s-]+/, ''), index));
}

export { firstUncollectedIndex };
