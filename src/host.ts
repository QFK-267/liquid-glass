/*
 * LiquidGlass 宿主（vanilla host）
 * ---------------------------------------------------------------------------
 * 这个文件是「新增的胶水层」，不是原仓库代码：
 * 原仓库用 React（context.tsx + catalog/*.ts）把 DOM 布局编译成
 * GlassElementConfig[]，再喂给 LiquidGlassRenderer。
 *
 * 这里用等价的 vanilla 实现替代 React 那一层：
 *   - 自己创建 canvas、跑 rAF；
 *   - 把页面上的 DOM 元素（data-liquid-glass / add()）每帧同步成
 *     GlassElementConfig（形状自动取 CSS border-radius / 胶囊 / 圆形）；
 *   - 元素本身仍由浏览器渲染（文字、图标、交互全部保留），画布只负责
 *     在它背后画同形状的液态玻璃。
 *
 * 渲染管线、着色器、G2 几何、双 FBO 合成全部来自原仓库（src/renderer、
 * src/shaders、src/shapes，见 NOTICE.md）。
 */

// @ts-nocheck —— 宿主刻意使用宽松类型：原仓库的 GlassElementConfig 字段极多，
// 这里只填其中一部分（其余留默认），不做完整类型体操。

import { LiquidGlassRenderer } from './renderer'

/* ------------------------------------------------------------------ *
 * 颜色 / 数值工具
 * ------------------------------------------------------------------ */

let _colorCtx = null
/** 解析 CSS 颜色 → [r,g,b,a]（0..1）。支持 '#rgb' '#rrggbb' '#rrggbbaa' 'rgb()' 'rgba()' 及颜色名。 */
export function parseColor(c) {
  if (c == null || c === '' || c === 'transparent' || c === 'none') return [0, 0, 0, 0]
  if (Array.isArray(c)) return [c[0] || 0, c[1] || 0, c[2] || 0, c.length > 3 ? c[3] : 1]
  if (typeof c === 'object' && c.r != null) return [c.r, c.g, c.b, c.a == null ? 1 : c.a]
  if (!_colorCtx) {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 1
    _colorCtx = cv.getContext('2d')
  }
  _colorCtx.fillStyle = '#000'
  _colorCtx.fillStyle = String(c)
  const v = _colorCtx.fillStyle
  if (v.charAt(0) === '#') {
    if (v.length === 7) {
      return [parseInt(v.substr(1, 2), 16) / 255, parseInt(v.substr(3, 2), 16) / 255, parseInt(v.substr(5, 2), 16) / 255, 1]
    }
    if (v.length === 4) {
      return [
        parseInt(v.charAt(1) + v.charAt(1), 16) / 255,
        parseInt(v.charAt(2) + v.charAt(2), 16) / 255,
        parseInt(v.charAt(3) + v.charAt(3), 16) / 255,
        1,
      ]
    }
  }
  const m = v.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const p = m[1].split(',')
    return [parseFloat(p[0]) / 255, parseFloat(p[1]) / 255, parseFloat(p[2]) / 255, p.length > 3 ? parseFloat(p[3]) : 1]
  }
  return [0, 0, 0, 0]
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d)

/* ------------------------------------------------------------------ *
 * 与原仓库 catalog 一致的默认值（catalog/constants.ts）
 * ------------------------------------------------------------------ */

const DEFAULT_HIGHLIGHT = {
  mode: 0,
  color: [1, 1, 1],
  angle: (45 * Math.PI) / 180,
  falloff: 1.0,
  alpha: 0.5,
  widthDp: 0.5,
}

const DEFAULT_SHADOW = {
  radius: 24,
  alpha: 0.1,
  offsetX: 0,
  offsetY: 4,
  color: [0, 0, 0],
}

/* ------------------------------------------------------------------ *
 * 预设（preset）
 * ------------------------------------------------------------------ *
 * 一组「整体观感」参数。取值参考原仓库的两处默认：
 *   - catalog/constants.ts 的 GLASS_PARAMS（LiquidButton.kt）；
 *   - catalog/types.ts 的 GlassPlayground 初始 state
 *     （blurRadiusDp=0, refractionHeightFrac=0.2, refractionAmountFrac=0.2,
 *      cornerRadiusFrac=0.5, depthEffect=true）。
 * 注意原仓库的折射是「按元素尺寸的比例」，所以这里也以 Fraction 为准 ——
 * 大卡片和小胶囊才会有一样强的折射，而不是小元素过强、大元素几乎看不见。
 * ------------------------------------------------------------------ */
export const PRESETS = {
  /** 通透（默认）：薄、清、折射强，几乎不糊。 */
  clear: {
    label: '通透',
    params: {
      // 原仓库 GlassPlayground 的初始 blurRadiusDp 就是 0 —— 不糊才叫「通透」，
      // 玻璃感全部交给边缘的折射带 + 高光描边 + 投影。
      blur: 0,
      refractionHeight: null,
      refractionHeightFraction: 0.3,
      refractionAmount: null,
      refractionAmountFraction: 0.42,
      saturation: 1.15,
      brightness: 0,
      contrast: 1.03,
      depthEffect: true,
      chromaticAberration: false,
      tintColor: null,
      surfaceColor: null,
      // 高光是一圈「描边」（不是整面白漆）：widthDp 调粗一点，玻璃边才立得住。
      highlight: { mode: 0, alpha: 0.6, angleDeg: 45, widthDp: 1.0 },
      outerShadow: { radius: 26, alpha: 0.22, offsetX: 0, offsetY: 5 },
      innerShadow: null,
    },
  },
  /** 液态：折射最猛 + 色散 + 纵深，适合方块/球体这种展示件。 */
  liquid: {
    label: '液态',
    params: {
      blur: 0,
      refractionHeightFraction: 0.38,
      refractionAmountFraction: 0.6,
      saturation: 1.3,
      brightness: 0,
      contrast: 1.05,
      depthEffect: true,
      chromaticAberration: true,
      tintColor: null,
      surfaceColor: null,
      highlight: { mode: 2, alpha: 0.5, angleDeg: 45, widthDp: 1.0 },
      outerShadow: { radius: 30, alpha: 0.24, offsetY: 7 },
    },
  },
  /** 磨砂：厚模糊、弱折射，雾面感。 */
  frosted: {
    label: '磨砂',
    params: {
      blur: 16,
      refractionHeightFraction: 0.18,
      refractionAmountFraction: 0.14,
      saturation: 1.2,
      brightness: 0.04,
      contrast: 1,
      depthEffect: false,
      chromaticAberration: false,
      tintColor: null,
      surfaceColor: 'rgba(255,255,255,0.04)',
      highlight: { mode: 0, alpha: 0.5, angleDeg: 45 },
      outerShadow: { radius: 24, alpha: 0.12, offsetY: 4 },
    },
  },
  /** 厚重：磨砂 + 表面底色 + 内阴影，像一块厚玻璃板。 */
  heavy: {
    label: '厚重',
    params: {
      blur: 26,
      refractionHeightFraction: 0.2,
      refractionAmountFraction: 0.2,
      saturation: 1.25,
      brightness: 0.05,
      contrast: 1.02,
      depthEffect: true,
      chromaticAberration: false,
      tintColor: null,
      surfaceColor: 'rgba(255,255,255,0.10)',
      highlight: { mode: 0, alpha: 0.55, angleDeg: 45 },
      outerShadow: { radius: 32, alpha: 0.18, offsetY: 8 },
      innerShadow: { radius: 18, alpha: 0.12, offsetX: 0, offsetY: 2, color: '#ffffff' },
    },
  },
  /** 色散：通透 + 边缘彩虹。 */
  chromatic: {
    label: '色散',
    params: {
      blur: 0,
      refractionHeightFraction: 0.32,
      refractionAmountFraction: 0.45,
      saturation: 1.2,
      brightness: 0,
      contrast: 1.04,
      depthEffect: false,
      chromaticAberration: true,
      highlight: { mode: 0, alpha: 0.5, angleDeg: 45 },
      outerShadow: { radius: 24, alpha: 0.18, offsetY: 4 },
    },
  },
}

