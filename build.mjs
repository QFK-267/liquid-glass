import { build } from 'esbuild';

/* ------------------------------------------------------------------ *
 * 用法注释（banner）
 * ------------------------------------------------------------------ *
 * 打包产物顶部会带上这段「怎么用这个 class」的说明，方便直接打开
 * dist/liquid-glass.js 就能照抄。esbuild 的 banner 不会被 minify 掉。
 * ------------------------------------------------------------------ */
const USAGE = `/**
 * ============================================================================
 *  LiquidGlass —— 把任意 DOM 控件变成同形状的液态玻璃（WebGL）
 * ============================================================================
 *  渲染管线 / 着色器 / G2 几何：martin65536/liquid-glass-webgl（Apache-2.0）
 *    https://github.com/martin65536/liquid-glass-webgl
 *    更上游：Kyant0/AndroidLiquidGlass · Kyant0/kyant-shapes
 *  本文件是上述项目的打包产物（新增的只有一层 vanilla 宿主）。
 *  许可证：Apache-2.0，详见随包的 LICENSE / NOTICE.md
 * ----------------------------------------------------------------------------
 *  1) 引入 + 最小用法
 * ----------------------------------------------------------------------------
 *  <script src="./dist/liquid-glass.js"></script>
 *
 *  <div class="btn" data-liquid-glass='{"interactive":true}'>发送</div>
 *  <div class="card" data-liquid-glass>卡片</div>   // 空属性 = 全默认
 *
 *  <script>
 *    const glass = new LiquidGlass({
 *      wallpaper: './wallpaper.jpg',   // 折射源：图片 / 纯色 / canvas / video / draw 函数
 *      preset: 'clear',                // 观感预设，默认「通透」
 *      dpr: Math.min(devicePixelRatio, 2)
 *    });
 *    glass.scan();                     // 把所有 [data-liquid-glass] / [data-lg] 登记成玻璃
 *  </script>
 *
 *  · 形状不用写：圆角自动读元素自己的 CSS border-radius，胶囊 / 圆形（50%、999px）自动识别
 *  · 元素本身（文字、图标、事件、动画）完全保留，画布只在它背后画同形状的玻璃
 *  · 文字默认会被玻璃折射（immersive）；玻璃只画在元素背后，DOM 结构不动
 * ----------------------------------------------------------------------------
 *  2) 直接 new 一个 class（不写 data 属性也行）
 * ----------------------------------------------------------------------------
 *  const glass = new LiquidGlass({ wallpaper: myCanvas });
 *
 *  glass.add('#send', { interactive: true, preset: 'liquid' });  // 登记一个元素
 *  glass.add(document.querySelector('.chip'), { blur: 0 });       // 也可以直接传 DOM 节点
 *  glass.add('.chip', { blur: 0 });   // 选择器只取第一个；要批量就循环或留给 scan()
 *  glass.update('#send', { opacity: .6, tintColor: 'rgba(0,120,255,.35)' });
 *  glass.updateAll({ saturation: 1.2 });        // 所有元素（keepLook 的会跳过）
 *  glass.setParam('dpr', 1.5);                  // 全局/渲染器参数
 *  glass.setPreset('frosted');                   // 全部换预设
 *  glass.setPreset('chromatic', '#card');        // 只换某个元素
 *  glass.intro();                                // 重播入场动画
 *  glass.press('#send', true, { x: 300, y: 220 }); // 脚本触发按压（不点鼠标）
 *  glass.paramsOf('#send');                      // 读「实际生效」的参数（预设+全局+覆盖合并后）
 *  glass.remove('#send'); glass.get('#send'); glass.refresh(); glass.scan(root?);
 *  glass.setWallpaper({ type: 'color', color: '#12203a' }); // 换壁纸
 *  glass.start(); glass.stop(); glass.renderNow(); glass.resize(); glass.destroy();
 *  glass.renderer;                               // 原仓库渲染器实例，能力全开
 *  LiquidGlass.PRESETS / LiquidGlass.DEFAULTS / LiquidGlass.parseColor 也挂在 class 上
 * ----------------------------------------------------------------------------
 *  3) 预设（preset）
 * ----------------------------------------------------------------------------
 *  'clear'(通透，默认) · 'liquid'(液态) · 'frosted'(磨砂) · 'heavy'(厚重) · 'chromatic'(色散)
 *  优先级：DEFAULTS → preset → setParam/显式覆盖 → 元素自己的 params
 * ----------------------------------------------------------------------------
 *  4) 元素参数（对象形式 / data-liquid-glass 的 JSON 里写）
 * ----------------------------------------------------------------------------
 *  preset:'clear'            该元素单独的预设（覆盖全局）
 *  shape:'auto'              auto(读 CSS 圆角) | capsule | circle | rect
 *  radius:null               CSS px；radiusFraction:0~1（×min(w,h)/2）
 *  blur:0                    背景模糊 px（0 = 完全不糊，字最清楚）
 *  refractionHeightFraction:0.3   折射带宽度 = 比例 × min(w,h)/2
 *  refractionAmountFraction:0.42  折射位移量 = 比例 × min(w,h)（也支持绝对 px：refractionAmount / refractionHeight）
 *  chromaticAberration:false 7 通道色散 · depthEffect:true 纵深折射（凸透镜感）
 *  opacity:1                 整块玻璃的不透明度（纯 alpha，元素不会位移）
 *  tintColor / surfaceColor  染色 / 表面底色（任意 CSS 颜色，alpha 即强度）
 *  saturation / brightness / contrast            背景色彩处理
 *  highlight:{mode,color,angleDeg,falloff,alpha,widthDp}   边缘高光（传 false 关）
 *  outerShadow:{radius,alpha,offsetX,offsetY,color}        投影（传 false 关）
 *  innerShadow:{radius,alpha,offsetX,offsetY,color}        内阴影
 *  rotation:0                旋转（度）· scale:1 视觉缩放
 *  capsuleShape:false        用 G2 连续曲率 SDF 纹理做形状（更精确，每尺寸一张纹理）
 *  independentBackdrop:true  true = 只采样壁纸（通透/快）；false = 采样场景（玻璃叠玻璃）
 *  directSample:false        原仓库 button 的 LayerBackdrop 开关
 *  interactive:true          按压动画：弹簧放大 1+4/48 + 手指处白色辉光 + 松手回弹
 *  animateIn:true            入场动画（弹簧淡入 + 微缩放 + 轻微上浮）
 *  enterOffset:6 / enterStagger:45                 入场位移 / 每个元素的错峰延迟(ms)
 *  refractText:true          文字交给渲染器 → 会被玻璃折射（沉浸模式）；
 *                            false = DOM 文字始终清晰、压在玻璃之上
 *  keepLook:false            true = 这个元素保留自己的观感参数，updateAll/全局 setPreset 不动它
 *
 *  例：<div data-liquid-glass='{"preset":"liquid","interactive":true,"refractionAmountFraction":0.5}'></div>
 * ----------------------------------------------------------------------------
 *  5) 几个必须知道的点
 * ----------------------------------------------------------------------------
 *  · 画布是 position:fixed + z-index:-1（在页面背景之上、正文之下）；为了让负 z-index
 *    的玻璃可见，默认注入 html,body{background:transparent}。想保留页面自己的背景就传
 *    pageBackground:false，并自己安排层级。
 *  · 反射/折射的是「壁纸 + 渲染器画进去的文字」，不是任意 DOM 像素：DOM 里的图片不会
 *    出现在玻璃里；文字之所以能被折射，是因为宿主把它按行取出来当作场景内容重画了一遍。
 *  · 想看清字：把那块玻璃的 blur 调到 0（默认预设「通透」就是 0）。
 *  · 大背景板（铺满整屏的玻璃）请用很小的折射比例，并加 keepLook:true，否则被全局
 *    滑杆/预设一改，超宽的折射带会把里面的内容搅烂；比画布还高的面板建议 refractText:false。
 *  · 表单控件（button / input / select / option）里的文字不接管，保持浏览器原生渲染。
 *  · 只影响渲染器全局的参数（dpr / cornerStyle / blurTapCap / blurDownsample /
 *    dynamicBlurDownsample / useKawaseBlur / useBlurCache / usePerElementFbo /
 *    directBackdropSample / noContinuousSdf / capsuleSdfQuality）用 glass.setParam 设。
 * ============================================================================
 */`;

