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
import io
import json
import os
import socket
import socketserver
import sys
import tempfile
import threading
import time
import webbrowser
import zipfile
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

    # ------------------------------------------------------------------
    # API：POST /api/compress —— 接收 GLB 文件，调用 gltf-transform 压缩后返回
    # ------------------------------------------------------------------
    def do_OPTIONS(self):
        """CORS 预检（同源其实不需要，保险起见返回 204）。"""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if self.path == "/api/compress":
            self._handle_compress()
        elif self.path == "/api/export-demo":
            self._handle_export_demo()
        else:
            self._send_json(404, {"ok": False, "error": "未知接口"})

    def _handle_compress(self):
        # 1. 读完整请求体
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            self._send_json(400, {"ok": False, "error": "请求体为空"})
            return
        body = self.rfile.read(length)

        # 2. 解析 multipart/form-data，取出文件字节与质量档
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype:
            self._send_json(400, {"ok": False, "error": "需要 multipart/form-data"})
            return
        fields = self._parse_multipart(body, ctype)
        file_field = fields.get("file")
        quality_raw = fields.get("quality", {})
        quality = (quality_raw.get("data") or b"medium").decode("utf-8", "replace")
        if not file_field or not file_field.get("data"):
            self._send_json(400, {"ok": False, "error": "未收到 GLB 文件"})
            return

        src_name = file_field.get("filename", "upload.glb")
        if not src_name.lower().endswith(".glb"):
            self._send_json(400, {"ok": False, "error": "仅支持 .glb 文件"})
            return

        # 3. 落盘到临时文件再压缩（gltf-transform 只处理磁盘文件）
        tmpdir = tempfile.mkdtemp(prefix="glb_compress_")
        tmp_src = os.path.join(tmpdir, "input.glb")
        tmp_dst = os.path.join(tmpdir, "output.glb")
        try:
            with open(tmp_src, "wb") as f:
                f.write(file_field["data"])

            cm = self._load_compress_module()
            if cm is None:
                self._send_json(500, {"ok": False,
                    "error": "服务器找不到压缩模块 compress_model.py"})
                return

            result = cm.compress_glb(tmp_src, tmp_dst, quality)

            if not result["ok"]:
                self._send_json(500, {"ok": False, "error": result["error"]})
                return

            # 4. 成功：返回压缩后的 GLB 字节
            with open(tmp_dst, "rb") as f:
                compressed = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "model/gltf-binary")
            self.send_header("Content-Length", str(len(compressed)))
            # 声明自定义头可被前端 JS 读取（同源不需要，分离部署时需要）
            self.send_header("Access-Control-Expose-Headers",
                             "X-Src-Size, X-Dst-Size, X-Ratio, X-Desc")
            # 元信息放响应头，前端读 X-*
            self.send_header("X-Src-Size", str(result["src_size"]))
            self.send_header("X-Dst-Size", str(result["dst_size"]))
            self.send_header("X-Ratio", "%.1f" % result["ratio"])
            # X-Desc 含中文，ASCII 头用 backslashreplace 转义避免编码问题
            self.send_header("X-Desc", result["profile_desc"].encode("ascii", "backslashreplace").decode("ascii"))
            self.end_headers()
            self.wfile.write(compressed)
        finally:
            # 清理临时文件（compress_glb 内部的 .tmp1.glb 也在此目录）
            import shutil
            shutil.rmtree(tmpdir, ignore_errors=True)

    def _parse_multipart(self, body, ctype):
        """轻量解析 multipart/form-data，返回 {field: {data, filename}}。

        标准库无现成 multipart 解析，这里按 boundary 切分二进制 body。
        仅处理本接口需要的简单表单（一个文件 + 一个文本字段）。
        """
        fields = {}
        # 取 boundary（Content-Type: multipart/form-data; boundary=...）
        boundary = None
        for part in ctype.split(";"):
            part = part.strip()
            if part.startswith("boundary="):
                boundary = part[len("boundary="):].strip('"')
                break
        if not boundary:
            return fields
        delim = b"--" + boundary.encode("ascii")

        # 按分隔符切块。每个 part 形如：头\r\n\r\n数据\r\n
        # 注意：不能用 strip() 处理整个 seg，否则文件数据首尾的 \r\n 会被误删（数据损坏）。
        segments = body.split(delim)
        for seg in segments:
            # 跳过前导 preamble 和结尾 "--"
            if not seg or seg in (b"--", b"--\r\n"):
                continue
            # 定位头与数据的分界 \r\n\r\n
            header_end = seg.find(b"\r\n\r\n")
            if header_end < 0:
                continue
            header_bytes = seg[:header_end].decode("utf-8", "replace")
            data = seg[header_end + 4:]
            # part 数据末尾的 \r\n 是 multipart 终止符，精确去掉这一个，
            # 绝不能用 strip（会误伤文件内部首尾的 \r\n 字节）。
            if data.endswith(b"\r\n"):
                data = data[:-2]
            # 解析头里的 name 和 filename
            name = None
            filename = None
            for line in header_bytes.split("\r\n"):
                if line.lower().startswith("content-disposition:"):
                    for kv in line.split(";"):
                        kv = kv.strip()
                        if kv.startswith("name="):
                            name = kv[5:].strip('"')
                        elif kv.startswith("filename="):
                            filename = kv[9:].strip('"')
            if name:
                fields[name] = {"data": data, "filename": filename}
        return fields

    def _load_compress_module(self):
        """动态加载 compress_model 模块（开发模式从 scripts/，打包模式从 _MEIPASS/）。"""
        import importlib.util
        path = _resolve_compress_path()
        if not path or not os.path.isfile(path):
            return None
        spec = importlib.util.spec_from_file_location("compress_model", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def _send_json(self, code, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle_export_demo(self):
        """打包一个可直接运行的示例展示页 zip（index.html + data.json + model.glb）。"""
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            self._send_json(400, {"ok": False, "error": "请求体为空"})
            return
        body = self.rfile.read(length)

        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype:
            self._send_json(400, {"ok": False, "error": "需要 multipart/form-data"})
            return
        fields = self._parse_multipart(body, ctype)

        meta_field = fields.get("meta")
        if not meta_field or not meta_field.get("data"):
            self._send_json(400, {"ok": False, "error": "缺少 meta 元信息"})
            return
        try:
            meta = json.loads(meta_field["data"].decode("utf-8"))
        except Exception as e:
            self._send_json(400, {"ok": False, "error": "meta 解析失败：%s" % e})
            return

        file_field = fields.get("file")
        model_bytes = file_field["data"] if file_field and file_field.get("data") else None

        # 生成 zip（内存打包）
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            # 1. data.json —— 坐标 + 元信息（给 agent 的数据契约参考）
            zf.writestr("data.json", json.dumps(meta, ensure_ascii=False, indent=2))
            # 2. index.html —— 示例展示页
            html = build_demo_html(meta)
            zf.writestr("index.html", html.encode("utf-8"))
            # 3. model.glb —— 原始模型字节（如有）
            if model_bytes:
                zf.writestr(meta.get("modelFileName", "model.glb"), model_bytes)

        zip_bytes = buf.getvalue()
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Length", str(len(zip_bytes)))
        self.send_header("Content-Disposition",
                         'attachment; filename="demo.zip"')
        self.end_headers()
        self.wfile.write(zip_bytes)


def _resolve_compress_path():
    """定位 compress_model.py：开发模式用 scripts/，打包模式用 sys._MEIPASS/。"""
    if getattr(sys, "frozen", False):
        base = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
        return os.path.join(base, "compress_model.py")
    # 开发模式：本文件在 scripts/ 下，compress_model.py 在同级
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "compress_model.py")


# ---------------------------------------------------------------------------
# 示例展示页 HTML 模板：解压即见"模型 + 标记点 + 侧边名称列表联动"。
# 元信息通过 JSON 注入 window.__DEMO_DATA__，模板 JS 直接读取，避免占位符冲突。
# ---------------------------------------------------------------------------
def build_demo_html(meta):
    """根据 meta 元信息生成示例展示页 HTML 字符串。"""
    meta_json = json.dumps(meta, ensure_ascii=False, indent=2)
    model_file = meta.get("modelFileName", "model.glb")
    has_model = meta.get("hasModel", False)
    title = (meta.get("modelLabel") or "3D 展示").replace("<", "").replace(">", "")
    points = [s for s in meta.get("structures", []) if s.get("center")]
    point_count = len(points)

    # 无模型时的提示文案
    no_model_hint = "" if has_model else (
        "<div class=\"banner warn\">未包含模型文件。请把同目录结构的 <code>%s</code> 放到本 HTML 旁边再刷新。</div>"
        % model_file
    )

    return _DEMO_HTML_TEMPLATE.substitute(
        title=title,
        point_count=point_count,
        model_file=model_file,
        meta_json=meta_json,
        no_model_hint=no_model_hint,
    )


from string import Template

_DEMO_HTML_TEMPLATE = Template(r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} · 3D 展示</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; overflow: hidden; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; }
  body { background: #0b1117; color: #edf3f7; }
  #app { display: grid; grid-template-columns: 280px 1fr; height: 100%; }
  #sidebar { border-right: 1px solid #2c3a43; background: #151c22; display: flex; flex-direction: column; min-height: 0; }
  .sb-head { padding: 14px 16px; border-bottom: 1px solid #2c3a43; }
  .sb-head h1 { font-size: 15px; margin-bottom: 4px; }
  .sb-head p { font-size: 11px; color: #91a2ad; line-height: 1.5; }
  #list { flex: 1; overflow-y: auto; padding: 8px; list-style: none; }
  #list li { padding: 10px 12px; margin-bottom: 6px; border-radius: 6px; border-left: 3px solid #2c3a43; background: rgba(255,255,255,.04); cursor: pointer; font-size: 13px; transition: background .15s; }
  #list li:hover { background: rgba(255,255,255,.08); }
  #list li.active { border-left-color: #e6b450; background: rgba(230,180,80,.13); }
  #list li .coord { display: block; margin-top: 3px; font-size: 11px; color: #91a2ad; font-family: Consolas, monospace; }
  #viewer { position: relative; }
  canvas { display: block; }
  .banner { position: absolute; top: 12px; left: 12px; right: 12px; padding: 10px 14px; border-radius: 7px; background: rgba(10,14,18,.85); font-size: 12px; line-height: 1.5; }
  .banner code { background: #0f151a; padding: 1px 5px; border-radius: 3px; }
  .banner.warn { border: 1px solid rgba(230,180,80,.4); color: #ffe3a3; }
  .banner.info { border: 1px solid rgba(255,255,255,.12); }
  #label { position: absolute; pointer-events: none; padding: 4px 9px; background: rgba(12,16,20,.9); border: 1px solid #e6b450; border-radius: 5px; font-size: 12px; white-space: nowrap; transform: translate(-50%, -130%); display: none; }
</style>
</head>
<body>
<div id="app">
  <aside id="sidebar">
    <div class="sb-head">
      <h1>${title}</h1>
      <p>${point_count} 个点位 · GLB 局部坐标系 · 点击列表飞行定位</p>
    </div>
    <ul id="list"></ul>
  </aside>
  <main id="viewer">
    <div class="banner info">模型：<code>${model_file}</code> · ${point_count} 个点位 · 拖拽旋转/滚轮缩放/右键平移 · 首次打开需联网加载 three.js</div>
    ${no_model_hint}
    <div id="label"></div>
  </main>
</div>

<!-- 元信息注入：坐标 + 模型信息（给二次开发参考的数据契约） -->
<script>window.__DEMO_DATA__ = ${meta_json};</script>

<script type="importmap">
{ "imports": {
  "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
  "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
}}
</script>

<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const DATA = window.__DEMO_DATA__;
const MODEL_FILE = DATA.modelFileName || 'model.glb';

// STL 统一渲染材质（与打标工具一致：双面防看穿，标准 PBR）
const STL_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xb8c4cc, metalness: 0.1, roughness: 0.75, side: THREE.DoubleSide
});

// 按扩展名分发 loader，统一返回一个 Object3D 根节点。
function loadModelFile(url) {
  const ext = url.toLowerCase().split('.').pop();
  if (ext === 'stl') {
    return new Promise((resolve, reject) => {
      new STLLoader().load(url, (geometry) => {
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, STL_MATERIAL);
        const group = new THREE.Group();
        group.add(mesh);
        resolve(group);
      }, undefined, reject);
    });
  }
  // glb / gltf
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

// ---- 场景 / 相机 / 渲染器 ----
const viewer = document.getElementById('viewer');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1117);
const camera = new THREE.PerspectiveCamera(48, viewer.clientWidth / viewer.clientHeight, 0.001, 100000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(viewer.clientWidth, viewer.clientHeight);
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x34404a, 1.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const markers = [];   // { mesh, name, center }

// ---- 加载模型 ----
// 【关键】复现打标工具的居中逻辑：模型加载后 position.sub(center)，
// 导出的坐标是【原始局部坐标】，标记点位置 = model.localToWorld(原始坐标)。
loadModelFile(MODEL_FILE).then((model) => {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  // 居中（和打标工具一致）
  model.position.sub(center);
  scene.add(model);

  // 相机自动适配
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.3;
  camera.position.set(dist * 0.7, dist * 0.55, dist * 0.7);
  controls.target.set(0, 0, 0);
  // 远近裁切面按模型大小调整
  camera.near = sphere.radius / 10000;
  camera.far = sphere.radius * 10000;
  camera.updateProjectionMatrix();
  controls.update();

  // 放标记点
  placeMarkers(model);
  renderList();
  animate();
}, undefined, (err) => {
  // 模型加载失败：仍渲染标记点（在原点附近，仅示意坐标）
  console.error('模型加载失败', err);
  document.querySelector('.banner.info').innerHTML =
    '模型加载失败：<code>' + MODEL_FILE + '</code>。请确认模型文件与本 HTML 同目录。坐标数据见 <code>data.json</code>。';
  placeMarkers(new THREE.Group());  // 无模型时仍放标记（基于局部坐标原点）
  renderList();
  animate();
});

// ---- 放标记点：原始局部坐标 → 居中后的世界坐标 ----
function placeMarkers(model) {
  const points = DATA.structures.filter(s => s.center);
  const allBox = new THREE.Box3().setFromObject(model);
  const allSize = allBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(allSize.x, allSize.y, allSize.z) || 1;
  const radius = Math.max(maxDim * 0.006, 0.004);

  points.forEach((item) => {
    const [x, y, z] = item.center;
    // 坐标是模型【原始局部坐标】。模型已 position.sub(center)，
    // 用 localToWorld 把局部坐标转到当前世界坐标，标记点就对齐了。
    const worldPos = model.localToWorld(new THREE.Vector3(x, y, z));
    const geo = new THREE.SphereGeometry(radius, 18, 18);
    const mat = new THREE.MeshBasicMaterial({ color: 0xe6b450 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(worldPos);
    mesh.userData.name = item.name;
    scene.add(mesh);
    markers.push({ mesh, name: item.name, center: item.center });
  });
}

// ---- 侧边名称列表 ----
const listEl = document.getElementById('list');
function renderList() {
  listEl.innerHTML = '';
  markers.forEach((m, i) => {
    const li = document.createElement('li');
    li.innerHTML = m.name + '<span class="coord">[' + m.center.map(v => Number(v).toFixed(3)).join(', ') + ']</span>';
    li.addEventListener('click', () => flyTo(i, li));
    listEl.appendChild(li);
  });
}

// 点击列表 → 相机飞到对应点 + 高亮
function flyTo(index, liEl) {
  document.querySelectorAll('#list li').forEach(el => el.classList.remove('active'));
  if (liEl) liEl.classList.add('active');
  const m = markers[index];
  if (!m) return;
  const target = m.mesh.position.clone();
  const dist = camera.position.distanceTo(controls.target) || 10;
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  // 简单的缓动飞行
  const fromPos = camera.position.clone();
  const fromTar = controls.target.clone();
  const toPos = target.clone().addScaledVector(dir, dist);
  const start = performance.now();
  function step() {
    const t = Math.min((performance.now() - start) / 600, 1);
    const e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2;
    camera.position.lerpVectors(fromPos, toPos, e);
    controls.target.lerpVectors(fromTar, target, e);
    controls.update();
    if (t < 1) requestAnimationFrame(step);
  }
  step();
}

// ---- 鼠标悬停/点击标记 → 显示名称 ----
const labelEl = document.getElementById('label');
renderer.domElement.addEventListener('pointermove', (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(markers.map(m => m.mesh));
  if (hits.length) {
    const m = hits[0].object;
    labelEl.style.display = 'block';
    labelEl.style.left = (e.clientX - rect.left) + 'px';
    labelEl.style.top = (e.clientY - rect.top) + 'px';
    labelEl.textContent = m.userData.name;
  } else {
    labelEl.style.display = 'none';
  }
});

// ---- 渲染循环 ----
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// ---- 窗口缩放 ----
window.addEventListener('resize', () => {
  camera.aspect = viewer.clientWidth / viewer.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewer.clientWidth, viewer.clientHeight);
});
</script>
</body>
</html>
""")



# ---------------------------------------------------------------------------
# 带端口复用、优雅退出的服务器
# 用 ThreadingTCPServer：压缩接口耗时数秒~数十秒，多线程避免阻塞静态请求。
# ---------------------------------------------------------------------------
class ReusableServer(socketserver.ThreadingTCPServer):
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
