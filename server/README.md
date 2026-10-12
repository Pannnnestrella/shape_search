# 本地 DINOv2 检索

本机环境位于项目 `.venv/`，官方固定版本模型位于 `models/dinov2-small/`，完整向量索引位于 `server/artifacts/`。上述目录不纳入 Git。不会修改已有 Conda 环境。

## 启动已构建的功能

在项目根目录打开两个 PowerShell 终端：

```powershell
# 终端一：绑定 127.0.0.1:8010，使用本地 CUDA 模型
npm run model:serve
```

```powershell
# 终端二：Vite 将 /model 转发到本地模型服务
npm run dev
```

打开 Vite 输出的本地地址，选择“模型 + 轮廓”。未启动模型服务、请求超时或模型索引过期时，前端自动回退轮廓精排并显示提示；也可主动切换“轮廓精排”或“基础匹配”。模型检索分数是融合相似度，不是正确概率。

## 新机器安装与重建

需要 Python 3.10 以上；本次使用 Python 3.13 和 CUDA 12.8 版 PyTorch 2.8。命令示例：

```powershell
python -m venv .venv
& ./.venv/Scripts/python.exe -m pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cu128
& ./.venv/Scripts/python.exe -m pip install -r server/requirements-lock.txt --extra-index-url https://download.pytorch.org/whl/cu128
npm install
npm run model:download
npm run build:geometry
npm run build:model-inputs
npm run model:build
```

模型来自 [facebook/dinov2-small](https://huggingface.co/facebook/dinov2-small)，固定 revision 为 `ed25f3a31f01632728cabb09d1542f84ab7b0056`。下载完成后构建与推理均从本地读取，不访问模型云 API。CUDA 安装参考 [PyTorch 官方说明](https://pytorch.org/get-started/locally/)。

`model:build` 默认离线批量 16。可手动指定较小批量：

```powershell
& ./.venv/Scripts/python.exe server/manage.py build --device cuda --batch-size 8
```

如需要 CPU，使用 `server/manage.py build --device cpu` 和 `server/app.py --device cpu`，启动脚本默认明确使用 CUDA。基础图标索引变化后，必须重建几何索引、模型输入和模型向量。

## 数据与接口

- `inputs.json`：图标 ID、来源、栅格文件及基础索引 SHA256。
- `vectors.npy`：L2 归一化的 float32 向量，维度 384。
- `index.json`：模型、预处理版本、权重指纹、向量校验值与构建资源记录。
- `GET /health`：模型就绪状态、设备、图标数量及 PyTorch 显存记录。
- `POST /search`：PNG data URL、来源过滤、召回数量、额外几何候选 ID，返回模型得分与资源信息。

查询先提取模型向量，对启用的图标库精确点积召回；加入前端提供的几何候选，再融合几何精排。默认召回 200 个模型候选并加入最多 200 个几何候选。融合权重是初始配置，尚未用真实手绘数据校准。

开发与 `npm run preview` 均支持 `/model` 代理。独立部署静态前端时，需要提供等价代理，或在构建前设置 `VITE_MODEL_URL=http://127.0.0.1:8010`；默认本地服务允许 localhost/127.0.0.1 的 HTTP 页面调用。

## 验证

```powershell
npm run build
npm run eval:test
npm run test:model
# 浏览器测试前另一个终端运行 npm run model:serve
npm run test:browser
```

浏览器测试使用已安装的 Microsoft Edge，不下载浏览器；测试先构建前端，再启动独占 5173 端口的生产预览服务，因此先关闭占用该端口的开发服务。模型测试使用本机 GPU 和完整向量索引，覆盖实际图标自检索、来源过滤和非法请求。测试检查功能正确性，不能替代真实手绘质量评测。
