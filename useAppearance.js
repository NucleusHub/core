// Applies the appearance of an imported /create build (state/appearance.json,
// written by `infra/modules import`). No file → the stock look, untouched.
//
// The accent reaches every app without them knowing about it: each stylesheet
// on the page (Tailwind's theme variables included, and whatever loads later)
// is scanned, and every colour in the stock purple–indigo–blue band is moved
// onto the accent in OKLCH, keeping how far it sat from the stock purple. Code
// that paints colours itself (inline styles, canvas, three.js) uses `recolor`.
const APPEARANCE_URL = '/appearance.json'
const CACHE_KEY = 'nucleus-appearance'
const STAMP_KEY = 'nucleus-appearance-stamp'
const STYLE_ID = 'nucleus-appearance'
const RECOLOR_ID = 'nucleus-appearance-colors'

const RADII = { xs: 0.125, sm: 0.25, md: 0.375, lg: 0.5, xl: 0.75, '2xl': 1, '3xl': 1.5, '4xl': 2 }
const BLURS = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 40, '3xl': 64 }
const DURATIONS = { '--nuc-dur-fast': 0.16, '--nuc-dur': 0.24, '--nuc-dur-slow': 0.5, '--default-transition-duration': 0.15 }
const MOTION = { full: 1, measured: 0.55, none: 0 }
const STOCK_TRANSPARENCY = 0.7

const CSS = `
html[data-nuc-motion="none"] *, html[data-nuc-motion="none"] *::before, html[data-nuc-motion="none"] *::after {
  animation-duration: 0s !important; animation-iteration-count: 1 !important;
  transition-duration: 0s !important; scroll-behavior: auto !important;
}
html { --nuc-ground: var(--nuc-ground-light, 244 243 250); --nuc-solid: var(--nuc-solid-light, #ffffff); }
html.dark { --nuc-ground: var(--nuc-ground-dark, 8 6 15); --nuc-solid: var(--nuc-solid-dark, #14111f); }
html[data-nuc-glass="clear"] *, html[data-nuc-glass="solid"] * { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
html[data-nuc-glass="clear"] [class*="backdrop-blur"][class*="inset-0"],
html[data-nuc-glass="clear"] .flex-1[class*="backdrop-blur"] { background-color: rgb(var(--nuc-ground) / 0.78) !important; }
html[data-nuc-glass="solid"] [class*="backdrop-blur"][class*="inset-0"],
html[data-nuc-glass="solid"] .flex-1[class*="backdrop-blur"] { background-color: rgb(var(--nuc-ground) / 0.94) !important; }
html[data-nuc-glass="solid"] [class*="backdrop-blur"]:not([class*="inset-0"]):not(.flex-1) { background-color: var(--nuc-solid) !important; }
html[data-nuc-glass] .nuc-surface-dark { background-color: rgb(22 19 33 / 0.92) !important; }
`

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// ── OKLCH ────────────────────────────────────────────────────────────────────

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function oklchOf([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map((c) => toLinear(c / 255))
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360]
}

function linearOfOklch([L, C, H]) {
  const A = C * Math.cos((H * Math.PI) / 180)
  const B = C * Math.sin((H * Math.PI) / 180)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (lin) => lin.every((c) => c >= -0.0005 && c <= 1.0005)

// Out-of-gamut colours keep their lightness and hue and give up chroma.
function rgbOfOklch([L, C, H]) {
  let lin = linearOfOklch([L, C, H])
  if (!inGamut(lin)) {
    let lo = 0, hi = C
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(linearOfOklch([L, mid, H]))) lo = mid
      else hi = mid
    }
    lin = linearOfOklch([L, lo, H])
  }
  return lin.map((c) => Math.round(clamp(toGamma(clamp(c, 0, 1)), 0, 1) * 255))
}

// ── Colour strings ───────────────────────────────────────────────────────────

const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\([^()]*\)|oklch\([^()]*\)/g

