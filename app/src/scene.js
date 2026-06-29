// three.js 场景核心对象：scene/camera/renderer/controls/loader/draco/grid。
// 集中管理，供 loader.js / ui.js / main.js 使用。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// 离线 DRACO 解码器：本地 vendor 目录
const DRACO_DECODER_PATH = 'vendor/three/examples/jsm/libs/draco/';

export const viewer = document.getElementById('viewer');
export const hint = document.getElementById('hint');
export const readout = document.getElementById('readout');

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1117);

export const camera = new THREE.PerspectiveCamera(48, 1, 0.001, 100000);
camera.position.set(2, 1.4, 2);

export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(viewer.clientWidth, viewer.clientHeight);
viewer.prepend(renderer.domElement);

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x34404a, 1.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.25);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);

export const grid = new THREE.GridHelper(10, 40, 0x3a4d5c, 0x1f2a33);
grid.material.transparent = true;
grid.material.opacity = 0.55;
scene.add(grid);

export const raycaster = new THREE.Raycaster();
export const pointer = new THREE.Vector2();

const draco = new DRACOLoader();
draco.setDecoderPath(DRACO_DECODER_PATH);
export const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

// STL 加载器（无 Draco 依赖，独立实例）
export const stlLoader = new STLLoader();

export { THREE };
