# 数据契约

上传渲染平台时，建议同时上传：

- GLB 文件：例如 `modelToUse.glb`。
- 完整工程 JSON：网页里点击“导出完整工程”得到的 `coordinate_project_*.json`。

## 完整工程 JSON

```json
{
  "meta": {
    "tool": "generic-3d-coordinate-collector",
    "schemaVersion": "1.0.0",
    "model": "modelToUse.glb",
    "coordinateSystem": "GLB model local coordinates",
    "generatedAt": "2026-06-19T00:00:00.000Z"
  },
  "modelState": {
    "fileName": "modelToUse.glb",
    "sourcePath": "assets/models/modelToUse.glb",
    "fileSizeBytes": 107913184,
    "sha256": "0556ec935b7954337496bd2a695301cfae77d529c7a0099ffc86c23f5f42ce16",
    "identityHint": "Use the same GLB file, or a file with unchanged origin, scale, rotation, and geometry.",
    "localBoundingBox": {
      "min": [-1, -0.2542, -0.8978],
      "max": [1, 0.2542, 0.8978]
    },
    "localSize": [2, 0.5084, 1.7956],
    "localCenter": [0, 0, 0],
    "viewerTransform": {
      "displayCenterOffset": [0, 0, 0],
      "explanation": "The viewer subtracts this center only for display. Exported marker centers remain in original GLB local coordinates."
    }
  },
  "structures": [
    {
      "id": 1,
      "name": "预处理及进水在线监测用房",
      "center": [-0.12, 0.03, 0.48],
      "status": "已采集",
      "size_real": "45.0m x 48.0m x 5.5m",
      "count": "1 座",
      "note": "业务备注"
    }
  ]
}
```

## 平台匹配规则

渲染平台应按下面规则还原点位：

1. 加载同一个 GLB。
2. 优先校验 `modelState.sha256` 和 `modelState.fileSizeBytes`。
3. 不额外改变模型根节点的 `position`、`rotation`、`scale`。
4. 对每个 `structure.center` 创建标注对象。
5. 标注对象的位置直接使用 GLB 局部坐标。
6. 如果平台必须对模型做变换，需要对点位应用同一个变换矩阵。

Three.js 示例：

```js
const marker = new THREE.Mesh(markerGeometry, markerMaterial);
marker.position.set(...structure.center);
modelRoot.add(marker);
```

## 必须校验

- `structures[*].center` 必须是 `null` 或长度为 3 的数字数组。
- `modelState.localBoundingBox` 应与平台加载后的模型包围盒接近。
- 同一项目中更换 GLB 后，不要直接复用旧坐标，先做抽样校验。

## 建议后端保存字段

- `projectId`
- `modelVersion`
- `modelFileName`
- `modelFileSha256`
- `modelBoundingBox`
- `coordinateProjectJson`
- `createdAt`
- `createdBy`
