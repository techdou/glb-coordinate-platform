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
        # 歄骤 1：纹理压缩（可选）。无纹理模型会让 webp 子命令报错，
        # 此时降级为直接用原始文件走 DRACO（几何压缩对无纹理模型仍有意义）。
        if tmp_tex:
            print("  [纹理转 WebP q=%d]" % p['quality'])
            tex_cmd = prefix + ['webp', src, tmp_tex, '--quality', str(p['quality'])]
            r = run_capture(tex_cmd)
            if r is None or r.returncode != 0 or not os.path.isfile(tmp_tex):
                # webp 失败：降级，用原始文件继续 DRACO
                msg = (r.stderr or r.stdout).strip() if r else "命令未找到"
                print(C.yellow("  纹理压缩跳过（%s），改为仅 DRACO" % msg))
                draco_src = src
            else:
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


def compress_glb(src, dst, quality='medium'):
    """
    压缩单个 GLB 文件（DRACO + 纹理优化），供 CLI 与 HTTP API 共用。

    参数：
        src     输入 GLB 文件路径（必须存在）
        dst     输出 GLB 文件路径
        quality high/medium/low
    返回 dict：
        {ok, error, src_size, dst_size, ratio, profile_desc, message}
        ok=False 时 error 含可读错误（含 Node.js/npx 缺失提示）。
    """
    profile = QUALITY_PROFILES.get(quality, QUALITY_PROFILES['medium'])
    if not os.path.isfile(src):
        return dict(ok=False, error='找不到输入文件 %s' % src,
                    src_size=0, dst_size=0, ratio=0,
                    profile_desc=profile['desc'], message='输入文件不存在')

    src_size = os.path.getsize(src)
    npx_cmd = detect_npx()
    success, error = try_gltf_transform(src, dst, quality, npx_cmd)

    if not success:
        # 错误信息附上排查指引，前端可直接展示
        hint = (' | 排查：1) 确认已联网（首次 npx 下载 %s）；'
                '2) 或全局安装：npm install -g %s；'
                '3) 手动验证：%s --version') % (
                    GLTF_TRANSFORM_PKG, GLTF_TRANSFORM_PKG, GLTF_TRANSFORM_BIN)
        return dict(ok=False, error=(error or '压缩失败') + hint,
                    src_size=src_size, dst_size=0, ratio=0,
                    profile_desc=profile['desc'], message='压缩失败')

    dst_size = os.path.getsize(dst) if os.path.isfile(dst) else 0
    ratio = (1 - dst_size / src_size) * 100 if src_size else 0
    return dict(ok=True, error=None,
                src_size=src_size, dst_size=dst_size, ratio=ratio,
                profile_desc=profile['desc'],
                message='压缩完成：%s → %s，缩减 %.1f%%' % (
                    human_size(src_size), human_size(dst_size), ratio))


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

    src_size = os.path.getsize(args.input) if os.path.isfile(args.input) else 0
    print(C.cyan(C.bold("GLB 模型压缩")))
    print("  输入 : %s (%s)" % (args.input, human_size(src_size)))
    print("  输出 : %s" % args.output)
    print("  质量 : %s（%s）" % (args.quality, QUALITY_PROFILES[args.quality]['desc']))
    print("-" * 50)

    result = compress_glb(args.input, args.output, args.quality)

    if not result['ok']:
        print(C.red("\n压缩失败：%s" % result['error']), file=sys.stderr)
        return 1

    print(C.green("\n压缩完成 ✓"))
    print("  原始 : %s" % human_size(result['src_size']))
    print("  压缩 : %s" % human_size(result['dst_size']))
    print("  缩减 : %.1f%%" % result['ratio'])
    print(C.green("  压缩后的 GLB 可在工具里点「选择 GLB / STL 模型」导入使用。"))
    return 0


if __name__ == '__main__':
    sys.exit(main())
