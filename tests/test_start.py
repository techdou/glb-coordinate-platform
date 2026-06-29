#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
单元测试：端口探测逻辑（scripts/start.py）

只用 Python 标准库 unittest，无需第三方依赖。
运行：python -m unittest tests.test_start
"""

import os
import socket
import sys
import unittest

# 把项目根目录加入 import 路径，以便 import scripts.start
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "scripts"))

import start  # noqa: E402  （scripts/start.py）


class TestIsPortFree(unittest.TestCase):
    """is_port_free：能否正确区分空闲/占用端口。"""

    def test_free_port_returns_true(self):
        # 先占一个端口，再释放，确认 is_port_free 对已释放端口返回 True。
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        self.assertTrue(start.is_port_free("127.0.0.1", port))

    def test_occupied_port_returns_false(self):
        # 占住一个端口，确认 is_port_free 对它返回 False。
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(("127.0.0.1", 0))
            sock.listen(1)
            port = sock.getsockname()[1]
            self.assertFalse(start.is_port_free("127.0.0.1", port))
        finally:
            sock.close()


class TestFindFreePort(unittest.TestCase):
    """find_free_port：从起始端口向后扫描。"""

    def test_finds_free_port_at_or_after_start(self):
        # 找到的端口应 >= 起始端口，且确实可绑定。
        start_port = _random_high_port_base()
        found = start.find_free_port("127.0.0.1", start_port)
        self.assertGreaterEqual(found, start_port)
        self.assertTrue(start.is_port_free("127.0.0.1", found))

    def test_skips_occupied_port(self):
        # 占住起始端口，find_free_port 应回退到下一个可用端口。
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.bind(("127.0.0.1", 0))
            sock.listen(1)
            occupied = sock.getsockname()[1]
            # 从被占用端口开始找，应返回一个不同的端口
            found = start.find_free_port("127.0.0.1", occupied)
            self.assertNotEqual(found, occupied)
            self.assertTrue(start.is_port_free("127.0.0.1", found))
        finally:
            sock.close()


def _random_high_port_base():
    """取一个大概率未被占用的高位端口作为扫描起点（避开已知占用）。"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]
    finally:
        sock.close()


if __name__ == "__main__":
    unittest.main()
