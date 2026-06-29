#!/usr/bin/env bash
# ============================================================
#  通用 3D 坐标采集工具 —— macOS/Linux 一键启动
#  调用跨平台 Python 脚本 scripts/start.py
#
#  使用：双击（需文件管理器支持）或在终端：
#        ./start.sh
#        ./start.sh --port 8010 --no-browser
# ============================================================
set -e
cd "$(dirname "$0")"

# 依次尝试 python3 / python
PYTHON=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    PYTHON="$candidate"
    break
  fi
done

if [ -z "$PYTHON" ]; then
  echo "[错误] 未找到 Python。请安装 Python 3.6 以上版本。"
  echo "        macOS:  brew install python3"
  echo "        Ubuntu: sudo apt install python3"
  exit 1
fi

exec "$PYTHON" scripts/start.py "$@"
