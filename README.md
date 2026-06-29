# 通用 3D 坐标采集工具

一个**面向任意 GLB/GLTF 模型**的浏览器端坐标采集工具：加载模型和名称清单，在模型上逐个点选位置，导出 `{名称: [x, y, z]}`。打开就是干净的工作台，模型和清单都由你带入，附带一个示例项目可直接体验完整流程。

纯前端 + Python 静态服务器，**离线可用**（three.js 已内置），无需联网。

## 快速启动

### 方式一：免安装 exe（推荐给非开发者）
双击打包好的 `CoordinateCollector.exe`（见下方「打包成应用程序」），无需安装 Python，自动打开浏览器。

### 方式二：源码启动（需 Python）
**Windows**：双击项目根目录的 `start.bat`，或在终端：
```powershell
.\start.bat
```
**macOS / Linux**：
```bash
./start.sh
```
**任意平台（推荐）**：
```bash
python scripts/start.py                 # 默认端口 8000，自动开浏览器
python scripts/start.py --port 8010     # 指定起始端口
python scripts/start.py --no-browser    # 不自动打开浏览器
python scripts/start.py --host 0.0.0.0  # 允许局域网访问
```

启动后终端会打印访问地址（端口被占用会自动递增），按 `Ctrl+C` 停止。

> 方式二唯一依赖是 **Python 3.8+**（仅用标准库），无需 pip 安装任何包。`start.bat` 会自动探测可用的 Python（跳过 Windows Store 残桩），找不到会给出安装指引。

## 使用流程

1. 打开页面 → 空白工作台。
2. 点 **选择 GLB 模型**（或把 `.glb` 文件直接拖进 3D 窗口）。
3. 点 **导入 JSON 清单** 或 **粘贴名称列表**（一行一个名称）。
4. **采集模式**下点左侧名称，在模型对应位置单击 → 自动记录坐标并跳到下一个。
5. 全部点完后 **导出坐标 JSON**。

想先体验？点工具栏的 **加载示例项目**（兰家湾废水处理厂，含 19 个构筑物和模型）。

## 清单支持格式

| 格式 | 示例 |
| --- | --- |
| 一行一个名称 | `点位A\n点位B` |
| 字符串数组 | `["点位A", "点位B"]` |
| 对象数组 | `[{"name":"点位A","center":[1,2,3]}]` |
| 工程格式 | `{"structures":[{"name":"点位A"}]}` |
| 名称映射 | `{"点位A":[1,2,3],"点位B":null}` |

## 导出说明

- **导出坐标 JSON**：`{名称: [x,y,z]}`，供业务系统使用。
- **导出完整工程**：含模型指纹（SHA-256）、坐标系说明、包围盒、点位列表，便于下次继续。
- **导出草稿 / 导入草稿**：把当前进度（清单 + 已采坐标）存成文件，换浏览器/换电脑可恢复（模型文件需另行提供）。

## 目录结构

```text
glb-coordinate-platform/
├── start.bat / start.sh          # 一键启动入口（调用 scripts/start.py）
├── app/                          # Web 应用根目录（服务器以此提供服务）
│   ├── index.html                # 页面结构
│   ├── styles.css                # 样式
│   ├── src/                      # 模块化源码
│   │   ├── main.js               # 入口：初始化、事件、渲染循环
│   │   ├── state.js              # 全局状态 + 草稿存取 + 工具函数
│   │   ├── scene.js              # three.js 场景（相机/灯光/网格/loader）
│   │   ├── loader.js             # 模型加载 + 采点 + marker + 视角
│   │   ├── structures.js         # 清单解析（5 种格式）
│   │   ├── ui.js                 # 列表/统计/提示/toast 渲染
│   │   ├── export.js             # 导出坐标/工程/草稿、迁移旧版坐标
│   │   └── examples.js           # 加载示例项目
│   ├── vendor/three/             # 离线 three.js v0.160（含 DRACO 解码器）
│   └── examples/ljw/             # 示例项目：模型 + 清单 + 参考图
├── scripts/
│   ├── start.py                  # 跨平台启动脚本（核心）
│   ├── start.ps1 / start.bat     # 向后兼容入口
│   └── compress_model.py         # GLB 压缩工具（DRACO + 纹理优化）
├── app_main.py                   # 统一入口（服务器 + 压缩），也是打包入口
├── build.py                      # 一键打包脚本
├── build.spec                    # PyInstaller 打包配置
└── docs/
    ├── 通用工具使用说明.md        # 详细使用说明
    ├── DESIGN.md / DATA_CONTRACT.md / WORKFLOW.md
    └── *.legacy.*                # 历史文档备份
```

## 打包成应用程序（exe）

把工具封装成单个 `CoordinateCollector.exe`，双击即用，无需安装 Python，完全离线。

### 打包方法
```bash
pip install pyinstaller      # 一次性安装打包工具
python build.py --clean      # 执行打包
```
产物在 `dist/CoordinateCollector.exe`（约 15MB）。

### exe 用法
- **双击** `CoordinateCollector.exe` → 自动找端口、启动服务、打开浏览器。
- **命令行压缩模型**：
  ```bash
  CoordinateCollector.exe --compress 输入.glb 输出.glb --quality medium
  ```

> exe 不内置任何模型（通用工具定位）。模型由用户在界面里上传，或用上面的压缩命令准备。打包内容：网页资源 + three.js 离线库 + Python 运行时，**不含示例 GLB**（用户自带任意模型）。

## 坐标是否通用

坐标绑定到**同一个 GLB 的局部坐标系**（原点、缩放、朝向、几何一致时有效）。

- ✅ 仍有效：同一个 GLB 重新加载；只做不改原点/缩放/旋转/几何的 Draco 压缩；业务系统按相同坐标系加载。
- ❌ 会失效：重新导出时改了原点/缩放/旋转；换了模型版本；把旧版"居中场景坐标"当成新版"局部坐标"用。

若导入优化前工具打的点后位置跑偏：先加载同一个 GLB，点 **迁移旧版坐标**，再切到浏览模式抽查几个点。

## 压缩模型（可选）

103MB 的示例模型可用压缩脚本大幅减小体积：

```bash
python scripts/compress_model.py
# 或压缩任意模型：python scripts/compress_model.py 输入.glb 输出.glb --quality medium
```

需 Node.js（首次通过 npx 自动获取 gltf-transform）。采集工具会自动优先加载压缩版。

详见 [docs/通用工具使用说明.md](docs/通用工具使用说明.md)。
