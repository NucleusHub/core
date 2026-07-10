/* ─────────────────────────────────────────────────────────────────────────────
   Nucleus confetti — a tiny, dependency-free celebration primitive.

   Some app clients ship `canvas-confetti`, most don't (the hub, for one). Rather
   than make every bundle carry that dependency, core provides one small canvas
   engine so any app can celebrate through the same import:

       import { burst, celebrate } from '@core/confetti.js'
       celebrate()                       // full-screen party popper
       burst({ origin: { x: 0.5, y: 0.4 } })   // one shot from a point

   Palette and feel match apps/watchlist/client's ItemCard confetti so a Nucleus
   celebration reads the same everywhere. Honors prefers-reduced-motion: when the
   user asks for less motion, every call is a quiet no-op.
   ───────────────────────────────────────────────────────────────────────────── */

// Indigo · violet · emerald · amber · pink — the shared Nucleus confetti palette.
const PALETTE = ['#6366f1', '#a78bfa', '#34d399', '#fbbf24', '#f472b6']

function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

// One shared canvas for every in-flight particle, lazily created and torn down
// when the last piece settles — so an idle page carries no extra DOM.
let canvas = null
let ctx = null
let particles = []
let raf = 0

function ensureCanvas() {
  if (canvas) return
  canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    // Above essentially everything, including teleported modals and the orbit
    // nodes (z-100) on the hub. Confetti should never be occluded.
    zIndex: '2147483646',
  })
  document.body.appendChild(canvas)
  ctx = canvas.getContext('2d')
  resize()
  window.addEventListener('resize', resize)
}

function resize() {
  if (!canvas) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.floor(window.innerWidth * dpr)
  canvas.height = Math.floor(window.innerHeight * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function teardown() {
  window.removeEventListener('resize', resize)
  canvas?.remove()
  canvas = null
  ctx = null
  particles = []
  raf = 0
}

function tick() {
  const w = window.innerWidth
  const h = window.innerHeight
  ctx.clearRect(0, 0, w, h)

  for (const p of particles) {
    // Integrate: gravity pulls down, drag bleeds off velocity, a little sway
    // makes the fall feel like paper rather than pellets.
    p.vy += p.gravity
    p.vx *= 0.99
    p.vy *= 0.99
    p.x += p.vx + Math.sin(p.t * 0.1 + p.seed) * p.sway
    p.y += p.vy
    p.t += 1
    p.spin += p.spinRate
    // Fade only once past the apex and heading down, so the burst stays crisp.
    if (p.vy > 0) p.life -= p.decay

    if (p.life > 0 && p.y < h + 40) {
      ctx.save()
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life))
      ctx.translate(p.x, p.y)
      ctx.rotate(p.spin)
      ctx.fillStyle = p.color
      // Thin rectangles read as tumbling confetti; the y-scale by cos(spin)
      // gives a cheap 3D flutter.
      ctx.fillRect(-p.size / 2, (-p.size / 2) * Math.cos(p.spin), p.size, p.size * 0.5)
      ctx.restore()
    }
  }

  particles = particles.filter(p => p.life > 0 && p.y < h + 40)

  if (particles.length) {
    raf = requestAnimationFrame(tick)
  } else {
    teardown()
  }
}

/**
 * Fire a single confetti burst.
 * @param {object} [opts]
 * @param {{x:number,y:number}} [opts.origin] Normalized 0–1 launch point (default centre-ish).
 * @param {number} [opts.particleCount] Pieces to launch (default 80).
 * @param {number} [opts.spread]        Cone width in degrees (default 70).
 * @param {number} [opts.startVelocity] Initial speed (default 34).
 * @param {number} [opts.gravity]       Downward accel (default 0.42).
 * @param {number} [opts.scalar]        Piece-size multiplier (default 1).
 * @param {string[]} [opts.colors]      Palette override.
 */
export function burst(opts = {}) {
  if (prefersReducedMotion() || typeof document === 'undefined') return

  const {
    origin = { x: 0.5, y: 0.45 },
    particleCount = 80,
    spread = 70,
    startVelocity = 34,
    gravity = 0.42,
    scalar = 1,
    colors = PALETTE,
  } = opts

  ensureCanvas()

  const ox = origin.x * window.innerWidth
  const oy = origin.y * window.innerHeight
  // Launch upward (−90°) within the spread cone.
  const base = -Math.PI / 2
  const half = (spread * Math.PI) / 180 / 2

  for (let i = 0; i < particleCount; i++) {
    const angle = base + (Math.random() * 2 - 1) * half
    const speed = startVelocity * (0.55 + Math.random() * 0.65)
    particles.push({
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gravity,
      sway: 0.3 + Math.random() * 0.7,
      size: (5 + Math.random() * 6) * scalar,
      color: colors[(Math.random() * colors.length) | 0],
      spin: Math.random() * Math.PI * 2,
      spinRate: (Math.random() - 0.5) * 0.35,
      life: 1,
      decay: 0.006 + Math.random() * 0.006,
      seed: Math.random() * Math.PI * 2,
      t: 0,
    })
  }

  if (!raf) raf = requestAnimationFrame(tick)
}

/**
 * A full-screen "party popper": two angled cannons from the lower corners plus a
 * centre fountain, staggered for a fuller, more premium feel. This is the
 * one-liner most callers want.
 */
export function celebrate() {
  if (prefersReducedMotion()) return
  burst({ origin: { x: 0.15, y: 0.85 }, particleCount: 60, spread: 55, startVelocity: 46 })
  burst({ origin: { x: 0.85, y: 0.85 }, particleCount: 60, spread: 55, startVelocity: 46 })
  setTimeout(() => burst({ origin: { x: 0.5, y: 0.55 }, particleCount: 90, spread: 110, startVelocity: 40 }), 140)
}