/** 预设里包含的「观感参数」名（切换预设时会清掉同名的显式覆盖）。 */
const LOOK_KEYS = [
  'blur',
  'refractionHeight',
  'refractionHeightFraction',
  'refractionAmount',
  'refractionAmountFraction',
  'chromaticAberration',
  'depthEffect',
  'saturation',
  'brightness',
  'contrast',
  'tintColor',
  'surfaceColor',
  'highlight',
  'outerShadow',
  'innerShadow',
]

/** 与原仓库 GLASS_PARAMS（LiquidButton.kt）+ GlassPlayground 一致的默认玻璃参数。 */
export const DEFAULTS = {
  /* --- 每个元素的默认参数 --- */
  preset: 'clear', // 观感预设，见 PRESETS；单个元素也可用 data 里写 preset 覆盖
  shape: 'auto', // auto | capsule | circle | rect
  radius: null, // 显式半径（CSS px），优先于 shape
  radiusFraction: null, // 0..1，乘以 min(w,h)/2
  opacity: 1, // 0..1 —— 映射到渲染器的 enterProgress（整块玻璃的淡入淡出）
  blur: 0, // 背景模糊半径（CSS px）；0 = 完全不糊（通透）
  refractionHeight: null, // 显式折射带宽度（CSS px）；null = 用下面的比例
  refractionHeightFraction: 0.3, // 0..1，乘以 min(w,h)/2
  refractionAmount: null, // 显式折射位移量（CSS px）；null = 用下面的比例
  refractionAmountFraction: 0.42, // 0..1，乘以 min(w,h)
  chromaticAberration: false, // 色散
  depthEffect: true, // 纵深折射
  saturation: 1.15,
  brightness: 0,
  contrast: 1.03,
  tintColor: null, // 染色（任意 CSS 颜色）
  surfaceColor: null, // 表面底色
  highlight: { ...DEFAULT_HIGHLIGHT }, // 边缘高光；传 false 关闭
  outerShadow: { ...DEFAULT_SHADOW }, // 外投影；传 false/null 关闭
  innerShadow: null, // 内阴影 { radius, alpha, offsetX, offsetY, color }
  rotation: 0, // 旋转（度）
  scale: 1, // 缩放（视觉缩放，不改变玻璃纹理分辨率）
  enterProgress: null, // 直接控制渲染器的 enterProgress（覆盖 opacity）
  independentBackdrop: true, // true = 只采样壁纸（通透、快）；false = 采样场景（玻璃叠玻璃）
  capsuleShape: false, // true = 使用 G2 连续曲率 SDF 纹理（更精确，但每个尺寸一张纹理）
  /** 原仓库 makeButton 的 LayerBackdrop 开关（只对 independentBackdrop=false 的元素生效）。
   *  注意渲染器全局也有个同名开关，所以这里改名成 directSample 避免撞车。 */
  directSample: false,

  /* --- 动画 --- */
  animateIn: true, // 入场：0→1 弹簧（淡入 + 轻微缩放 + 轻微上浮）
  enterStagger: 45, // 扫描时每个元素的入场延迟（ms）
  enterOffset: 6, // 入场时玻璃从下方多少 px 滑到位（DOM 文字不动）
  interactive: true, // 按压动画：按原仓库 button 处理（弹簧缩放 + 手指高光 + 回弹）
  /**
   * 文字折射（沉浸模式）：
   * 把元素里的文字当作「场景内容」交给渲染器绘制，玻璃采样场景时会连文字一起
   * 折射 / 模糊 / 放大 —— 文字就像真的浸在玻璃里，而不是浮在玻璃上的贴纸。
   * 代价：文字由渲染器的 Canvas2D 栅格化（字体栈固定）、玻璃必须采样场景
   * （不能只采样壁纸），所以比纯壁纸折射慢一点。设 false 就回到「DOM 文字永远
   * 清晰、压在玻璃之上」的老行为。
   */
  refractText: true,
  /**
   * true = 这个元素「保留自己的观感参数」：updateAll() / 全局 setPreset() 不会动它。
   * 典型用途：一块铺满整个区域的大玻璃（背景板 / 容器）。大元素的折射带 =
   * fraction × min(w,h)/2 会非常宽，被全局滑杆改一下就会把里面的内容搅烂。
   */
  keepLook: false,

  /* --- 全局（渲染器）参数 --- */
  dpr: 2,
  cornerStyle: 1,
  blurTapCap: 16,
  blurDownsample: 2,
  dynamicBlurDownsample: true,
  useKawaseBlur: true,
  useBlurCache: true,
  usePerElementFbo: true,
  directBackdropSample: false,
  noContinuousSdf: false,
  capsuleSdfQuality: 1,
  zIndex: -1,
  /** 'transparent' = 把 html/body 背景让给壁纸（默认，保证画布可见）；false = 不动页面背景 */
  pageBackground: 'transparent',
  autoScan: true,
  autoStart: true,
  /** 动态壁纸开关（canvas/draw 类型需要显式 animate:true 才会每帧重传） */
  animateWallpaper: false,
  wallpaper: null,
  backgroundColor: null,
  className: 'lg-glass',
  injectStyle: true,
}

/* ------------------------------------------------------------------ *
 * 主体
 * ------------------------------------------------------------------ */

export class LiquidGlass {
  constructor(options = {}) {
    if (typeof document === 'undefined') throw new Error('[LiquidGlass] 需要在浏览器环境运行')
    this.options = Object.assign({}, DEFAULTS, options || {})
    this.records = []
    this._raf = 0
    this._running = false
    this._destroyed = false
    this._time = 0
    this._lastT = 0
    this._lastCssW = 0
    this._lastCssH = 0
    /** setParam() 改过的「观感参数」，优先级高于预设 */
    this._overrides = {}
    /** 当前按下的元素（按压动画） */
    this._pressed = null

    this._makeCanvas()
    this.renderer = new LiquidGlassRenderer(this.canvas)
    this._applyGlobalOptions()

    window.addEventListener('resize', this._onResize, { passive: true })
    window.addEventListener('orientationchange', this._onResize, { passive: true })
    // 按压动画：document 捕获阶段统一监听，不需要给每个元素挂事件
    document.addEventListener('pointerdown', this._onPointerDown, true)

    this.resize()

    if (this.options.wallpaper) this.setWallpaper(this.options.wallpaper)
    if (this.options.backgroundColor) {
      const c = parseColor(this.options.backgroundColor)
      this.renderer.setBackgroundColor([c[0], c[1], c[2]])
    }

    if (this.options.autoScan) this.scan()
    if (this.options.autoStart) this.start()
  }

