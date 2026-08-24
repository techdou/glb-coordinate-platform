# 通用 3D 坐标采集工具

> 面向任意 GLB / GLTF / STL 模型的浏览器端坐标采集工具：加载模型和名称清单，在模型上逐个点选位置，导出 `{名称: [x, y, z]}`。纯前端 + Python 静态服务器，离线可用。

![Python](https://img.shields.io/badge/Python-3.8+-blue) ![three.js](https://img.shields.io/badge/three.js-r160-green) ![License](https://img.shields.io/badge/License-Apache_2.0-blue) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

## 功能特性

- 🧩 **通用工具定位**：空白启动，模型和清单由用户带入，不绑定特定场景
- 📦 **离线可用**：three.js 已内置，纯前端 + Python 标准库服务器，无需联网
- 🖱️ **精准采点**：采集模式下点选模型表面，记录坐标；右键可选中已标注点
- ↩️ **撤销与防误触**：Ctrl+Z 撤销采点/清除；覆盖已有坐标、Delete 清除均需二次确认
- ⚡ **自动前进**：采完自动选中下一未采集项（可关），重度采集零鼠标往返
- ⌨️ **键盘快捷键**：Enter 跳下一未采集项、↑↓ 上下切换、Delete 清除坐标、Esc 取消勾选
- 📋 **多格式清单**：支持 5 种清单格式，粘贴名称采用 append 合并（不覆盖已有坐标）
- 💾 **三种导出**：坐标 JSON（给业务系统）、完整工程（含模型指纹/归档）、草稿（进度迁移）
- 🗜️ **网页内压缩**：GLB 模型 DRACO + 纹理优化（需 Node.js），体积减小 60-80%
- 📤 **导展示页**：一键打包可运行的示例展示页 zip，供二次开发参考
- 🌓 **明暗主题**：深色/浅色主题切换，含 3D 场景联动
- 📊 **加载进度条**：大模型加载时显示百分比进度
- 🏷️ **悬浮注解**：鼠标悬停按钮显示功能说明；toolbar 分组（高频 + 更多菜单）
- ✅ **选择性清空**：列表勾选批量清空坐标
- 📦 **可打包 exe**：封装成单个可执行文件，双击即用

## 快速开始

### 方式一：免安装 exe（推荐给非开发者）

从 [Releases](https://github.com/techdou/glb-coordinate-platform/releases) 下载 `CoordinateCollector.exe`，双击即可，无需 Python。

### 方式二：源码启动（需 Python 3.8+）

**Windows**：双击 `start.bat`
**macOS / Linux**：`./start.sh`
**任意平台**：
```bash
python scripts/start.py                 # 默认端口 8000，自动开浏览器
python scripts/start.py --port 8010     # 指定端口
python scripts/start.py --no-browser    # 不自动开浏览器
```

> 唯一依赖是 Python 3.8+（仅标准库），无需 pip 安装任何包。

## 使用流程

1. 打开页面 → 空白工作台
2. 点 **选择 GLB / STL 模型**（或把 `.glb` / `.stl` 文件拖进 3D 窗口）
3. 点 **导入 JSON 清单** 或 **粘贴名称列表**
4. **采集模式**下点左侧名称，在模型对应位置单击 → 自动记录坐标并跳到下一个
5. 全部点完后 **导出坐标 JSON**

> 不熟悉清单格式？`app/examples/ljw/structures.json` 提供了一份精简样例，可直接导入参考。
> 每个按钮鼠标悬停都有功能说明（tooltip）。

### 键盘快捷键（采集时）

| 按键 | 功能 |
| --- | --- |
| `Enter` | 跳到下一个未采集项 |
| `↑` / `↓` | 上下切换列表项 |
| `Delete` | 清除当前项坐标（二次确认） |
| `Ctrl`/`Cmd` + `Z` | 撤销上一次采点/清除 |
| `/` | 聚焦搜索框 |
| `Esc` | 取消列表勾选 |

## 清单支持格式

| 格式 | 示例 |
| --- | --- |
| 一行一个名称 | `点位A\n点位B` |
| 字符串数组 | `["点位A", "点位B"]` |
| 对象数组 | `[{"name":"点位A","center":[1,2,3]}]` |
| 工程格式 | `{"structures":[{"name":"点位A"}]}` |
| 名称映射 | `{"点位A":[1,2,3],"点位B":null}` |

## 导出说明

| 按钮 | 用途 | 格式 |
| --- | --- | --- |
| **导出坐标 JSON** | 给业务系统用 | `{名称: [x,y,z]}`，未采集为 `null` |
| **导出完整工程** | 归档/下次继续 | 含模型 SHA-256、包围盒、坐标 |
| **导展示页(zip)** | 二次开发参考 | 可直接运行的示例页（index.html + data.json + model.glb） |
| **导出草稿** | 进度迁移 | 清单 + 坐标，换浏览器/电脑可恢复 |

## 压缩模型

GLB 模型可用 DRACO + 纹理优化大幅减小体积（60-80%）。两种方式：

**网页内压缩**：点工具栏 **压缩 GLB** → 选文件和档位 → 服务器用 gltf-transform 压缩 → 下载（需 Node.js）

**命令行**：
```bash
python scripts/compress_model.py 输入.glb 输出.glb --quality medium
CoordinateCollector.exe --compress 输入.glb 输出.glb --quality medium
```

> 仅支持 GLB（STL 无需压缩）。无纹理模型自动跳过纹理步骤、仅做 DRACO。

## 坐标是否通用

坐标绑定到**同一个模型的局部坐标系**（GLB/GLTF/STL 通用）：

- ✅ 有效：同一个模型重新加载；不改原点/缩放/旋转/几何的压缩；业务系统按相同坐标系加载
- ❌ 失效：重新导出改了原点/缩放/旋转；换了模型版本

## 打包成 exe

```bash
pip install pyinstaller
python build.py --clean
```
产物在 `dist/CoordinateCollector.exe`（约 9MB），双击即用，完全离线。

## 目录结构

```text
glb-coordinate-platform/
├── start.bat / start.sh          # 一键启动入口
├── app/                          # Web 应用根目录
│   ├── index.html                # 页面结构
│   ├── styles.css                # 样式（明暗主题变量分层）
│   ├── src/                      # 模块化源码
│   │   ├── main.js               # 入口：初始化、事件、渲染循环
│   │   ├── state.js              # 全局状态 + 草稿存取 + 工具函数
│   │   ├── scene.js              # three.js 场景 + 主题色管理
│   │   ├── loader.js             # 模型加载 + 采点 + marker + 视角
│   │   ├── structures.js         # 清单解析（5 种格式）
│   │   ├── ui.js                 # 列表/统计/提示/toast/清空渲染
│   │   ├── export.js             # 导出坐标/工程/草稿、迁移
│   │   ├── compress.js           # 网页内 GLB 压缩
│   │   ├── export-demo.js        # 导展示页 zip
│   │   └── theme.js              # 明暗主题切换
│   ├── vendor/three/             # 离线 three.js r160（含 DRACO/STL）
│   └── examples/ljw/             # 清单格式样例（仅 structures.json）
├── scripts/
│   ├── start.py                  # 跨平台启动脚本（核心）
│   ├── compress_model.py         # GLB 压缩工具
│   └── start.ps1 / start.bat     # 向后兼容入口
├── app_main.py                   # 统一入口（服务器+压缩），打包入口
├── build.py / build.spec         # PyInstaller 打包
├── tests/                        # 单元测试
│   ├── test_start.py             # 端口探测（Python unittest）
│   └── test_structures.mjs       # 清单解析（Node ESM）
```

> 设计文档与内部资料存放于本地 `docs/`，不纳入版本控制。

## 技术栈

- **前端**：原生 ES Modules + three.js r160（GLTFLoader / STLLoader / OrbitControls）
- **后端**：Python 标准库（http.server + zipfile），无第三方依赖
- **打包**：PyInstaller（exe）+ gltf-transform（GLB 压缩，需 Node.js）

## 开发

```bash
# 运行测试
python -m unittest tests.test_start     # 端口探测
node tests/test_structures.mjs          # 清单解析

# 启动开发服务器
python scripts/start.py --no-browser
```

## License

Apache-2.0
