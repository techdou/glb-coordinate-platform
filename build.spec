# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller 打包规范：通用 3D 坐标采集工具 → 单个 CoordinateCollector.exe

打包内容：
  - app_main.py           （入口，整合服务器+压缩）
  - scripts/start.py      （服务器逻辑，被 app_main 动态加载）
  - scripts/compress_model.py （压缩逻辑，被 app_main 动态加载）
  - app/                  （网页资源，排除两个大模型 glb）

排除（用户自带或现场生成）：
  - app/examples/ljw/model.glb           （103MB）
  - app/examples/ljw/model_compressed.glb （4.6MB）

用法：python build.py  （自动调用本 spec）
"""

import os

block_cipher = None

# 项目根目录 = 本 spec 文件所在目录
PROJECT_ROOT = os.path.dirname(os.path.abspath(SPEC))

# 收集 app/ 下所有文件，但排除两个模型 glb（不进 exe，减小体积）
def collect_app_data():
    """返回 app/ 下所有需要打包的文件 [(src, dest_dir), ...]，排除 .glb 模型。"""
    app_dir = os.path.join(PROJECT_ROOT, 'app')
    datas = []
    for root, dirs, files in os.walk(app_dir):
        for fname in files:
            # 排除大模型文件（用户自带或现场生成）
            if fname.endswith('.glb') and fname.startswith('model'):
                continue
            src = os.path.join(root, fname)
            # 目标目录：保持相对 app/ 的结构
            rel_dir = os.path.relpath(root, PROJECT_ROOT)
            datas.append((src, rel_dir))
    return datas

app_datas = collect_app_data()

# scripts 下需要动态加载的 py 文件（放到 exe 解包根目录，与 _MEIPASS 同级）
script_files = ['start.py', 'compress_model.py']
script_datas = [
    (os.path.join(PROJECT_ROOT, 'scripts', f), '.')
    for f in script_files
    if os.path.isfile(os.path.join(PROJECT_ROOT, 'scripts', f))
]

a_datas = app_datas + script_datas

# -----------------------------------------------------------------
# 分析入口
# -----------------------------------------------------------------
# hiddenimports：app_main.py 动态加载 start.py/compress_model.py，
# PyInstaller 静态分析看不到它们 import 的模块，这里显式声明（全是标准库）。
hidden_imports = [
    'http', 'http.server',
    'socketserver',
    'argparse', 'functools', 'socket', 'threading', 'time', 'webbrowser',
    'shutil', 'subprocess',
    # /api/compress 与 /api/export-demo 接口用到的标准库（start.py 动态加载，需显式声明）
    'tempfile', 'json', 'email', 'io', 'zipfile', 'string',
]

a_analysis = Analysis(
    [os.path.join(PROJECT_ROOT, 'app_main.py')],
    pathex=[PROJECT_ROOT],
    binaries=[],
    datas=a_datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a_analysis.pure, a_analysis.zipped_data, cipher=block_cipher)

# -----------------------------------------------------------------
# 单文件 exe
# -----------------------------------------------------------------
exe = EXE(
    pyz,
    a_analysis.scripts,
    a_analysis.binaries,
    a_analysis.zipfiles,
    a_analysis.datas,
    [],
    name='CoordinateCollector',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    runtime_tmpdir=None,
    console=True,          # 保留控制台：用户需要看到访问地址
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # icon='assets/icon.ico',  # 可选：生成 ico 后取消注释
)