  /* ------------------------------------------------------------ 画布 */

  _makeCanvas() {
    let canvas = this.options.canvas
    if (typeof canvas === 'string') canvas = document.querySelector(canvas)
    if (!canvas) {
      canvas = document.createElement('canvas')
      const s = canvas.style
      s.position = 'fixed'
      s.left = '0'
      s.top = '0'
      s.width = '100%'
      s.height = '100%'
      s.pointerEvents = 'none'
      s.display = 'block'
      s.zIndex = String(this.options.zIndex)
      const parent = document.body || document.documentElement
      parent.insertBefore(canvas, parent.firstChild)
    }
    canvas.classList.add('lg-canvas')
    this.canvas = canvas
    this._ownsCanvas = !this.options.canvas
    if (this.options.injectStyle) this._injectStyle()
  }

  _injectStyle() {
    if (document.getElementById('lg-base-style')) return
    const st = document.createElement('style')
    st.id = 'lg-base-style'
    let css =
      '.lg-canvas{position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;display:block;}' +
      '.lg-glass{background:transparent!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;' +
      'box-shadow:none!important;}' +
      // 文字折射模式：DOM 文字变透明，可见的「那一份」由渲染器画进场景里
      '.lg-scene-text{color:transparent!important;-webkit-text-fill-color:transparent!important;}'
    // 画布在 z-index:-1：位于「页面背景之上、正文内容之下」。
    // 但 html/body 自身的背景会盖住负 z-index 元素，所以这里把页面底色让给壁纸。
    // 想保留页面自己的背景时，传 pageBackground:false（并把 canvas 层级/内容层级自己安排）。
    if (this.options.pageBackground === 'transparent') {
      css += 'html,body{background-color:transparent!important;background-image:none!important;}'
    }
    st.textContent = css
    ;(document.head || document.documentElement).appendChild(st)
  }

  _applyGlobalOptions() {
    const o = this.options
    const r = this.renderer
    if (o.dpr != null) r.dpr = clamp(o.dpr, 0.5, 4)
    if (o.cornerStyle != null) r.cornerStyle = o.cornerStyle
    if (o.blurTapCap != null) r.blurTapCap = clamp(o.blurTapCap | 0, 1, 33)
    if (o.blurDownsample != null) r.blurDownsample = clamp(o.blurDownsample | 0, 1, 8)
    if (o.dynamicBlurDownsample != null) r.dynamicBlurDownsample = !!o.dynamicBlurDownsample
    if (o.useKawaseBlur != null) r.useKawaseBlur = !!o.useKawaseBlur
    if (o.useBlurCache != null) r.useBlurCache = !!o.useBlurCache
    if (o.usePerElementFbo != null) r.usePerElementFbo = !!o.usePerElementFbo
    if (o.directBackdropSample != null) r.directBackdropSample = !!o.directBackdropSample
    if (o.noContinuousSdf != null) r.noContinuousSdf = !!o.noContinuousSdf
    if (o.capsuleSdfQuality != null) r.capsuleSdfQuality = clamp(o.capsuleSdfQuality, 0.25, 2)
  }

  _onResize = () => {
    this.resize()
  }

  resize() {
    const cssW = this.canvas.clientWidth || window.innerWidth
    const cssH = this.canvas.clientHeight || window.innerHeight
    if (cssW === this._lastCssW && cssH === this._lastCssH) return
    this._lastCssW = cssW
    this._lastCssH = cssH
    this.renderer.resize(cssW, cssH)
  }

  /* ------------------------------------------------------- 按压动画 */
  /* 渲染器里只有 kind==='button' 会跑按压弹簧（InteractiveHighlight.kt）：
   *   - pressProgress 0→1：玻璃放大 1+4/48，同时手指位置出现白色辉光；
   *   - 拖动时玻璃按 tanh 跟手（DOM 元素不动）；
   *   - 松手：欠阻尼弹簧回弹（bouncy）。
   * 这里只负责把 DOM 事件翻译成 renderer.setPressed() / setDragPosition()。 */

  /** 找 event.target 往上最近的「开了按压动画」的元素。 */
  _pressedRecAt(target) {
    let n = target
    while (n && n !== document) {
      const rec = this._find(n)
      if (rec && this._params(rec).interactive) return rec
      n = n.parentElement
    }
    return null
  }

  _onPointerDown = (e) => {
    if (!this._running) return
    const rec = this._pressedRecAt(e.target)
    if (!rec) return
    this._pressed = { rec, pointerId: e.pointerId }
    this.renderer.setPressed(rec.id, true, { x: e.clientX, y: e.clientY })
    window.addEventListener('pointermove', this._onPointerMove, true)
    window.addEventListener('pointerup', this._onPointerUp, true)
    window.addEventListener('pointercancel', this._onPointerUp, true)
  }

  _onPointerMove = (e) => {
    if (!this._pressed || e.pointerId !== this._pressed.pointerId) return
    this.renderer.setDragPosition(this._pressed.rec.id, { x: e.clientX, y: e.clientY })
  }

  _onPointerUp = (e) => {
    if (!this._pressed || (e.pointerId != null && e.pointerId !== this._pressed.pointerId)) return
    this.renderer.setPressed(this._pressed.rec.id, false)
    this._pressed = null
    window.removeEventListener('pointermove', this._onPointerMove, true)
    window.removeEventListener('pointerup', this._onPointerUp, true)
    window.removeEventListener('pointercancel', this._onPointerUp, true)
  }

  /* ------------------------------------------------------- 元素登记 */

  scan(root) {
    root = root || document
    const nodes = root.querySelectorAll('[data-liquid-glass], [data-lg]')
    // 扫描过程中先别急着重建：一次 apply；更重要的是，文字行的「归属」取决于
    // 当时登记了哪些元素 —— 扫到一半就缓存会把子元素的文字算到父容器头上。
    const prevScanning = this._scanning
    this._scanning = true
    for (let i = 0; i < nodes.length; i++) {
      if (this._find(nodes[i])) continue
      const raw = nodes[i].getAttribute('data-liquid-glass') || nodes[i].getAttribute('data-lg')
      let opts = {}
      if (raw && raw !== '') {
        try {
          opts = JSON.parse(raw)
        } catch (e) {
          console.warn('[LiquidGlass] data-liquid-glass 不是合法 JSON：', raw)
        }
      }
      this.add(nodes[i], opts)
    }
    this._scanning = prevScanning
    this._apply()
    return this
  }

  add(target, params) {
    const el = typeof target === 'string' ? document.querySelector(target) : target
    if (!el) return null
    const exist = this._find(el)
    if (exist) {
      if (params) this.update(el, params)
      return exist
    }
    const rec = {
      el,
      id: 'lg-' + (LiquidGlass._uid = (LiquidGlass._uid || 0) + 1),
      params: Object.assign({}, params || {}),
      key: '',
      config: null,
      cssRadius: null,
      // 入场动画状态（0→1 弹簧）
      anim: { value: 0, vel: 0, target: 1, active: false, delay: 0 },
    }
    el.classList.add(this.options.className)
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
    this.records.push(rec)
    // 登记集合变了 → 文字行的归属可能变 → 让所有文字行缓存失效
    this._textEpoch = (this._textEpoch || 0) + 1
    this._readRadius(rec, true)
    this._startEnter(rec)
    if (!this._scanning) this._apply()
    return rec
  }

