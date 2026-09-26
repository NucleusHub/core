const PALETTE = ['#6366f1', '#a78bfa', '#34d399', '#fbbf24', '#f472b6']

function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

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
    p.vy += p.gravity
    p.vx *= 0.99
    p.vy *= 0.99
    p.x += p.vx + Math.sin(p.t * 0.1 + p.seed) * p.sway
    p.y += p.vy
    p.t += 1
    p.spin += p.spinRate
    if (p.vy > 0) p.life -= p.decay

    if (p.life > 0 && p.y < h + 40) {
      ctx.save()
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life))
      ctx.translate(p.x, p.y)
      ctx.rotate(p.spin)
      ctx.fillStyle = p.color
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

export function celebrate() {
  if (prefersReducedMotion()) return
  burst({ origin: { x: 0.15, y: 0.85 }, particleCount: 60, spread: 55, startVelocity: 46 })
  burst({ origin: { x: 0.85, y: 0.85 }, particleCount: 60, spread: 55, startVelocity: 46 })
  setTimeout(() => burst({ origin: { x: 0.5, y: 0.55 }, particleCount: 90, spread: 110, startVelocity: 40 }), 140)
}
