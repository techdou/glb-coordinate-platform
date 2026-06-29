// structures.js 清单解析单元测试（Node ESM，无 DOM 依赖）。
// state.js 顶层不碰 DOM，可直接 import。
// 运行：node tests/test_structures.mjs
import { normalizeStructures, parsePastedText, normalizeCoord } from '../app/src/structures.js';

let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) console.error(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  ok ? passed++ : failed++;
}

// ---------------------------------------------------------------------------
// 格式 1：字符串数组
// ---------------------------------------------------------------------------
(function () {
  const r = normalizeStructures(['点位A', '点位B']);
  eq('字符串数组长度', r.length, 2);
  eq('字符串数组名称', r.map(i => i.name), ['点位A', '点位B']);
  eq('字符串数组状态', r.map(i => i.status), ['待采集', '待采集']);
})();

// ---------------------------------------------------------------------------
// 格式 2：对象数组
// ---------------------------------------------------------------------------
(function () {
  const r = normalizeStructures([{ name: '点位A', center: [1, 2, 3] }, { name: '点位B' }]);
  eq('对象数组长度', r.length, 2);
  eq('对象数组带坐标', r[0].center, [1, 2, 3]);
  eq('对象数组无坐标', r[1].center, null);
  eq('对象数组状态', r.map(i => i.status), ['已采集', '待采集']);
})();

// ---------------------------------------------------------------------------
// 格式 3：工程格式 { structures: [...] }
// ---------------------------------------------------------------------------
(function () {
  const r = normalizeStructures({ structures: [{ name: 'a' }, { name: 'b' }] });
  eq('工程格式长度', r.length, 2);
  eq('工程格式名称', r.map(i => i.name), ['a', 'b']);
})();

// ---------------------------------------------------------------------------
// 格式 4：名称映射 { 名称: [x,y,z] }
// ---------------------------------------------------------------------------
(function () {
  const r = normalizeStructures({ '点位A': [1, 2, 3], '点位B': null });
  eq('名称映射长度', r.length, 2);
  eq('名称映射有坐标', r.find(i => i.name === '点位A').center, [1, 2, 3]);
})();

// ---------------------------------------------------------------------------
// 格式 5：粘贴文本，一行一个名称
// ---------------------------------------------------------------------------
(function () {
  const r = parsePastedText('点位A\n点位B\n点位C');
  eq('粘贴文本长度', r.length, 3);
  eq('粘贴文本名称', r.map(i => i.name), ['点位A', '点位B', '点位C']);
})();

// ---------------------------------------------------------------------------
// 粘贴文本：自动去除行首序号
// ---------------------------------------------------------------------------
(function () {
  const r = parsePastedText('1.点位A\n2、点位B\n3-点位C');
  eq('粘贴文本去序号', r.map(i => i.name), ['点位A', '点位B', '点位C']);
})();

// ---------------------------------------------------------------------------
// normalizeCoord：非法输入
// ---------------------------------------------------------------------------
(function () {
  eq('normalizeCoord 长度不足', normalizeCoord([1, 2]), null);
  eq('normalizeCoord 非数字', normalizeCoord([1, 'x', 3]), null);
  eq('normalizeCoord 正常', normalizeCoord([1.23456789, 2, 3]), [1.23457, 2, 3]);
})();

// ---------------------------------------------------------------------------
// 空输入兜底
// ---------------------------------------------------------------------------
(function () {
  eq('空数组', normalizeStructures([]), []);
  eq('空对象', normalizeStructures({}), []);
})();

// ---------------------------------------------------------------------------
// 结果
// ---------------------------------------------------------------------------
console.log(`\nstructures.js 测试：${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