  /** 给一个元素安排入场动画（同一批内按注册顺序叠加 stagger）。 */
  _startEnter(rec) {
    const p = this._params(rec)
    if (p.animateIn === false) return
    const now = performance.now()
    // 同一「批」= 连续 120ms 内登记的元素（scan 一次扫到的那些）
    if (!this._enterBatchT || now - this._enterBatchT > 120) this._enterCount = 0
    this._enterBatchT = now
    const stagger = num(p.enterStagger, 0)
    rec.anim.value = 0
    rec.anim.vel = 0
    rec.anim.target = 1
    rec.anim.delay = ((this._enterCount || 0) * stagger) / 1000
    rec.anim.active = true
    this._enterCount = (this._enterCount || 0) + 1
  }

  update(target, params) {
    const rec = this._find(target)
    if (!rec) return null
    if (params && params.preset && PRESETS[params.preset]) {
      // 换预设 = 重置该元素的观感参数（形状 / 变换保留）
      const keep = {}
      for (const k of KEEP_KEYS) {
        if (rec.params[k] !== undefined) keep[k] = rec.params[k]
      }
      for (const k of LOOK_KEYS) delete rec.params[k]
      Object.assign(rec.params, keep)
    }
    Object.assign(rec.params, params || {})
    if (params && ('shape' in params || 'radius' in params || 'radiusFraction' in params)) rec.cssRadius = null
    rec.key = ''
    // 显式 API 调用直接重建元素表，不依赖 rAF 循环（后台标签页里 rAF 会被节流）
    this._apply()
    return rec
  }

  remove(target) {
    const rec = this._find(target)
    if (!rec) return this
    rec.el.classList.remove(this.options.className)
    this.records.splice(this.records.indexOf(rec), 1)
    this._textEpoch = (this._textEpoch || 0) + 1
    this._apply()
    this._syncSceneTextClass(new Set())
    return this
  }

  get(target) {
    return this._find(target)
  }

  /** 某个元素「实际生效」的参数（预设 + 全局 + 元素覆盖合并后的结果）。 */
  paramsOf(target) {
    const rec = this._find(target)
    if (!rec) return null
    const p = this._params(rec)
    delete p.__sig
    return p
  }

  /* ------------------------------------------------------ 预设 / 按压 */

  /**
   * 切换预设。
   *   setPreset('liquid')              → 全部元素
   *   setPreset('liquid', '#card')     → 只改一个元素
   */
  setPreset(name, target) {
    if (!PRESETS[name]) {
      console.warn('[LiquidGlass] 未知预设：', name, '可选：', Object.keys(PRESETS).join(', '))
      return this
    }
    if (target) {
      this.update(target, { preset: name })
    } else {
      this.options.preset = name
      this._overrides = {}
      this._enterCount = 0
      for (const rec of this.records) {
        if (this._params(rec).keepLook) continue
        const keep = {}
        for (const k of KEEP_KEYS) {
          if (rec.params[k] !== undefined) keep[k] = rec.params[k]
        }
        rec.params = Object.assign(keep, { preset: name })
        rec.key = ''
      }
    }
    this._apply()
    return this
  }

  /** 手动驱动某个元素的按压弹簧（DOM 事件已经自动接好，这个用于脚本控制）。 */
  press(target, pressed, position) {
    const rec = this._find(target)
    if (!rec) return this
    const pos = position || { x: 0, y: 0 }
    if (pressed) {
      // 首次按下时把位置当作「起点」，之后的 press 调用当作拖动
      if (this._pressed && this._pressed.rec === rec) this.renderer.setDragPosition(rec.id, pos)
      else {
        this._pressed = { rec, pointerId: null }
        this.renderer.setPressed(rec.id, true, pos)
      }
    } else {
      this.renderer.setPressed(rec.id, false)
      if (this._pressed && this._pressed.rec === rec) this._pressed = null
    }
    return this
  }

  /** 重播全部元素的入场动画。 */
  intro() {
    this._enterCount = 0
    this._enterBatchT = 0
    for (const rec of this.records) this._startEnter(rec)
    this._apply()
    return this
  }

  /** 改全局默认参数：已有的、没有单独覆盖该参数的元素会立刻跟随。 */
  setParam(name, value) {
    this.options[name] = value
    if (name in GLOBAL_KEYS) {
      this._applyGlobalOptions()
      this.renderer.markAllDirty()
      this.renderer.requestRender()
    } else if (LOOK_KEYS.indexOf(name) >= 0) {
      // 观感参数：记成显式覆盖，优先级高于预设
      this._overrides[name] = value
      this._apply()
    } else {
      this._apply()
    }
    return this
  }

  /** 批量：对所有已登记元素生效（游乐场里的滑杆就是用它）。 */
  updateAll(params) {
    for (const rec of this.records) {
      if (this._params(rec).keepLook) continue
      Object.assign(rec.params, params)
      rec.key = ''
    }
    this._apply()
    return this
  }

  refresh() {
    for (const rec of this.records) {
      rec.key = ''
      this._readRadius(rec, true)
    }
    this._apply()
    return this
  }

  /**
   * DOM 自身的可见度（0~1）：
   *   - display:none / visibility:hidden → 0（玻璃也要消失，否则隐藏的元素会留一块"玻璃幽灵"）
   *   - opacity 直接乘进玻璃的 enterProgress（所以 CSS 淡入淡出时玻璃跟着淡）
   */
  _domAlpha(rec) {
    const el = rec.el
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden') return 0
    const a = parseFloat(cs.opacity)
    return isFinite(a) ? a : 1
  }

  _find(target) {
    const el = typeof target === 'string' ? document.querySelector(target) : target
    if (!el) return null
    for (let i = 0; i < this.records.length; i++) if (this.records[i].el === el) return this.records[i]
    return null
  }

  /* --------------------------------------------------------- 形状 */

  _readRadius(rec, force) {
    if (rec.cssRadius && !force) return rec.cssRadius
    const cs = getComputedStyle(rec.el)
    const r = rec.el.getBoundingClientRect()
    const minDim = Math.max(1, Math.min(r.width, r.height))
    const parsed = [
      cs.borderTopLeftRadius,
      cs.borderTopRightRadius,
      cs.borderBottomRightRadius,
      cs.borderBottomLeftRadius,
    ].map((v) => {
      const f = parseFloat(v) || 0
      return /%$/.test(v) ? (f / 100) * minDim : f
    })
    // 渲染器只接受统一圆角，四角不同时取最大值（保证外轮廓包住元素）
    rec.cssRadius = parsed
    rec.cssRadiusMax = Math.max.apply(null, parsed)
    return rec.cssRadius
  }

  _resolveRadius(rec, w, h, p) {
    if (typeof p.radius === 'number') return p.radius
    if (typeof p.radiusFraction === 'number') return p.radiusFraction * Math.min(w, h) * 0.5
    if (p.shape === 'capsule' || p.shape === 'circle') return Math.min(w, h) * 0.5
    if (p.shape === 'rect') return 0
    this._readRadius(rec, false)
    return Math.min(rec.cssRadiusMax || 0, Math.min(w, h) * 0.5)
  }

  /* ------------------------------------------------------- 几何同步 */