function parseColor(str) {
  if (str[0] === '#') {
    let h = str.slice(1)
    if (h.length <= 4) h = [...h].map((c) => c + c).join('')
    const n = [0, 2, 4, 6].map((i) => Number.parseInt(h.slice(i, i + 2), 16))
    return { lch: oklchOf(n.slice(0, 3)), alpha: h.length === 8 ? n[3] / 255 : 1 }
  }
  const [fn, body] = [str.slice(0, str.indexOf('(')), str.slice(str.indexOf('(') + 1, -1)]
  if (body.includes('var(') || body.includes('from ')) return null
  const [main, slash] = body.split('/')
  const parts = main.split(/[\s,]+/).filter(Boolean)
  const rawAlpha = slash ?? (parts.length === 4 ? parts[3] : null)
  const alpha = rawAlpha == null ? 1 : rawAlpha.trim().endsWith('%') ? parseFloat(rawAlpha) / 100 : parseFloat(rawAlpha)
  const num = (p, scale) => (p.endsWith('%') ? (parseFloat(p) / 100) * scale : parseFloat(p))
  if (fn === 'oklch') {
    if (parts.length < 3 || parts.some((p) => p === 'none')) return null
    return { lch: [num(parts[0], 1), num(parts[1], 0.4), parseFloat(parts[2])], alpha }
  }
  if (parts.length < 3) return null
  return { lch: oklchOf(parts.slice(0, 3).map((p) => num(p, 255))), alpha }
}

const STOCK = oklchOf([168, 85, 247])
const BAND = [245, 335]
const EDGE = 12

let mapping = null
let glass = null

// Hue offsets from the stock purple shrink so the whole scheme sits near the
// accent; chroma and lightness follow the accent in proportion to how
// accent-like the colour was. Near-greys and colours outside the band stay.
function remapLch([L, C, H]) {
  if (!mapping || C < 0.02 || H < BAND[0] || H > BAND[1]) return null
  const edge = Math.min(H - BAND[0], BAND[1] - H, EDGE) / EDGE
  const weight = edge * clamp((C - 0.02) / 0.03, 0, 1)
  const strength = clamp(C / STOCK[1], 0, 1)
  const target = [
    L + (mapping.lch[0] - STOCK[0]) * strength,
    Math.min(0.37, C * (mapping.lch[1] / STOCK[1])),
    (mapping.lch[2] + (H - STOCK[2]) * 0.4 + 360) % 360,
  ]
  const dh = ((target[2] - H + 540) % 360) - 180
  return [L + (target[0] - L) * weight, C + (target[1] - C) * weight, (H + dh * weight + 360) % 360]
}

