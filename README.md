# Shape Search 形状搜索器

"以画代搜"工具：在画布上随手画出一个形状，从图标库中检索外形相似的图标 / SVG。支持本地 DINOv2 视觉特征召回与轮廓精排；模型服务不可用时自动使用前端几何检索。

本机独立 Python 环境、模型和向量索引配置见 [本地模型使用说明](server/README.md)。已生成这些文件时，在两个终端分别运行 `npm run model:serve` 和 `npm run dev` 即可。

已接入 7 个图标库（共约 16000 个图标）：Lucide、Tabler、Heroicons（outline）、Material Symbols（outlined）、Bootstrap Icons、Phosphor Icons（regular）和 Remix Icon（line）。面板内可按库筛选，各库索引独立懒加载。

## 快速开始

```bash
npm install
npm run build:icons   # 图标来源更新时重建基础索引
npm run build:geometry # 基础索引更新后重建几何索引
npm run dev           # 启动开发服务器
```

## 工作原理

1. **离线索引**（`scripts/buildIconIndex.ts`）：每个图标库一个适配器（SVG 目录、viewBox 尺寸换算、标签来源），用 sharp 把 SVG 栅格化为 128×128 灰度图，提取形状特征并量化，按库写入独立索引文件。新增图标库只需在 `libraries` 数组中加一项。
2. **草图预处理**（`src/services/preprocess.ts`）：画布像素 → 0~1 墨量图。
3. **特征提取**（`src/services/shapeFeatures.ts`）：墨迹包围盒裁剪 → 保持长宽比缩放居中 → 16×16 密度网格（取平方根抑制粗细差异）→ L2 归一化。浏览器端与索引脚本共用同一实现，保证特征空间一致。
4. **几何检索**（`src/services/geometry.ts`、`geometrySearch.ts`）：细化轮廓、多尺度召回与双向 Chamfer 精排；仅对候选执行精排，并支持小幅平移补偿。
5. **模型检索**（`server/`、`src/services/modelSearch.ts`）：本地 DINOv2 Small 输出 384 维特征，精确向量召回与几何候选合并后精排。查询和索引采用同一预处理，索引与权重指纹不匹配时回退几何检索。

检索方式可在面板切换，默认“模型 + 轮廓”。草图可导出 PNG；可选真实手绘评测说明见 [evaluation/README.md](evaluation/README.md)。当前没有真实手绘评测数据，不承诺某项质量指标提升。

## 组件接口

`ShapeSearchPanel` 是独立组件，不依赖任何画布项目内部状态：

```tsx
<ShapeSearchPanel
  maxResults={60}
  onSelect={(result) => {/* { id, name, svg, source, score, tags } */}}
  onCopy={(result) => {}}
  onDownload={(result) => {}}
  onSearch={(query) => {}}
/>
```

独立运行时，点击图标默认复制其 SVG；未来嵌入无限画布 Sidebar 时，通过 `onSelect` 将 SVG 插入画布。

## 项目结构

```
src/components/ShapeSearchPanel   完整面板布局
src/components/SketchCanvas       绘制、橡皮、撤销、重做、导出
src/components/SearchResults      结果网格
src/components/IconCard           单个图标预览与操作
src/services/preprocess           草图颜色归一化
src/services/shapeFeatures        裁剪、居中、密度网格特征（前后端共用）
src/services/iconSearch           索引加载与余弦相似度检索
src/data/icons                    生成的各库图标索引（index-<source>.json）
scripts/buildIconIndex.ts         离线索引构建脚本（多库适配器）
```