  _sync(force) {
    let changed = !!force
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i]
      const key = this._key(rec)
      if (key !== rec.key) {
        rec.key = key
        changed = true
      }
    }
    if (changed) this._apply()
  }

  /** 便宜的变化签名：形状 + 位置 + 所有参数。 */
  _key(rec) {
    const el = rec.el
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return 'hidden|' + r.width + '|' + r.height
    const domA = this._domAlpha(rec)
    if (domA <= 0.001) return 'hidden-opacity|' + r.left + '|' + r.top
    const p = this._params(rec)
    this._readRadius(rec, false)
    const w = Math.round(r.width * 100) / 100
    const h = Math.round(r.height * 100) / 100
    return [
      Math.round(r.left * 100) / 100,
      Math.round(r.top * 100) / 100,
      w,
      h,
      this._resolveRadius(rec, w, h, p).toFixed(2),
      domA.toFixed(3),
      p.refractText !== false ? textHash(rec.el) : '0',
      p.__sig,
    ].join('|')
  }

  /**
   * 元素参数 = 默认值 → 预设 → 全局显式覆盖 → 元素自己的 params。
   * 顺序很关键：预设必须能压过 DEFAULTS 里的同一批键，而 setParam()/update()
   * 又要能压过预设——否则「换预设」会失效或「手调滑杆」会被预设吃掉。
   */
  _params(rec) {
    const rp = rec.params || {}
    const name = rp.preset || this.options.preset
    const preset = (name && PRESETS[name] && PRESETS[name].params) || null
    const p = Object.assign({}, this.options, preset || {}, this._overrides, rp)
    // highlight / outerShadow / innerShadow 逐层深合并：
    // 预设只写想改的字段（比如只调 alpha），不该把默认的 radius / offsetY 顶掉。
    for (const k of ['highlight', 'outerShadow', 'innerShadow']) {
      let merged = this.options[k]
      for (const layer of [preset && preset[k], this._overrides[k], rp[k]]) {
        if (layer === false || layer === null) merged = layer
        else if (layer && typeof layer === 'object') {
          merged = Object.assign({}, merged && typeof merged === 'object' ? merged : {}, layer)
        }
      }
      if (merged !== undefined) p[k] = merged
    }
    p.__sig = signature(p)
    return p
  }

  _apply() {
    const configs = []
    const wanted = new Set()
    // 已登记元素集合：用来判断一个文本节点「归谁」—— 外层容器不该把子元素的
    // 文字再画一遍（否则同一段字会被画两次、动画期间还会错位成重影）。
    const owners = new Set()
    for (let i = 0; i < this.records.length; i++) owners.add(this.records[i].el)
    const allTextRects = []
    let textSig = ''
    // 1) 先把「文字元素」按文档顺序放进场景 —— 玻璃随后采样场景时就能把文字
    //    一起折射 / 模糊（原仓库 catalog 里的文字本来就是 kind:'text' 元素）。
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i]
      rec._textSigNew = ''
      const p = this._params(rec)
      if (p.refractText === false) continue
      const r = rec.el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      // 下面两种情况放弃接管（保留 DOM 文字，玻璃照样折射壁纸）：
      //   - 旋转：逐行的行盒对不上旋转后的玻璃
      //   - scale < 1：玻璃比文字小一圈，场景里的那份文字会从玻璃边上露出来变重影
      if (num(p.rotation, 0) !== 0) continue
      if (num(p.scale, 1) < 1) continue
      const cached = this._textRuns(rec, owners)
      if (!cached.runs.length) continue
      for (const par of cached.parents) wanted.add(par)
      const st = this._enterState(rec, p)
      rec._textRects = []
      let sig = ''
      for (let k = 0; k < cached.runs.length; k++) {
        const tc = this._toTextConfig(rec, cached.runs[k], k, r, st)
        const box = {
          left: tc.rect.x,
          top: tc.rect.y,
          right: tc.rect.x + tc.rect.w,
          bottom: tc.rect.y + tc.rect.h,
        }
        rec._textRects.push(box)
        allTextRects.push(box)
        sig += tc.id + ':' + (tc.rect.x | 0) + ',' + (tc.rect.y | 0) + ',' + tc.text.content.length + ';'
        configs.push(tc)
      }
      rec._textSigNew = sig
      textSig += sig
    }

    // 哪些玻璃「盖住了文字」：这些必须采样场景，否则会把底下的字整个盖掉；
    // 没盖住文字的玻璃（开关、小圆点…）继续采样干净的壁纸 —— 更通透、更快，
    // 也不会被上一层玻璃的模糊糊掉（「开关不折射」就是被这个坑到了）。
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i]
      if (!allTextRects.length) {
        rec._sceneTextOverlap = false
        continue
      }
      const r = rec.el.getBoundingClientRect()
      let hit = false
      for (let k = 0; k < allTextRects.length; k++) {
        const t = allTextRects[k]
        if (!(t.right < r.left || t.left > r.right || t.bottom < r.top || t.top > r.bottom)) {
          hit = true
          break
        }
      }
      rec._sceneTextOverlap = hit
    }
    this._syncSceneTextClass(wanted)

    // 2) 再放玻璃（顺序 = 文档顺序）
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i]
      const cfg = this._toConfig(rec)
      if (cfg) configs.push(cfg)
    }
    this.renderer.setElements(configs)

    // ------------------------------------------------------------------
    // 上游缓存失效的补丁：把文字放进场景以后，文字的位置/内容变化不会产生
    // 「dirty rect」（非玻璃元素的 dirty 只按事件标记），于是盖在文字上的玻璃会
    // 一直复用旧底图 —— 表现是文字被擦掉、或者停在旧位置变成重影。
    // 所以这里自己算：哪些玻璃与「变化了的文字行」相交 → 只失效它们。
    // ------------------------------------------------------------------
    let needBlurClear = false
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i]
      const sig = rec._textSigNew || ''
      const prev = rec.textSig || ''
      if (sig === prev) continue
      rec.textSig = sig
      // 文字被取消接管时用元素矩形兜底（行矩形已经不可信了）
      const changed = (sig && rec._textRects) ? rec._textRects : [rec.el.getBoundingClientRect()]
      for (let g = 0; g < configs.length; g++) {
        const gc = configs[g]
        if (gc.kind === 'text') continue
        if (gc.id === rec.id) {
          this.renderer.markElementDirty(gc.id)
          if (gc.blurRadius > 0.5) needBlurClear = true
          continue
        }
        for (let k = 0; k < changed.length; k++) {
          const r2 = changed[k]
          if (!(r2.right < gc.rect.x || r2.left > gc.rect.x + gc.rect.w ||
                r2.bottom < gc.rect.y || r2.top > gc.rect.y + gc.rect.h)) {
            this.renderer.markElementDirty(gc.id)
            if (gc.blurRadius > 0.5) needBlurClear = true
            break
          }
        }
      }
    }
    if (needBlurClear && this.renderer.clearBackdropBlurCache) {
      this.renderer.clearBackdropBlurCache()
    }
    void textSig
  }

  /** DOM 文字 -> 透明的 class 同步（只对我们真的接管了的父元素动手）。 */
  _syncSceneTextClass(wanted) {
    if (!this._sceneTextEls) this._sceneTextEls = new Set()
    for (const el of Array.from(this._sceneTextEls)) {
      if (!wanted.has(el)) {
        el.classList.remove('lg-scene-text')
        this._sceneTextEls.delete(el)
      }
    }
    for (const el of wanted) {
      if (!el.classList.contains('lg-scene-text')) {
        // 先记下原来的颜色：否则下次重建文字行会读到 transparent
        el.__lgOrigColor = getComputedStyle(el).color
        el.classList.add('lg-scene-text')
      }
      this._sceneTextEls.add(el)
    }
  }

  /**
   * 提取元素里的文本行（坐标相对元素左上角，带缓存）。
   * 逐字符取 Range 的 rect，按 top 分组成行 → 每行一个 'text' 元素交给渲染器。
   * 表单控件（select / input / button / option）里的文字不接管，否则会把
   * 控件自己的文字也弄成透明。
   */
  _textRuns(rec, owners) {
    const el = rec.el
    const r = el.getBoundingClientRect()
    const txt = el.textContent || ''
    let hash = 0
    for (let i = 0; i < txt.length; i++) hash = (hash * 31 + txt.charCodeAt(i)) | 0
    const sig =
      (this._textEpoch || 0) +
      '|' + txt.length +
      '|' + Math.round(r.width) + 'x' + Math.round(r.height) +
      '|' + hash +
      '|' + getComputedStyle(el).font
    if (rec.textCache && rec.textCache.sig === sig) return rec.textCache
    const runs = []
    const parents = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null)
    let node
    while ((node = walker.nextNode())) {
      const raw = node.nodeValue
      if (!raw || !raw.trim()) continue
      const parent = node.parentElement
      if (!parent) continue
      if (parent.closest('input,select,textarea,button,option')) continue
      if (parent.querySelector('input,select,textarea,button,option')) continue
      // 归属检查：最近的「已登记元素」祖先必须是自己
      let owner = parent
      let mine = false
      while (owner) {
        if (owners && owners.has(owner)) {
          mine = owner === el
          break
        }
        if (owner === el) {
          mine = true
          break
        }
        owner = owner.parentElement
      }
      if (!mine) continue
      const cs = getComputedStyle(parent)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      const color = parseColor(parent.__lgOrigColor || cs.color)
      if (color[3] <= 0.02) continue
      const fontSize = parseFloat(cs.fontSize) || 14
      const fontWeight = parseInt(cs.fontWeight, 10) || 400
      // 用浏览器自己的「行盒」：Range.getClientRects() 对整段文字返回每行一个 rect，
      // 比按字符 top 猜换行可靠得多（空白字符的 rect 在换行处很不规则）。
      const full = document.createRange()
      full.selectNodeContents(node)
      const rawLines = Array.from(full.getClientRects()).filter((b) => b.width > 0.5 && b.height > 0.5)
      if (!rawLines.length) continue
      const lineChars = rawLines.map(() => [])
      const charRange = document.createRange()
      for (let i = 0; i < raw.length; i++) {
        let cr = null
        try {
          charRange.setStart(node, i)
          charRange.setEnd(node, i + 1)
          const rects = charRange.getClientRects()
          cr = rects.length ? rects[0] : null
        } catch (err) {
          cr = null
        }
        if (!cr || (cr.width === 0 && cr.height === 0)) continue
        const mid = (cr.top + cr.bottom) / 2
        let best = -1
        let bestD = Infinity
        for (let k = 0; k < rawLines.length; k++) {
          const L = rawLines[k]
          const d = Math.abs((L.top + L.bottom) / 2 - mid)
          if (d < bestD) {
            bestD = d
            best = k
          }
        }
        if (best >= 0) lineChars[best].push(i)
      }
      let added = false
      for (let k = 0; k < rawLines.length; k++) {
        const idx = lineChars[k]
        if (!idx.length) continue
        const text = raw.slice(idx[0], idx[idx.length - 1] + 1).replace(/\s+/g, ' ').trim()
        if (!text) continue
        const L = rawLines[k]
        runs.push({
          text,
          color,
          fontSize,
          fontWeight,
          dx: L.left - r.left,
          dy: L.top - r.top,
          w: Math.max(1, L.width),
          h: Math.max(1, L.height),
        })
        added = true
      }
      if (added && parents.indexOf(parent) < 0) parents.push(parent)
    }
    rec.textCache = { sig, runs, parents }
    return rec.textCache
  }

  /** 文字元素 = 原仓库 catalog 里 makeText() 的 kind:'text'。 */
  _toTextConfig(rec, run, index, elRect, st) {
    return {
      id: rec.id + '-t' + index,
      kind: 'text',
      rect: {
        x: elRect.left + run.dx + st.dx,
        // 文字元素走的是 renderNonGlassElement，入场位移一定会生效 → 用 textDy 补
        y: elRect.top + run.dy + st.textDy,
        w: run.w,
        h: run.h,
      },
      cornerRadius: 0,
      refractionHeight: 0,
      refractionAmount: 0,
      depthEffect: false,
      chromaticAberration: false,
      blurRadius: 0,
      saturation: 1,
      brightness: 0,
      contrast: 1,
      tintColor: [0, 0, 0, 0],
      surfaceColor: [0, 0, 0, 0],
      highlight: null,
      outerShadow: null,
      label: '',
      labelColor: [0, 0, 0, 1],
      showChevron: false,
      isInteractive: false,
      scroll: false,
      text: {
        content: run.text,
        color: run.color,
        fontSizePx: run.fontSize,
        fontWeight: run.fontWeight,
        align: 'left',
        wrap: false,
        paddingPx: 0,
        halo: 'none',
      },
      enterProgress: st.progress,
    }
  }

  /**
   * 入场动画的统一状态。
   *
   * 关键：渲染器对 enterProgress 的处理**玻璃和文字不一样**：
   *   - 玻璃（kind 不是 button / isInteractive=false）：`translationY += -48*(1-derived)`
   *     → 需要补 +48*(1-derived) 才不会有位移；
   *   - 玻璃（kind='button' + isInteractive，也就是我们的 interactive:true）：
   *     紧随其后的 press 分支是 **赋值** `translationY = ...`，把入场位移整个覆盖掉了
   *     → 这时候再补 48 就会让整块玻璃随透明度往下跑（透明到 0 就下移 48px）；
   *   - 文字元素（kind='text'）：走 renderNonGlassElement，`r2.y = r.y + ty` → 需要补。
   * 所以这里给出两个 y 偏移：dy 给玻璃，textDy 给文字。
   */
  _enterState(rec, p) {
    const a = rec.anim
    const e = a && a.active ? a.value : 1
    const domA = rec._domAlpha != null ? rec._domAlpha : 1
    const op = p.enterProgress != null ? num(p.enterProgress, 1) : num(p.opacity, 1)
    const progress = (e < 1 ? e : 1) * op * domA
    const raw = progress
    const derived =
      raw < 0 ? (1 - Math.exp(-Math.abs(raw))) * -1 : raw <= 1 ? raw : 1 + (1 - Math.exp(-(raw - 1)))
    const enterTy = 48 * (1 - derived)
    const interactive = !!p.interactive
    // 我们自己的入场位移（玻璃和文字都要）
    const slide = e < 1 ? num(p.enterOffset, 6) * (1 - e) : 0
    return {
      e,
      progress,
      dx: slide * 0.35,
      dy: (interactive ? 0 : enterTy) + slide,
      textDy: enterTy + slide,
    }
  }

  /** DOM 元素 → 原仓库的 GlassElementConfig（kind = 'glass-shape'）。 */
  _toConfig(rec) {
    const el = rec.el
    const r = el.getBoundingClientRect()
    const w = r.width
    const h = r.height
    if (w < 2 || h < 2) return null
    const domAlpha = this._domAlpha(rec)
    if (domAlpha <= 0.001) return null
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (r.right < -16 || r.bottom < -16 || r.left > vw + 16 || r.top > vh + 16) return null

    const p = this._params(rec)
    const minDim = Math.min(w, h)
    const radius = this._resolveRadius(rec, w, h, p)

    // 旋转：getBoundingClientRect 给的是旋转后的 AABB，而渲染器需要「未旋转的
    // 矩形 + elementRotation」，否则玻璃会被放大成外接框。用 offsetWidth/Height
    // 取未旋转尺寸，中心仍取 AABB 中心。
    let rx0 = r.left
    let ry0 = r.top
    let rw0 = w
    let rh0 = h
    const rotDeg = num(p.rotation, 0)
    if (rotDeg !== 0 && el.offsetWidth) {
      rw0 = el.offsetWidth
      rh0 = el.offsetHeight
      rx0 = r.left + r.width / 2 - rw0 / 2
      ry0 = r.top + r.height / 2 - rh0 / 2
    }

    // 折射参数：与原仓库一样，refractionAmount 取负号（向内凹）
    const refrHeight =
      typeof p.refractionHeight === 'number'
        ? p.refractionHeight
        : (p.refractionHeightFraction != null ? p.refractionHeightFraction : 0.2) * minDim * 0.5
    const refrAmountRaw =
      typeof p.refractionAmount === 'number'
        ? p.refractionAmount
        : (p.refractionAmountFraction != null ? p.refractionAmountFraction : 0.2) * minDim

    const hl = p.highlight === false || p.highlight == null
      ? null
      : Object.assign({}, DEFAULT_HIGHLIGHT, p.highlight, {
          angle: ((p.highlight && p.highlight.angleDeg != null ? p.highlight.angleDeg : 45) * Math.PI) / 180,
          color: p.highlight && p.highlight.color ? parseColor(p.highlight.color).slice(0, 3) : DEFAULT_HIGHLIGHT.color,
        })

    const sh = p.outerShadow === false || p.outerShadow == null
      ? null
      : Object.assign({}, DEFAULT_SHADOW, p.outerShadow, {
          color: p.outerShadow && p.outerShadow.color ? parseColor(p.outerShadow.color).slice(0, 3) : DEFAULT_SHADOW.color,
        })

    const is = p.innerShadow
      ? Object.assign(
          { radius: 24, alpha: 0.15, offsetX: 0, offsetY: 0 },
          p.innerShadow,
          p.innerShadow.color ? { color: parseColor(p.innerShadow.color).slice(0, 3) } : {}
        )
      : null

    // 入场动画：0→1 弹簧 + DOM 自身的透明度（文字元素用同一套数值，保证不错位）
    rec._domAlpha = domAlpha
    const st = this._enterState(rec, p)
    const e = st.e
    const enterProgress = st.progress
    rx0 += st.dx
    ry0 += st.dy

    // 只有「盖住了场景文字」的玻璃才必须采样场景（否则会把底下的字盖掉）；
    // 其余元素照样可以走「只采样壁纸」的通透路径。
    const refractImpossible = p.refractText === false || num(p.rotation, 0) !== 0 || num(p.scale, 1) < 1
    const independent = rec._sceneTextOverlap ? false : !!p.independentBackdrop

    const interactive = !!p.interactive
    const cfg = {
      id: rec.id,
      // 原仓库里只有 'button' 会跑按压弹簧（缩放 + 手指高光 + 回弹），
      // 所以「要动画」的元素用 button，其余用无标签的 glass-shape。
      kind: interactive ? 'button' : 'glass-shape',
      rect: { x: rx0, y: ry0, w: rw0, h: rh0 },
      cornerRadius: radius,
      refractionHeight: refrHeight,
      refractionAmount: -Math.abs(refrAmountRaw),
      depthEffect: !!p.depthEffect,
      chromaticAberration: !!p.chromaticAberration,
      blurRadius: num(p.blur, 2),
      saturation: num(p.saturation, 1.5),
      brightness: num(p.brightness, 0),
      contrast: num(p.contrast, 1),
      tintColor: parseColor(p.tintColor),
      surfaceColor: parseColor(p.surfaceColor),
      highlight: hl,
      outerShadow: sh,
      label: '',
      labelColor: [0, 0, 0, 1],
      showChevron: false,
      isInteractive: interactive,
      scroll: false,
      innerShadow: is,
      independentBackdrop: independent,
      directBackdropSample: rec._sceneTextOverlap ? false : !!p.directSample,
      enterProgress: enterProgress,
      elementRotation: ((num(p.rotation, 0)) * Math.PI) / 180,
      useSeparableBlur: true,
      useContinuousSdf: !!p.capsuleShape,
    }
    const scale = num(p.scale, 1)
    // 入场时从 0.9 弹到 1（弹簧过冲时会略大于 1）。
    // 但文字折射模式下不能再缩放：场景里的文字不会跟着缩放，玻璃一缩小文字就从边上露出来。
    const pop = e < 1 && !refractImpossible ? 0.9 + 0.1 * e : 1
    if (scale * pop !== 1) {
      cfg.elementScaleX = scale * pop
      cfg.elementScaleY = scale * pop
    }
    rec.config = cfg
    return cfg
  }

  /* ------------------------------------------------------- 渲染循环 */

  /**
   * 推进 host 侧的弹簧（入场动画）。按压动画用的是渲染器自己的弹簧，
   * 由 renderer.startAnimation() 驱动，不在这里。
   * 返回 true 表示这一帧有动画在跑（需要重建元素表）。
   */
  _stepAnimations(dt) {
    let any = false
    const om = 15.5 // ω_n ≈ sqrt(240)
    const zeta = 0.74 // 轻微过冲
    for (let i = 0; i < this.records.length; i++) {
      const a = this.records[i].anim
      if (!a || !a.active) continue
      if (a.delay > 0) {
        a.delay -= dt
        any = true
        continue
      }
      // 半隐式欧拉 + 子步，dt 大时也不会炸
      const steps = Math.max(1, Math.ceil(dt / 0.008))
      const h = dt / steps
      for (let s = 0; s < steps; s++) {
        const acc = om * om * (a.target - a.value) - 2 * zeta * om * a.vel
        a.vel += acc * h
        a.value += a.vel * h
      }
      if (Math.abs(a.target - a.value) < 0.002 && Math.abs(a.vel) < 0.02) {
        a.value = a.target
        a.vel = 0
        a.active = false
      } else {
        any = true
      }
    }
    return any
  }

  start() {
    if (this._running) return this
    this._running = true
    const tick = (t) => {
      if (!this._running) return
      this._raf = requestAnimationFrame(tick)
      const dt = this._lastT ? Math.min((t - this._lastT) / 1000, 1 / 20) : 0
      this._lastT = t
      this._time = t
      const animating = this._stepAnimations(dt)
      this.resize()
      this._sync(animating)
      if (this._wallpaperFrame) this._wallpaperFrame(t)
    }
    this._raf = requestAnimationFrame(tick)
    return this
  }

  stop() {
    this._running = false
    if (this._raf) cancelAnimationFrame(this._raf)
    this._raf = 0
    return this
  }

  /** 手动渲染一帧（测试/截图用）。会把入场动画和按压弹簧都归位。 */
  renderNow() {
    for (const rec of this.records) {
      if (rec.anim) {
        rec.anim.value = rec.anim.target
        rec.anim.vel = 0
        rec.anim.active = false
      }
      const st = this.renderer.buttonStates.get(rec.id)
      if (st) {
        st.pressProgress = 0
        st.pressVelocity = 0
        st.targetPress = 0
        st.dragX = st.startDragX
        st.dragY = st.startDragY
        st.targetDragX = st.startDragX
        st.targetDragY = st.startDragY
        st.dragVx = 0
        st.dragVy = 0
      }
    }
    this.resize()
    this._sync(true)
    this._apply()
    this.renderer.render()
    return this
  }

  /* --------------------------------------------------------- 壁纸 */

  /**
   * 设置壁纸（折射源）：
   *   'url' | dataURL          图片
   *   { type:'image', src }    图片
   *   { type:'color', color }  纯色（走渲染器 setBackgroundColor）
   *   { type:'canvas'|'video'|'image' 元素, source }  直接上传
   *   { type:'draw', draw(ctx,w,h,t), animate? }      用 2D canvas 画
   *   function(ctx,w,h,t)      同 draw
   */
  setWallpaper(wp) {
    if (typeof wp === 'function') wp = { type: 'draw', draw: wp }
    if (typeof wp === 'string') {
      if (/^\s*(#|rgb|hsl)/.test(wp)) wp = { type: 'color', color: wp }
      else wp = { type: 'image', src: wp }
    }
    this._wallpaper = wp
    this._wallpaperFrame = null

    if (!wp) return this

    if (wp.type === 'color') {
      const c = parseColor(wp.color || '#000')
      this.renderer.setBackgroundColor([c[0], c[1], c[2]])
      this.renderer.requestRender()
      return this
    }

    if (wp.type === 'image' && wp.src) {
      this.renderer.loadWallpaper(wp.src).catch((e) => console.error('[LiquidGlass]', e))
      return this
    }

    const source = wp.source || (wp.type === 'video' ? this._makeVideo(wp) : null)
    if (source && wp.type !== 'draw') {
      this._uploadWallpaperSource(source)
      // 只有显式 animate 才每帧重传纹理（video 天然需要）
      if (wp.type === 'video' || wp.animate) {
        this._wallpaperFrame = () => this._uploadWallpaperSource(source)
      }
      return this
    }

    if (wp.type === 'draw') {
      const cv = (this._wpCanvas = this._wpCanvas || document.createElement('canvas'))
      const draw = (t) => {
        const cssW = this.canvas.clientWidth || window.innerWidth
        const cssH = this.canvas.clientHeight || window.innerHeight
        const scale = Math.min(1, 1280 / Math.max(cssW, cssH))
        const w = Math.max(2, Math.round(cssW * scale))
        const h = Math.max(2, Math.round(cssH * scale))
        if (cv.width !== w || cv.height !== h) {
          cv.width = w
          cv.height = h
        }
        const ctx = cv.getContext('2d')
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, w, h)
        wp.draw(ctx, w, h, t || 0)
        this._uploadWallpaperSource(cv)
      }
      draw(0)
      if (wp.animate) this._wallpaperFrame = draw
      return this
    }

    return this
  }

  _makeVideo(wp) {
    const v = document.createElement('video')
    v.src = wp.src
    v.muted = wp.muted !== false
    v.loop = wp.loop !== false
    v.playsInline = true
    v.autoplay = wp.autoplay !== false
    v.style.display = 'none'
    document.body.appendChild(v)
    v.play().catch(() => {})
    return v
  }

  /**
   * 把任意可绘制源上传成壁纸纹理。
   * 复刻原仓库 loadWallpaper() 的纹理设置 + 失效逻辑（该方法只接受 URL，
   * 这里补一个接受 canvas/video/Image 的版本）。
   */
  _uploadWallpaperSource(src) {
    const r = this.renderer
    const gl = r.gl
    if (!src) return
    const w = src.width || src.videoWidth || src.naturalWidth || 1
    const h = src.height || src.videoHeight || src.naturalHeight || 1
    if (r.wallpaperTexture) gl.deleteTexture(r.wallpaperTexture)
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
    const isPOT = (w & (w - 1)) === 0 && (h & (h - 1)) === 0
    if (isPOT) {
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    r.wallpaperTexture = tex
    r.wallpaperSize = [w || 1, h || 1]
    r.wallpaperReady = true
    if (r.clearBackdropBlurCache) r.clearBackdropBlurCache()
    r.wallpaperVersion++
    r.markAllDirty()
    r.requestRender()
  }

  /** 亮度自适应用的平均色（透传渲染器能力，可选）。 */
  setBackgroundColor(color) {
    if (!color) {
      this.renderer.setBackgroundColor(null)
      return this
    }
    const c = parseColor(color)
    this.renderer.setBackgroundColor([c[0], c[1], c[2]])
    return this
  }

  destroy() {
    this._destroyed = true
    this.stop()
    window.removeEventListener('resize', this._onResize)
    window.removeEventListener('orientationchange', this._onResize)
    document.removeEventListener('pointerdown', this._onPointerDown, true)
    window.removeEventListener('pointermove', this._onPointerMove, true)
    window.removeEventListener('pointerup', this._onPointerUp, true)
    window.removeEventListener('pointercancel', this._onPointerUp, true)
    this._pressed = null
    try {
      this.renderer.dispose()
    } catch (e) {
      /* ignore */
    }
    for (const rec of this.records) rec.el.classList.remove(this.options.className)
    this._syncSceneTextClass(new Set())
    this.records.length = 0
    if (this._ownsCanvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas)
    if (this._video && this._video.parentNode) this._video.parentNode.removeChild(this._video)
    return this
  }
}

/** 换预设时要保留的「非观感」参数。 */
const KEEP_KEYS = [
  'shape',
  'radius',
  'radiusFraction',
  'rotation',
  'scale',
  'opacity',
  'interactive',
  'refractText',
  'animateIn',
]

/** 只影响渲染器全局状态的参数名。 */
const GLOBAL_KEYS = {
  dpr: 1,
  cornerStyle: 1,
  blurTapCap: 1,
  blurDownsample: 1,
  dynamicBlurDownsample: 1,
  useKawaseBlur: 1,
  useBlurCache: 1,
  usePerElementFbo: 1,
  directBackdropSample: 1,
  noContinuousSdf: 1,
  capsuleSdfQuality: 1,
}

/** 文字内容签名（很便宜，够用来发现文字被改过）。 */
function textHash(el) {
  const t = el.textContent || ''
  if (!t) return '0'
  let h = 0
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0
  return t.length + ':' + h
}

/** 把影响渲染结果的参数拼成一个短签名，用于判断"这一帧需不需要重建元素表"。 */
function signature(p) {
  const parts = []
  for (const k in p) {
    if (k === '__sig' || k === 'wallpaper' || k === 'canvas') continue
    const v = p[k]
    if (v == null) continue
    if (typeof v === 'object') parts.push(k + ':' + JSON.stringify(v))
    else parts.push(k + ':' + v)
  }
  return parts.join(',')
}