function formatColor(lch, alpha) {
  const [r, g, b] = rgbOfOklch(lch)
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${+alpha.toFixed(3)})`
}

// Every colour in a CSS value (or a lone colour) moved onto the accent; the
// input itself when there's no appearance or nothing in it to move.
export function recolor(value) {
  if (!mapping || typeof value !== 'string') return value
  return value.replace(COLOR_RE, (match) => {
    const color = parseColor(match)
    const lch = color && remapLch(color.lch)
    return lch ? formatColor(lch, color.alpha) : match
  })
}

const listeners = new Set()

// Called now and on every appearance change, for code that paints colours itself.
export function onAppearance(fn) {
  listeners.add(fn)
  fn(current)
  return () => listeners.delete(fn)
}

// ── Stylesheet scan ──────────────────────────────────────────────────────────

function wrapperOf(rule) {
  if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) return `@media ${rule.conditionText}`
  if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) return `@supports ${rule.conditionText}`
  if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) return `@layer ${rule.name}`
  if (typeof CSSContainerRule !== 'undefined' && rule instanceof CSSContainerRule) return `@container ${rule.conditionText}`
  return null
}

// Glass written in component CSS rather than Tailwind classes: in clear and
// solid mode its surfaces go opaque and its full-screen scrims dim properly.
function glassDecls(rule) {
  if (!glass || /backdrop-blur/.test(rule.selectorText)) return []
  const style = rule.style
  const filter = style.getPropertyValue('backdrop-filter') || style.getPropertyValue('-webkit-backdrop-filter')
  if (!filter || filter === 'none') return []
  const edges = ['top', 'right', 'bottom', 'left'].map((side) => style.getPropertyValue(side))
  const scrim = style.getPropertyValue('inset') === '0px' || edges.every((v) => v === '0px') || /overlay|scrim|backdrop/i.test(rule.selectorText)
  if (scrim) return [`background-color: rgb(var(--nuc-ground) / ${glass === 'solid' ? 0.94 : 0.78}) !important`]
  return glass === 'solid' ? ['background-color: var(--nuc-solid) !important'] : []
}

function scanRules(rules, wrappers, out) {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      const decls = glassDecls(rule)
      const style = rule.style
      for (let i = 0; i < style.length && mapping; i++) {
        const name = style[i]
        const value = style.getPropertyValue(name)
        if (!value || !COLOR_RE.test(value)) continue
        COLOR_RE.lastIndex = 0
        const next = recolor(value)
        if (next !== value) decls.push(`${name}: ${next}${style.getPropertyPriority(name) ? ' !important' : ''}`)
      }
      COLOR_RE.lastIndex = 0
      if (decls.length) {
        const body = `${rule.selectorText} { ${decls.join('; ')} }`
        out.push(wrappers.reduceRight((inner, w) => `${w} { ${inner} }`, body))
      }
      continue
    }
    const wrapper = wrapperOf(rule)
    if (wrapper && rule.cssRules) scanRules(rule.cssRules, [...wrappers, wrapper], out)
  }
}

function recolorSheets() {
  const style = document.getElementById(RECOLOR_ID)
  if (!mapping && !glass) {
    style?.remove()
    return
  }
  const out = []
  for (const sheet of document.styleSheets) {
    const owner = sheet.ownerNode
    if (owner && (owner.id === RECOLOR_ID || owner.id === STYLE_ID)) continue
    let rules
    try { rules = sheet.cssRules } catch { continue }
    scanRules(rules, [], out)
  }
  const el = style ?? Object.assign(document.createElement('style'), { id: RECOLOR_ID })
  el.textContent = out.join('\n')
  if (document.head.lastElementChild !== el) document.head.append(el)
}

let scanTimer = 0
let observer = null

function watchSheets() {
  if (observer || typeof MutationObserver === 'undefined') return
  observer = new MutationObserver((records) => {
    const isOurs = (n) => n.id === RECOLOR_ID || n.parentNode?.id === RECOLOR_ID
    const ours = records.every((r) => {
      const nodes = [...r.addedNodes, ...r.removedNodes]
      return isOurs(r.target) || (nodes.length > 0 && nodes.every(isOurs))
    })
    if (ours || (!mapping && !glass)) return
    clearTimeout(scanTimer)
    scanTimer = setTimeout(recolorSheets, 30)
  })
  observer.observe(document.head, { childList: true, subtree: true, characterData: true })
  document.addEventListener('load', (e) => {
    if (e.target instanceof HTMLLinkElement && (mapping || glass)) recolorSheets()
  }, true)
}

// ── Applying ─────────────────────────────────────────────────────────────────

function rgbOfHex(hex) {
  const value = String(hex ?? '').replace('#', '')
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value
  const int = Number.parseInt(full, 16)
  return Number.isNaN(int) || full.length !== 6 ? null : [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') } catch { return null }
}

function writeCache(spec) {
  try {
    if (spec) localStorage.setItem(CACHE_KEY, JSON.stringify(spec))
    else localStorage.removeItem(CACHE_KEY)
  } catch {}
}

// A freshly imported build brings its theme even over an earlier choice;
// a choice made after the import sticks until the next one.
function isNewImport(spec) {
  try {
    if (!spec.stamp || localStorage.getItem(STAMP_KEY) === spec.stamp) return false
    localStorage.setItem(STAMP_KEY, spec.stamp)
    return true
  } catch { return false }
}

const touched = new Set()
let themeHooks = null
let current = null
// An app's own accent (#rrggbb), chosen in the app and taking precedence over the build's.
let appAccent = null

function clear() {
  const root = document.documentElement
  for (const name of touched) root.style.removeProperty(name)
  touched.clear()
  for (const key of ['nucAccent', 'nucMotion', 'nucGlass', 'nucWallpaper']) delete root.dataset[key]
}

function apply(spec, fresh) {
  clear()
  if (!spec || spec.version !== 1) spec = null
  current = spec
  const accent = appAccent ? rgbOfHex(appAccent) : spec && spec.accent !== 'nucleus' && rgbOfHex(spec.accentColor)
  const lch = accent && oklchOf(accent)
  // The stock purple itself needs no remapping.
  mapping = lch && Math.hypot(lch[0] - STOCK[0], lch[1] - STOCK[1], (lch[2] - STOCK[2]) / 100) > 0.01 ? { lch } : null
  glass = spec && (spec.glass === 'clear' || spec.glass === 'solid') ? spec.glass : null
  if (spec || mapping) ensureStyle()
  if (spec) applySpec(spec, fresh)
  if (mapping) applyGround()
  recolorSheets()
  if (mapping || glass) watchSheets()
  for (const fn of listeners) fn(current)
}

function setVar(name, value) {
  touched.add(name)
  document.documentElement.style.setProperty(name, value)
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.prepend(style)
}

// Grounds tinted toward the accent, for surfaces that paint from --nuc-ground / --nuc-solid.
function applyGround() {
  document.documentElement.dataset.nucAccent = appAccent ? 'app' : current.accent
  const hue = mapping.lch[2]
  const channels = (lch) => rgbOfOklch(lch).join(' ')
  setVar('--nuc-ground-light', channels([0.968, 0.012, hue]))
  setVar('--nuc-ground-dark', channels([0.13, 0.018, hue]))
  setVar('--nuc-solid-light', `rgb(${channels([0.995, 0.004, hue])})`)
  setVar('--nuc-solid-dark', `rgb(${channels([0.2, 0.022, hue])})`)
}

function applySpec(spec, fresh) {
  const root = document.documentElement
  const set = setVar

  if (themeHooks && ['dark', 'light', 'system'].includes(spec.theme)) {
    if (fresh && isNewImport(spec)) themeHooks.reset(spec.theme)
    else themeHooks.fallback(spec.theme)
  }

  const radius = clamp(Number(spec.radius ?? 16), 0, 26) / 16
  if (radius !== 1) for (const [name, rem] of Object.entries(RADII)) set(`--radius-${name}`, `${+(rem * radius).toFixed(3)}rem`)

  const typeScale = clamp(Number(spec.typeScale ?? 1), 0.9, 1.15)
  if (typeScale !== 1) set('font-size', `${16 * typeScale}px`)

  const motion = MOTION[spec.motion] ?? 1
  if (motion !== 1) {
    for (const [name, seconds] of Object.entries(DURATIONS)) set(name, `${(seconds * motion).toFixed(3)}s`)
    root.dataset.nucMotion = spec.motion
  }

  const transparency = clamp(Number(spec.transparency ?? STOCK_TRANSPARENCY), 0, 1)
  if (spec.glass === 'clear' || spec.glass === 'solid') {
    root.dataset.nucGlass = spec.glass
  } else if (transparency !== STOCK_TRANSPARENCY) {
    const scale = (6 + 24 * transparency) / (6 + 24 * STOCK_TRANSPARENCY)
    for (const [name, px] of Object.entries(BLURS)) set(`--blur-${name}`, `${(px * scale).toFixed(1)}px`)
  }

  if (['none', 'aurora', 'grid', 'dust'].includes(spec.wallpaper)) root.dataset.nucWallpaper = spec.wallpaper
}

let started = false

// An app that lets people pick its own accent hands it here (#rrggbb, or null to follow the build's).
// Everything is recoloured as for a build's accent: stylesheets, wallpaper, `recolor` and `onAppearance` users.
export function setAppAccent(hex) {
  const next = rgbOfHex(hex) ? hex : null
  if (next === appAccent) return
  appAccent = next
  if (typeof document !== 'undefined') apply(current, false)
}

// `theme.fallback` sets the theme only when the user hasn't picked one;
// `theme.reset` sets it regardless (a newly imported build).
export function startAppearance(options = {}) {
  if (options.theme) themeHooks = options.theme
  if (started || typeof document === 'undefined') return
  started = true
  apply(readCache(), false)
  fetch(APPEARANCE_URL, { cache: 'no-store' })
    .then((res) => (res.status === 200 ? res.json() : null))
    .then((spec) => {
      writeCache(spec)
      apply(spec, true)
    })
    .catch(() => {})
}
