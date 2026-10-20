# NOTICE — 来源与授权

本目录包含**原样复制**的开源项目代码，以及在其之上新增的宿主封装。

## 上游项目

- **liquid-glass-webgl** — https://github.com/martin65536/liquid-glass-webgl
  - 作者：martin65536（及其 README 中致谢的 Z.ai Agent）
  - 许可证：**Apache License 2.0**（见 `LICENSE`）
  - 本项目使用的 zip：`liquid-glass-webgl-main.zip`
- **AndroidLiquidGlass**（上游的上游，Kotlin / Compose）— https://github.com/Kyant0/AndroidLiquidGlass
  - 作者：Kyant
  - liquid-glass-webgl 的 README 说明它是该 Android 项目的 Web 移植版
- **kyant-shapes** — https://github.com/Kyant0/kyant-shapes
  - `shapes/continuous-corners.ts` 是 `ContinuousCurvatureRoundedRectangleCornerBuilder.kt` 的移植

> 感谢以上作者开源。液态玻璃的几何算法（G2 连续曲率角）、折射透镜着色器、
> 色散、边缘高光、可分离高斯模糊、双 FBO 合成等全部来自他们。

## 本目录中「原样复制」的部分

从 `liquid-glass-webgl/src/components/liquid-glass/` 复制，**未改动内容**（可用 `diff -rq` 校验）：

```
src/renderer/    （52 个 .ts，渲染器、GL 工具、SDF/掩码栅格化、弹簧动画、性能监控…）
src/shaders/     （12 个 .ts，全部 GLSL：element / shadow / highlight / blur / scene-bg / scene-fg / sdf …）
src/shapes/      （1 个 .ts，G2 连续曲率圆角）
src/LICENSE      （Apache-2.0 原文，来自上游仓库根目录）
```

这些文件里的注释、版权说明、Kotlin 对应关系全部保留，未做任何删改。

## 本目录中「新增」的部分（非上游代码）

```
src/host.ts        vanilla 宿主：替代原仓库的 React 层（context.tsx + catalog/*）
src/index.ts       入口，导出 LiquidGlass / LiquidGlassRenderer
build.mjs          esbuild 打包脚本
dist/              打包产物（IIFE / IIFE min / ESM）
index.html         演示 + 参数游乐场
examples/          最小示例
```

`src/host.ts` 做的事：

1. 创建铺满视口的 canvas（原仓库由 React 组件挂载）；
2. 每帧读取 DOM 元素的 `getBoundingClientRect()` + `border-radius`，
   编译成原渲染器要求的 `GlassElementConfig`（默认 `kind: 'glass-shape'`，
   `interactive: true` 时用 `kind: 'button'`，即原仓库按钮那一套），
   再调用原渲染器的 `setElements()`；
3. 尺寸变化时调用原渲染器的 `resize(cssW, cssH)`；
4. 壁纸：静态图片走原渲染器的 `loadWallpaper(url)`；canvas/video/动态壁纸
   由宿主上传纹理（复刻 `loadWallpaper()` 的纹理参数与缓存失效步骤）；
5. 提供一个「DOM 元素 ↔ 玻璃参数」的公开 API（add/update/scan/setParam/setPreset/intro…），
   让任意元素都能变成同形状的玻璃。

其中「动画」这一块也只是把**上游已有的能力**接出来，没有新写任何渲染逻辑：

- **入场动画**：宿主每帧推进一个弹簧并写进 `GlassElementConfig.enterProgress`
  （该字段及其 alpha/位移/缩放语义是上游渲染器 `computeElementTransform` 里就有的），
  再乘进上游同样支持的 `elementScaleX/Y`；
- **按压动画**：完全用上游的 `renderer.setPressed()` / `setDragPosition()`，
  弹簧（`springStep1D` / 欠阻尼）、辉光、跟手位移、回弹都在 `src/renderer` 里；
- **预设 / 参数比例**：`refraction*Fraction`、`enterProgress`、`independentBackdrop`
  这些字段全都来自上游 `GlassElementConfig`，宿主只负责「按元素尺寸算成 px」。

## 对上游代码的依赖方式

宿主**只调用**渲染器的公开入口（`resize` / `setElements` / `render` /
`requestRender` / `loadWallpaper` / `setBackgroundColor` / `markAllDirty` /
`dispose` 等），没有修改 `src/renderer`、`src/shaders`、`src/shapes` 里的任何一行。
打包时由 esbuild 把 TS 一起编译成 `dist/liquid-glass.js`。

## 已知限制（源于上游渲染器）

- `GlassElementConfig.cornerRadius` 是**统一圆角**。元素的四角半径不同时
  （例如 `border-radius: 18px 4px 18px 4px`），宿主取四者最大值，
  因此玻璃轮廓会比元素略"圆"一点。单一半径（`12px` / `50%` / `999px`）完全一致。
- 玻璃折射的是「场景」= 壁纸 + 渲染器自己画的文字/非玻璃元素。DOM 里的图片不会出现在
  玻璃里。宿主默认开启 `refractText`：它把元素的文字按行抽出来，用渲染器
  `kind: 'text'` 元素画进场景（DOM 那份设成透明），于是**文字也会被玻璃折射**；
  关掉 `refractText` 则回到「DOM 文字压在玻璃之上、永远清晰」。
- 折射强度默认按元素尺寸的比例给（`refractionAmountFraction: 0.42 × min(w,h)`）。
  绝对值和比例两个都写时绝对值优先。
- 按压动画（`interactive`，默认开）会让渲染器走 `kind: 'button'` 分支：玻璃按下时放大
  `1 + 4/48`、并跟随手指做 tanh 位移、手指处出现白色辉光。DOM 元素本身不动。
- 采样方式按「有没有盖住场景文字」决定：盖住了就必须采样场景，否则玻璃会把底下的字整个
  盖掉；没盖住的（开关、小圆点…）继续走上游的「只采样壁纸」路径 —— 更通透、能被 elFbo
  缓存，而且不会被上一层玻璃的模糊糊掉（否则小控件会显得"不折射"）；
- 上游对 `enterProgress` 的位移处理**玻璃和文字不一样**：`kind:'button'` + `isInteractive`
  的元素，紧随其后的 press 分支是 `translationY = …`（赋值）会把入场位移整个覆盖掉，
  而文字元素（非玻璃）的 `r2.y = r.y + ty` 一定生效。所以宿主给玻璃和文字分别算补偿
  （`dy` / `textDy`），否则调不透明度时玻璃会随进度往下滑（最坑的是文字不动、玻璃动）；
- 文字折射是靠 `kind: 'text'` + 玻璃采样场景实现的（都是上游既有能力）；
  上游的「模糊后景缓存」只认玻璃元素自己的 dirty rect，而宿主塞进场景的文字不会产生
  dirty rect，所以宿主在文字签名变化时主动调一次
  `clearBackdropBlurCache()` + `markAllDirty()`（只在这块玻璃真的开了模糊时），
  否则玻璃会一直复用「还没有文字」的模糊底图，看上去像文字被擦掉了；
  逐行的行盒来自浏览器 `Range.getClientRects()`，文字内容 / 字号 / 字重 / 颜色
  取自 `getComputedStyle`，但字体栈由上游的 Canvas2D 栅格化代码写死。
- `opacity` 通过渲染器的 `enterProgress` 实现（原语义是入场动画的 alpha），
  宿主在 rect 上补偿了它的 `-48*(1-progress)` 位移，所以只表现为透明度变化。
