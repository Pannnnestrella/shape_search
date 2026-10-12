# 阶段一：真实草图采集与基线评测

当前没有真实草图数据。`dataset.json` 保持为空，合成测试样本不计入阶段一验收。

执行范围已按用户要求调整：真实草图质量评测为可选后续工作，不阻塞功能开发。阶段一工具链已通过验证，阶段二和三功能已交付。下列“验收门槛”适用于将来执行真实数据质量评测，不是当前开发阶段的前置要求。

## 采集与标注

1. 执行 `npm install`、`npm run eval:catalog`、`npm run dev`。
2. 在画布中手绘目标图标，点击“导出草图”，将 PNG 放到 `evaluation/images/`。
3. 从 `evaluation/catalog.json` 查询准确图标 ID。先确定绘制意图再绘制，不要仅按搜索返回的第一项标注；目录可用于查找未被召回的目标。
4. 在 `dataset.json` 添加样本。收集 100～300 张真实草图，至少两位绘制者，覆盖线宽、比例偏差、缺失笔画和相似外框等难例。
5. 先把同一语义目标及跨库同形图标合并为一个 `group`，再将整个组固定分配到 dev 或 test。建议约 70%/30%，禁止同一组跨集合。

示例（图标 ID 必须以生成的目录为准）：

```json
{
  "version": 1,
  "seed": 20261012,
  "samples": [
    {
      "id": "person-a-magnifier-001",
      "image": "images/person-a-magnifier-001.png",
      "kind": "real",
      "split": "dev",
      "author": "person-a",
      "group": "magnifier",
      "strict": ["lucide:search"],
      "acceptable": ["lucide:search"],
      "tags": ["rough-proportion", "magnifier-vs-circle"]
    }
  ]
}
```

- `strict`：精确目标；`acceptable`：精确目标和人工确认可接受的同义/跨库变体。
- `author`：绘制者匿名标识；`group`：所有等价目标共享的分组标识。
- `tags`：至少一个难例或形态标签，同一标签可用于报告聚合。
- 图片必须位于数据集目录内部，不能重复；空画布、未知图标 ID、重复样本 ID、跨集合分组均会报错。
- 分组一致性仍需人工检查，脚本无法自动判断两个不同组是否实际同义。seed 为固定划分标记；当前流程不随机划分或增强。

## 运行

```powershell
npm run eval:test
npm run eval:baseline
npm run eval:baseline -- --dataset evaluation/dataset.json --out evaluation/reports/baseline.json --require-ready
```

报告包含严格/可接受匹配的 Recall@1/10/50/200、MRR、dev/test 及标签分类、逐样本排名和 Top10；记录数据/索引/算法/依赖 SHA256、运行环境、索引加载耗时和内存。

时延为 Node CPU 端预处理与完整评分排序的 P50/P95，包含首次查询，不含图片解码、磁盘读写和浏览器交互。不能将其视为浏览器端到端延迟。浏览器端到端指标需要另行真实交互测量并记入验收报告。内存是查询边界观察到的 RSS 最大值，非连续采样峰值；当前基线不使用 GPU。

## 阶段一验收门槛

- 100～300 张真实草图，至少两位绘制者，dev/test 均有真实样本。
- 人工复核等价目标分组与严格/可接受标签，覆盖计划指定难例。
- 相同数据和索引运行两次，排名及质量指标一致；耗时允许正常波动。
- 人工复核最差样本，记录主要失败模式；补充浏览器端延迟记录。
- 在 `.plan/phase-1-status.md` 补充最终真实数据报告路径和质量评测结论。

`--require-ready` 未满足门槛时返回退出码 2。报告中的 `failureReview` 和 `phaseOneComplete` 保持 false，因为人工审查与浏览器测量必须在验收文档确认，脚本不会自动声称阶段一完成。
