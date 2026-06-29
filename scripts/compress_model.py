#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通用 GLB 模型压缩脚本

把任意 GLB 模型压缩为带 DRACO 几何压缩 + 纹理优化（KTX2/WebP）的版本，
显著减小体积（通常 60%–80%），加载更快。坐标采集工具会优先加载压缩版。

工具链选择（自动检测）：
  1. gltf-transform（Node.js，推荐）—— 通过 npx 自动获取，无需手动安装
  2. Blender（备选）—— 若检测到，用 bpy/gltf 导出

用法：
    python scripts/compress_model.py <input.glb> <output.glb>
    python scripts/compress_model.py                       # 默认压缩示例项目
    python scripts/compress_model.py --quality medium      # 调整质量档位

示例：
    python scripts/compress_model.py app/examples/ljw/model.glb app/examples/ljw/model_compressed.glb
"""

import argparse
import os
import shutil
import subprocess
import sys

# 质量档位：决定 DRACO 压缩级别与纹理质量
QUALITY_PROFILES = {
    # (draco_quantization_bits, 纹理格式, 纹理质量 0-100)
    'high': {
        'position': 16, 'normal': 16, 'color': 16, 'texcoord': 16,
        'texture': 'auto', 'quality': 90,
        'desc': '高保真，体积缩减较少'
    },
    'medium': {
        'position': 14, 'normal': 12, 'color': 12, 'texcoord': 12,
        'texture': 'webp', 'quality': 80,
        'desc': '平衡（推荐），体积约减 70%'
    },
    'low': {
        'position': 12, 'normal': 10, 'color': 10, 'texcoord': 10,
        'texture': 'webp', 'quality': 70,
        'desc': '高压缩，体积约减 80%，细节有损'
    },
}

# glTF Transform 的 CLI 包名（注意：旧名 gltf-transform 已 unpublish，现为带 scope 包）
GLTF_TRANSFORM_PKG = '@gltf-transform/cli'
GLTF_TRANSFORM_BIN = 'gltf-transform'


class Color:
    def __init__(self):
        self.enabled = sys.stdout.isatty()

    def _w(self, text, code):
        return "\033[%sm%s\033[0m" % (code, text) if self.enabled else text

    def green(self, t): return self._w(t, "32")
    def yellow(self, t): return self._w(t, "33")
    def red(self, t): return self._w(t, "31")
    def cyan(self, t): return self._w(t, "36")
    def bold(self, t): return self._w(t, "1")


C = Color()


def resolve_default_paths():
    """返回默认输入/输出路径（示例项目）。"""
    here = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(here)
    src = os.path.join(project_root, 'app', 'examples', 'ljw', 'model.glb')
    dst = os.path.join(project_root, 'app', 'examples', 'ljw', 'model_compressed.glb')
    return src, dst


def human_size(num_bytes):
    """把字节数转成易读的 KB/MB。"""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if num_bytes < 1024:
            return "%.1f %s" % (num_bytes, unit)
        num_bytes /= 1024
    return "%.1f TB" % num_bytes


def detect_npx():
    """检测可用的 npx。"""
    for cmd in ('npx',):
        if shutil.which(cmd):
            return cmd
    return None


def detect_gltf_transform(npx_cmd):
    """
    探测可用的 gltf-transform 调用前缀。
    返回命令前缀列表（如 ['gltf-transform'] 或 ['npx','--yes','@gltf-transform/cli']），或 None。
    优先用已全局安装的二进制，其次用 npx 临时拉取。
    注意：新版 @gltf-transform/cli 不需要 `--` 界定符，直接跟子命令。
    """
    # 1. 全局安装的二进制？
    if shutil.which(GLTF_TRANSFORM_BIN):
        return [GLTF_TRANSFORM_BIN]

    # 2. npx 临时拉取（带 scope 的包）
    if npx_cmd:
        return [npx_cmd, '--yes', GLTF_TRANSFORM_PKG]

    return None


def try_gltf_transform(src, dst, profile, npx_cmd):
    """用 gltf-transform 压缩。返回 (成功?, 错误信息)。"""
    prefix = detect_gltf_transform(npx_cmd)
    if not prefix:
        return False, "找不到 gltf-transform，且 npx 不可用"

    p = QUALITY_PROFILES[profile]
    print(C.cyan("使用 glTF Transform 进行压缩（首次会通过 npx 自动下载）..."))
    print("  质量档位: %s（%s）" % (profile, p['desc']))

    # gltf-transform 链式调用：先纹理转 WebP（若档位需要），再 DRACO 几何压缩。
    tmp_tex = None
    if p['texture'] == 'webp':
        tmp_tex = dst + '.tmp1.glb'

    try:
        # 步骤 1：纹理压缩（可选）
        if tmp_tex:
            print("  [纹理转 WebP q=%d]" % p['quality'])
            tex_cmd = prefix + ['webp', src, tmp_tex, '--quality', str(p['quality'])]
            r = run_capture(tex_cmd)
            if r is None or r.returncode != 0 or not os.path.isfile(tmp_tex):
                msg = (r.stderr or r.stdout) if r else "命令未找到"
                return False, "纹理转 WebP 失败：%s" % msg.strip()
            draco_src = tmp_tex
        else:
            draco_src = src

        # 步骤 2：DRACO 几何压缩（基于上一步输出）
        print("  [DRACO 几何压缩]")
        draco_cmd = prefix + [
            'draco', draco_src, dst,
            '--method', 'edgebreaker',
            '--quantize-position', str(p['position']),
            '--quantize-normal', str(p['normal']),
            '--quantize-color', str(p['color']),
            '--quantize-texcoord', str(p['texcoord']),
        ]
        r = run_capture(draco_cmd)
        if r is None or r.returncode != 0 or not os.path.isfile(dst):
            msg = (r.stderr or r.stdout) if r else "命令未找到"
            return False, "DRACO 压缩失败：%s" % msg.strip()
        return True, None
    finally:
        if tmp_tex and os.path.isfile(tmp_tex):
            os.remove(tmp_tex)


def run_capture(cmd):
    """
    运行命令并捕获输出，处理 FileNotFoundError。
    Windows 上 npx/gltf-transform 是 .cmd/.bat 脚本，必须经 shell 执行。
    返回 CompletedProcess 或 None（命令未找到）。
    用 UTF-8 解码输出，避免 gltf-transform 英文输出里的智能引号(0x92)
    在中文 Windows(GBK) 下触发 UnicodeDecodeError。
    """
    try:
        if os.name == 'nt':
            import subprocess as _sp
            quoted = _sp.list2cmdline(cmd)
            # text=True 会用 locale 编码(GBK)，改用 encoding='utf-8' + errors 兜底
            return _sp.run(quoted, capture_output=True, encoding='utf-8',
                           errors='replace', shell=True)
        return subprocess.run(cmd, capture_output=True, encoding='utf-8',
                              errors='replace')
    except FileNotFoundError:
        return None


def main():
    parser = argparse.ArgumentParser(
        description="GLB 模型压缩工具（DRACO + 纹理优化）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    default_src, default_dst = resolve_default_paths()
    parser.add_argument('input', nargs='?', default=default_src,
                        help='输入 GLB 文件（默认示例模型）')
    parser.add_argument('output', nargs='?', default=default_dst,
                        help='输出 GLB 文件（默认示例压缩版）')
    parser.add_argument('--quality', choices=list(QUALITY_PROFILES.keys()),
                        default='medium', help='压缩质量档位（默认 medium）')
    args = parser.parse_args()

    src = args.input
    dst = args.output

    if not os.path.isfile(src):
        print(C.red("错误：找不到输入文件 %s" % src), file=sys.stderr)
        return 1

    src_size = os.path.getsize(src)
    print(C.cyan(C.bold("GLB 模型压缩")))
    print("  输入 : %s (%s)" % (src, human_size(src_size)))
    print("  输出 : %s" % dst)
    print("-" * 50)

    npx_cmd = detect_npx()
    success, error = try_gltf_transform(src, dst, args.quality, npx_cmd)

    if not success:
        print(C.red("\n压缩失败：%s" % error), file=sys.stderr)
        print(C.yellow("排查建议："))
        print("  1. 确认已联网（首次 npx 会下载 %s）" % GLTF_TRANSFORM_PKG)
        print("  2. 或全局安装：npm install --global %s" % GLTF_TRANSFORM_PKG)
        print("  3. 手动测试：%s --version" % GLTF_TRANSFORM_BIN)
        print("  4. 或改用 Blender 导出压缩 GLB（File > Export > glTF，勾选 Draco）")
        return 1

    dst_size = os.path.getsize(dst)
    ratio = (1 - dst_size / src_size) * 100 if src_size else 0
    print(C.green("\n压缩完成 ✓"))
    print("  原始 : %s" % human_size(src_size))
    print("  压缩 : %s" % human_size(dst_size))
    print("  缩减 : %.1f%%" % ratio)
    print(C.green("  坐标采集工具会自动优先加载压缩版。"))
    return 0


if __name__ == '__main__':
    sys.exit(main())
