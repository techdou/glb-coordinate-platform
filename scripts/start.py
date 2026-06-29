#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通用 3D 坐标采集工具 —— 跨平台一键启动脚本

自动选择空闲端口、启动本地静态服务器、打开默认浏览器。
支持 Windows / macOS / Linux，仅需 Python 3.6+（标准库，无需安装任何依赖）。

用法：
    python scripts/start.py                 # 默认端口 8000，自动开浏览器
    python scripts/start.py --port 8010     # 指定起始端口
    python scripts/start.py --no-browser    # 不自动打开浏览器
    python scripts/start.py --host 0.0.0.0  # 允许局域网访问（默认仅本机）
"""

import argparse
import functools
import http.server
import os
import socket
import socketserver
import sys
import threading
import time
import webbrowser
from datetime import datetime

# Windows 下强制 stdout/stderr 用 UTF-8，避免中文在 GBK 控制台乱码
# （配合 start.bat 里的 chcp 65001，双击启动时中文显示正常）
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# 默认配置
DEFAULT_PORT = 8000
MAX_PORT_ATTEMPTS = 100  # 最多尝试多少个连续端口


# ---------------------------------------------------------------------------
# 路径定位：兼容直接运行 / 双击运行 / 被其它脚本调用
# ---------------------------------------------------------------------------
def resolve_app_root():
    """返回 app/ 目录的绝对路径。"""
    here = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(here)
    app_root = os.path.join(project_root, "app")
    return app_root, project_root


# ---------------------------------------------------------------------------
# 端口探测
# ---------------------------------------------------------------------------
def is_port_free(host, port):
    """判断 host:port 是否可绑定（即空闲）。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def find_free_port(host, start_port):
    """从 start_port 开始找一个空闲端口，最多尝试 MAX_PORT_ATTEMPTS 个。"""
    for offset in range(MAX_PORT_ATTEMPTS):
        candidate = start_port + offset
        if is_port_free(host, candidate):
            return candidate
    raise RuntimeError(
        "从端口 {} 开始的连续 {} 个端口均被占用，请用 --port 指定其它端口。".format(
            start_port, MAX_PORT_ATTEMPTS
        )
    )


# ---------------------------------------------------------------------------
# 静态服务器：支持 Range（部分大文件下载，模型加载更稳）和中文文件名
# ---------------------------------------------------------------------------
class RangeRequestHandler(http.server.SimpleHTTPRequestHandler):
    """继承标准 handler，自动获得 HTTP Range 支持（大 GLB 模型按需读取）。"""

    # 默认 SimpleHTTPRequestHandler 已支持 Range（Python 3.7+），这里仅做扩展。
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
        ".wasm": "application/wasm",
        ".json": "application/json; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
    }

    def end_headers(self):
        # 允许 ES module 跨文件 import（本地服务无害，浏览器更宽松）
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def log_message(self, format, *args):
        # 简化日志：带时间戳，便于排查；只显示方法、路径、状态码
        ts = datetime.now().strftime("%H:%M:%S")
        sys.stderr.write(
            "  %s - %s - %s\n" % (ts, self.address_string(), format % args)
        )


# ---------------------------------------------------------------------------
# 带端口复用、优雅退出的服务器
# ---------------------------------------------------------------------------
class ReusableServer(socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def serve(app_root, host, port):
    """在 app_root 启动静态服务器，阻塞直至 Ctrl+C。"""
    # 切换到 app 目录，让 SimpleHTTPRequestHandler 以它为根
    original_cwd = os.getcwd()
    os.chdir(app_root)
    try:
        handler = functools.partial(RangeRequestHandler, directory=app_root)
        server = ReusableServer((host, port), handler)
        return server
    finally:
        os.chdir(original_cwd)


# ---------------------------------------------------------------------------
# 浏览器打开（延迟一点，确保服务器已监听）
# ---------------------------------------------------------------------------
def open_browser_later(url, delay=0.6):
    def _open():
        time.sleep(delay)
        try:
            webbrowser.open(url)
        except Exception:
            pass  # 打不开浏览器不致命，用户可手动访问

    threading.Thread(target=_open, daemon=True).start()


# ---------------------------------------------------------------------------
# 控制台彩色输出（终端不支持时自动降级）
# ---------------------------------------------------------------------------
class Color:
    def __init__(self):
        self.enabled = self._detect_color()

    @staticmethod
    def _detect_color():
        if not sys.stdout.isatty():
            return False
        # Windows 终端对 ANSI 的支持参差，仅在明确支持时开启
        if sys.platform.startswith("win"):
            try:
                import ctypes

                kernel32 = ctypes.windll.kernel32
                # ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004
                kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
                return True
            except Exception:
                return False
        return True

    def wrap(self, text, code):
        if not self.enabled:
            return text
        return "\033[%sm%s\033[0m" % (code, text)

    def cyan(self, text):
        return self.wrap(text, "36")

    def yellow(self, text):
        return self.wrap(text, "33")

    def green(self, text):
        return self.wrap(text, "32")

    def bold(self, text):
        return self.wrap(text, "1")


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="通用 3D 坐标采集工具 —— 本地服务器一键启动",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "-p", "--port", type=int, default=DEFAULT_PORT,
        help="起始端口（默认 %d，被占用则自动递增）" % DEFAULT_PORT,
    )
    parser.add_argument(
        "--host", default="127.0.0.1",
        help="监听地址（默认 127.0.0.1 仅本机；0.0.0.0 允许局域网访问）",
    )
    parser.add_argument(
        "--no-browser", action="store_true",
        help="不自动打开浏览器",
    )
    args = parser.parse_args()

    color = Color()

    app_root, project_root = resolve_app_root()
    if not os.path.isfile(os.path.join(app_root, "index.html")):
        print(color.yellow("错误：在 %s 下找不到 index.html" % app_root), file=sys.stderr)
        print("请确认项目结构完整（app/index.html 必须存在）。", file=sys.stderr)
        return 1

    # 探测空闲端口
    try:
        actual_port = find_free_port(args.host, args.port)
    except RuntimeError as e:
        print(color.yellow(str(e)), file=sys.stderr)
        return 1

    host_display = "localhost" if args.host in ("127.0.0.1", "0.0.0.0") else args.host
    url = "http://%s:%d/index.html" % (host_display, actual_port)

    # 启动横幅
    print(color.cyan(color.bold("通用 3D 坐标采集工具")))
    print("  项目根目录 : %s" % project_root)
    print("  Web 根目录 : %s" % app_root)
    print("  访问地址   : %s" % color.green(url))
    if actual_port != args.port:
        print(color.yellow("  端口 %d 被占用，已自动改用 %d" % (args.port, actual_port)))
    if args.host == "0.0.0.0":
        print(color.yellow("  已开放局域网访问，同网段设备可用本机 IP 访问"))
    print("  按 Ctrl+C 停止服务。")
    print("-" * 52)
    sys.stdout.flush()  # 立即输出横幅，避免缓冲延迟

    # 准备服务器
    server = serve(app_root, args.host, actual_port)

    # 打开浏览器
    if not args.no_browser:
        open_browser_later(url)

    # 阻塞服务
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n" + color.cyan("正在停止服务..."))
    finally:
        server.server_close()
        print("已停止。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
