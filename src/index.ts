/*
 * LiquidGlass 入口
 * ---------------------------------------------------------------------------
 * 导出：
 *   LiquidGlass          —— vanilla 宿主类（把 DOM 元素变成同形状液态玻璃）
 *   LiquidGlassRenderer  —— 原仓库渲染器（martin65536/liquid-glass-webgl, Apache-2.0）
 *   PRESETS / DEFAULTS / parseColor
 *
 * 原始项目：https://github.com/martin65536/liquid-glass-webgl
 * 上游原型：https://github.com/Kyant0/AndroidLiquidGlass
 * 许可证：Apache-2.0（见 LICENSE / NOTICE.md）
 *
 * ---------------------------------------------------------------------------
 * 用法速查（打包后这段会以 banner 形式出现在 dist/liquid-glass.js 顶部）
 * ---------------------------------------------------------------------------
 *   <script src="./dist/liquid-glass.js"></script>
 *   <div class="btn" data-liquid-glass='{"interactive":true}'>发送</div>
 *   <script>
 *     const glass = new LiquidGlass({ wallpaper: './wallpaper.jpg' });
 *     glass.scan();                       // [data-liquid-glass] / [data-lg] 全部变玻璃
 *   </script>
 *
 *   new LiquidGlass(options)              构造：wallpaper / preset / dpr / zIndex /
 *                                         pageBackground / autoScan / autoStart / canvas ...
 *   元素方法：add(target, params) · update(target, params) · updateAll(params) ·
 *            remove(target) · get(target) · paramsOf(target) · scan(root?) · refresh()
 *   预设：    setPreset(name, target?)     'clear' | 'liquid' | 'frosted' | 'heavy' | 'chromatic'
 *   动画：    intro() · press(target, pressed, position?)
 *   全局：    setParam(name, value)        渲染器全局参数（dpr / blurDownsample / ...）
 *   壁纸：    setWallpaper(wp) · setBackgroundColor(cssColor)
 *   生命周期：start() · stop() · renderNow() · resize() · destroy()
 *   逃生口：  glass.renderer               原仓库 LiquidGlassRenderer 实例
 *
 *   元素参数（data-liquid-glass 的 JSON 里同样可写）：
 *     preset · shape · radius · radiusFraction · blur ·
 *     refractionHeight[Fraction] · refractionAmount[Fraction] ·
 *     chromaticAberration · depthEffect · opacity · tintColor · surfaceColor ·
 *     saturation · brightness · contrast · highlight · outerShadow · innerShadow ·
 *     rotation · scale · capsuleShape · independentBackdrop · directSample ·
 *     interactive · animateIn · enterOffset · enterStagger · refractText · keepLook
 *   完整说明与各参数默认值见 README.md（或 dist/liquid-glass.js 顶部注释）。
 * ---------------------------------------------------------------------------
 */

export { LiquidGlass } from './host'
export { LiquidGlassRenderer } from './renderer'
export { parseColor, DEFAULTS, PRESETS } from './host'
