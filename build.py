#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一键打包：通用 3D 坐标采集工具 → 单个 CoordinateCollector.exe

前置：pip install pyinstaller
用法：python build.py
产物：dist/CoordinateCollector.exe

参数：
    python build.py --clean    先清理 build/ dist/ 再打包
    python build.py --no-upx   不用 UPX 压缩（若未装 UPX）
"""

import argparse
import os
import shutil
import subprocess
import sys

# Windows 控制台 UTF-8
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
SPEC_FILE = os.path.join(PROJECT_ROOT, "build.spec")
DIST_DIR = os.path.join(PROJECT_ROOT, "dist")
BUILD_DIR = os.path.join(PROJECT_ROOT, "build")
EXE_NAME = "CoordinateCollector.exe"


def ensure_pyinstaller():
    """确认 PyInstaller 可用，否则提示安装。"""
    try:
        import PyInstaller  # noqa: F401
        return True
    except ImportError:
        print("[错误] 未安装 PyInstaller。")
        print("  请运行：pip install pyinstaller")
        return False


def clean_build():
    """清理 build/ dist/ 目录。"""
    for d in (BUILD_DIR, DIST_DIR):
        if os.path.isdir(d):
            print("清理 %s ..." % d)
            shutil.rmtree(d, ignore_errors=True)


def build(clean=False):
    if not ensure_pyinstaller():
        return 1

    if not os.path.isfile(SPEC_FILE):
        print("[错误] 找不到 build.spec：%s" % SPEC_FILE)
        return 1

    if clean:
        clean_build()

    print("=" * 56)
    print("开始打包 CoordinateCollector.exe")
    print("=" * 56)

    # 用 pyinstaller 命令行调用 spec（更直观，能实时看到输出）
    cmd = [sys.executable, "-m", "PyInstaller", SPEC_FILE, "--noconfirm"]
    print("执行：%s" % " ".join(cmd))
    print("-" * 56)

    result = subprocess.run(cmd, cwd=PROJECT_ROOT)

    if result.returncode != 0:
        print("\n[错误] 打包失败（退出码 %d）。" % result.returncode)
        return result.returncode

    exe_path = os.path.join(DIST_DIR, EXE_NAME)
    if not os.path.isfile(exe_path):
        print("\n[错误] 打包完成但未找到产物：%s" % exe_path)
        return 1

    size_mb = os.path.getsize(exe_path) / (1024 * 1024)
    print("\n" + "=" * 56)
    print("打包成功 ✓")
    print("  产物 : %s" % exe_path)
    print("  体积 : %.1f MB" % size_mb)
    print("  使用 : 双击 exe 启动；命令行 %s --compress in.glb out.glb 压缩模型" % EXE_NAME)
    print("=" * 56)
    return 0


def main():
    parser = argparse.ArgumentParser(description="打包 CoordinateCollector.exe")
    parser.add_argument("--clean", action="store_true", help="先清理 build/ dist/ 再打包")
    args = parser.parse_args()
    sys.exit(build(clean=args.clean))


if __name__ == "__main__":
    main()