const FOOTER = {
  js:
    'window.LiquidGlass = LiquidGlassModule.LiquidGlass;' +
    'window.LiquidGlass.PRESETS = LiquidGlassModule.PRESETS;' +
    'window.LiquidGlass.DEFAULTS = LiquidGlassModule.DEFAULTS;' +
    'window.LiquidGlass.parseColor = LiquidGlassModule.parseColor;' +
    'window.LiquidGlassRenderer = LiquidGlassModule.LiquidGlassRenderer;',
};

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  target: ['es2018'],
  logLevel: 'info',
};

await build({
  ...shared,
  outfile: 'dist/liquid-glass.esm.js',
  banner: { js: USAGE },
});

// 压缩版：不塞长注释，指到未压缩那份
const MIN_BANNER = `/*! LiquidGlass (Apache-2.0) — 移植自 martin65536/liquid-glass-webgl
 * 用法 / API / 全部参数见 dist/liquid-glass.js 顶部注释，或 README.md。 */`;

await build({
  ...shared,
  outfile: 'dist/liquid-glass.min.js',
  format: 'iife',
  minify: true,
  globalName: 'LiquidGlassModule',
  banner: { js: MIN_BANNER },
  footer: FOOTER,
});

await build({
  ...shared,
  format: 'iife',
  globalName: 'LiquidGlassModule',
  outfile: 'dist/liquid-glass.js',
  banner: { js: USAGE },
  footer: FOOTER,
});

console.log('done: dist/liquid-glass.js · liquid-glass.min.js · liquid-glass.esm.js');
