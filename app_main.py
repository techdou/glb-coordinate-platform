#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通用 3D 坐标采集工具 —— 统一入口（也是 PyInstaller 打包入口）

两种运行模式：
  1. 默认：启动本地静态服务器 + 打开浏览器（= start.py 的功能）
  2. --compress：执行 GLB 模型压缩（= compress_model.py 的功能）

路径解析兼容三种场景：
  - 开发时直接运行（基于 __file__ 定位 app/）
  - PyInstaller 打包后（基于 sys._MEIPASS 解包目录定位 app/）
  - 双击 exe（当前工作目录可能在别处，不依赖 cwd）

用法：
  python app_main.py                       # 启动服务器并开浏览器
  python app_main.py --port 8010           # 指定端口
  python app_main.py --no-browser          # 不开浏览器
  python app_main.py --compress in.glb out.glb --quality medium
"""

import argparse
import os
import sys


# ---------------------------------------------------------------------------
# 资源根目录解析（兼容 PyInstaller 冻结环境）
# ---------------------------------------------------------------------------
def resolve_app_root():
    """
    返回 app/ 目录的绝对路径。
    - 打包后（frozen）：PyInstaller 把 app/ 解包到 sys._MEIPASS，即 _MEIPASS/app
    - 开发时：基于本文件位置定位 <project>/app
    """
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        # PyInstaller onefile：_MEIPASS 是临时解包目录
        base = sys._MEIPASS
    elif getattr(sys, "frozen", False):
        # PyInstaller onedir：exe 同级目录
        base = os.path.dirname(sys.executable)
    else:
        # 开发模式：本文件在项目根目录，app/ 在同级
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, "app"), base


def get_scripts_dir():
    """返回 scripts/ 目录（开发模式）或 None（打包模式，无 scripts）。"""
    if getattr(sys, "frozen", False):
        return None
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "scripts")


# ---------------------------------------------------------------------------
# Windows 控制台 UTF-8（中文显示）
# ---------------------------------------------------------------------------
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# 模式 1：启动服务器
# ---------------------------------------------------------------------------
def run_server(args):
    # 复用 scripts/start.py 的完整逻辑，仅替换其中的路径解析
    import importlib.util

    scripts_dir = get_scripts_dir()
    if scripts_dir:
        # 开发模式：从 scripts/start.py 加载
        spec = importlib.util.spec_from_file_location(
            "start", os.path.join(scripts_dir, "start.py"))
        start_module = importlib.util.module_from_spec(spec)
        # 用本模块的 resolve_app_root 覆盖 start 模块里的同名函数
        sys.modules["start"] = start_module
        spec.loader.exec_module(start_module)
        start_module.resolve_app_root = resolve_app_root
    else:
        # 打包模式：start.py 已被打包进 exe（通过 --add-data），从 _MEIPASS 加载
        start_path = os.path.join(sys._MEIPASS, "start.py")
        spec = importlib.util.spec_from_file_location("start", start_path)
        start_module = importlib.util.module_from_spec(spec)
        sys.modules["start"] = start_module
        spec.loader.exec_module(start_module)
        start_module.resolve_app_root = resolve_app_root

    # 构造与 start.py main() 一致的 argv
    server_argv = []
    if args.port:
        server_argv += ["--port", str(args.port)]
    if args.host:
        server_argv += ["--host", args.host]
    if args.no_browser:
        server_argv.append("--no-browser")
    sys.argv = [sys.argv[0]] + server_argv
    return start_module.main()


# ---------------------------------------------------------------------------
# 模式 2：压缩模型
# ---------------------------------------------------------------------------
def run_compress(args):
    import importlib.util

    scripts_dir = get_scripts_dir()
    if scripts_dir:
        compress_path = os.path.join(scripts_dir, "compress_model.py")
    else:
        compress_path = os.path.join(sys._MEIPASS, "compress_model.py")

    if not os.path.isfile(compress_path):
        print("错误：找不到压缩脚本 compress_model.py", file=sys.stderr)
        return 1

    spec = importlib.util.spec_from_file_location("compress_model", compress_path)
    compress_module = importlib.util.module_from_spec(spec)
    sys.modules["compress_model"] = compress_module
    spec.loader.exec_module(compress_module)

    # 构造 argv 传给 compress_model.main()
    compress_argv = []
    if args.input:
        compress_argv.append(args.input)
    if args.output:
        compress_argv.append(args.output)
    if args.quality:
        compress_argv += ["--quality", args.quality]
    sys.argv = [sys.argv[0]] + compress_argv
    return compress_module.main()


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="通用 3D 坐标采集工具（启动服务器或压缩模型）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--compress", action="store_true",
        help="切换到模型压缩模式（而非启动服务器）",
    )
    # 服务器参数
    parser.add_argument("-p", "--port", type=int, default=None,
                        help="服务器起始端口（默认 8000）")
    parser.add_argument("--host", default=None,
                        help="监听地址（默认 127.0.0.1）")
    parser.add_argument("--no-browser", action="store_true",
                        help="不自动打开浏览器")
    # 压缩参数
    parser.add_argument("input", nargs="?", default=None,
                        help="压缩模式：输入 GLB 文件")
    parser.add_argument("output", nargs="?", default=None,
                        help="压缩模式：输出 GLB 文件")
    parser.add_argument("--quality", default=None,
                        choices=["high", "medium", "low"],
                        help="压缩质量档位（默认 medium）")
    args = parser.parse_args()

    if args.compress:
        return run_compress(args)
    else:
        return run_server(args)


if __name__ == "__main__":
    sys.exit(main())
