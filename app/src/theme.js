// 明暗主题切换：CSS data-theme 属性 + three.js 场景颜色联动。
// 状态存 localStorage，下次打开记住。
import { updateSceneTheme } from './scene.js';
import { refreshMarkerColors } from './loader.js';

const THEME_KEY = 'theme';
let theme = 'dark';

// 启动时初始化（main.js 的 init 调用）。
export function initTheme() {
  theme = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  applyTheme(theme);
  const btn = document.getElementById('btnTheme');
  if (btn) btn.addEventListener('click', toggleTheme);
}

// 应用主题：CSS 属性 + three.js 场景 + marker。
function applyTheme(t) {
  theme = t;
  document.documentElement.dataset.theme = t;
  updateSceneTheme(t);
  refreshMarkerColors();
  updateToggleButton();
}

export function toggleTheme() {
  applyTheme(theme === 'dark' ? 'light' : 'dark');
  localStorage.setItem(THEME_KEY, theme);
}

export function getTheme() {
  return theme;
}

// 更新切换按钮的文案/图标。
function updateToggleButton() {
  const btn = document.getElementById('btnTheme');
  if (!btn) return;
  btn.textContent = theme === 'dark' ? '🌙' : '☀️';
  btn.setAttribute('data-tip', theme === 'dark' ? '当前深色模式，点击切换到浅色' : '当前浅色模式，点击切换到深色');
}
