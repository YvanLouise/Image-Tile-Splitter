# 图块分离工具

纯前端的图片图块 / 漫画格分割应用。项目使用 Vite + React + TypeScript，所有像素读取、mask 编辑、分割和导出都在浏览器本地完成，不需要后端。

## 功能

- 上传 PNG / WebP / JPG。
- 透明图块模式：按 alpha 通道执行 connected components 分割。
- 漫画格模式：基础灰度阈值检测，并支持手动画框和多边形格子。
- 漫画格模式增强：优先懒加载 OpenCV.js 识别整页漫画的留白和边框；OpenCV 不可用时自动回退基础规则。
- 支持 4 邻域 / 8 邻域、Alpha 阈值、最小像素数。
- 中央 Canvas 显示棋盘格透明背景、原图、bounding box、选中高亮。
- 支持缩放、拖拽、点击选择、多选、排序。
- 手动修正：
  - 分割线：把线经过的 mask 像素置为透明，用于断开粘连图块。
  - 橡皮擦：擦除 mask。
  - 恢复画笔：清除用户编辑，恢复原始 mask。
  - 矩形框：手动画漫画格。
  - 多边形：双击完成不规则 panel。
  - 合并所选图块。
  - 拆分所选图块：按当前 mask 重新分割。
  - 撤销 / 重做。
- 导出：
  - 单个 PNG。
  - 批量 ZIP。
  - metadata.json。

## OpenCV.js

项目使用 npm 版 OpenCV.js，并在 `postinstall` 阶段把运行时文件复制到 `public/opencv.js`。漫画格模式会在点击“自动检测（OpenCV）”时再加载该文件；如果文件不存在或加载失败，应用会自动使用 fallback 检测，不影响透明图块分割。

如果刚拉取项目后没有 `public/opencv.js`，运行：

```bash
npm install
```

## 安装与运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

如果当前环境不允许 Vite dev server 启动，可以先构建再用零依赖静态预览：

```bash
npm run build
npm run serve:dist -- --port 4173
```

Windows 下也可以直接双击 `open-web.cmd`，它会自动构建、启动本地服务并打开浏览器。

一键推送到 GitHub：

```bash
push-github.cmd
```

也可以带提交信息：

```bash
push-github.cmd "Update UI and deployment"
```

## GitHub Pages 上线

本项目已包含 GitHub Pages Actions 工作流。推送到 `main` 后，GitHub 会自动构建并发布 `dist`。

第一次使用需要在仓库设置中启用 Pages：

1. 打开 GitHub 仓库 `Settings > Pages`。
2. `Build and deployment` 选择 `GitHub Actions`。
3. 推送代码到 `main`，等待 Actions 完成。

上线地址通常是：

```text
https://yvanlouise.github.io/Image-Tile-Splitter/
```

## 核心原理

核心算法在 `src/lib/imageSegmentation.ts`。

漫画格检测在 `src/lib/comicDetection.ts`，OpenCV 加载隔离在 `src/lib/opencvLoader.ts`，上传/检测/重新分割的编排在 `src/lib/segmentationPipeline.ts`。

透明图块模式使用以下流程：

1. 通过 Canvas 获取 `ImageData`。
2. 生成 `originalAlphaMask`：`alpha > alphaThreshold` 的像素为 1。
3. 用户编辑写入 `userMaskEdits`：
   - `0`：无编辑，使用原始 mask。
   - `-1`：擦除，最终 mask 为 0。
   - `1`：强制恢复为有效像素。
4. 计算 `finalMask = originalAlphaMask + userMaskEdits`。
5. 对 `finalMask` 执行 BFS connected components。
6. 每个 component 得到 bounding box、局部 mask、像素数和 PNG 预览。

导出时只复制该 component 的 mask 内像素。bounding box 内其他像素 alpha 写为 0，所以不会混入其他图块；源图的半透明边缘会原样保留。

漫画格模式当前是基础版：先用灰度和颜色差检测非白色内容，再做连通区域提取。它适合作为初始候选，复杂漫画页建议用矩形框、多边形、合并和排序完成修正。

## 组件结构

```text
src/
  App.tsx                         全局状态、历史、模式切换、导出串联
  main.tsx                        React 入口
  styles.css                      三栏工具 UI 样式
  types.ts                        公共类型
  components/
    Toolbar.tsx                   顶部模式、工具、撤销重做
    LeftPanel.tsx                 上传、参数、列表、排序、合并
    CanvasWorkspace.tsx           Canvas 渲染、选择、绘制工具
    RightPanel.tsx                预览和导出
  lib/
    imageSegmentation.ts          mask、连通域、手动 panel、合并
    exportAssets.ts               PNG / ZIP / metadata 导出
    comicDetection.ts             OpenCV + fallback 漫画格检测
    opencvLoader.ts               OpenCV.js 懒加载
    segmentationPipeline.ts        上传、检测、重分割编排
  state/
    segmentationReducer.ts         分割状态、选择、撤销重做
  utils/
    canvas.ts                     图片加载、下载、棋盘格、命中测试
```

## 验收路径

1. 上传透明 PNG 或 WebP。
2. 点击“重新分割”，确认不相连图块会分别显示 bounding box。
3. 点击任意图块，中央高亮，右侧显示透明 PNG 预览。
4. 对 1px 粘连区域使用“分割线”画过连接处，松开后自动重新分割。
5. 使用撤销恢复上一状态。
6. 导出当前 PNG，检查只包含该图块。
7. 勾选 metadata 后执行批量 ZIP 导出。
