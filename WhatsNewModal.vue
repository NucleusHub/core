<script setup>
// The "What's New" changelog modal. Mounted once in AuthGuard (authenticated
// branch). Aggregates every published announcement into per-app tabs, grouped by
// version (newest first). Auto-opens on login when something was published since
// the viewer last dismissed it (profile.whatsNew.lastSeenAt); can also be opened
// manually from the sidebar launcher via useWhatsNew(). See the backend at
// core/auth-server/routes/whatsNew.js.
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from './useI18n.js'
import { useAuth } from './auth/useAuth.js'
import { useRegistry } from './useRegistry.js'
import { useWhatsNew } from './useWhatsNew.js'
import AppIcon from './AppIcon.vue'

const { t, locale } = useI18n()
const { profile, authFetch } = useAuth()
const { apps } = useRegistry()
const { isOpen, open, close } = useWhatsNew()

const announcements = ref([])
const defaultLang = ref('en-US')
const loaded = ref(false)
const optOutChecked = ref(false)

// Resolve a { lang: text } map to the viewer's locale, then the feed's default
// language, then any value — same strategy as MaintenanceBanner.vue.
function pick(field) {
  if (field == null) return ''
  if (typeof field === 'string') return field
  if (typeof field !== 'object') return String(field)
  return field[locale.value] ?? field[defaultLang.value] ?? Object.values(field)[0] ?? ''
}

const latestPublishedAt = computed(() => announcements.value[0]?.publishedAt || null)
// The whole-Nucleus version of the newest published release, shown on top.
const latestNucleusVersion = computed(() => announcements.value[0]?.version || '')

// Auto-open once the feed and profile are both known: unless opted out, open when
// an announcement was published more recently than the viewer last dismissed it
// (a never-seen profile with lastSeenAt=null still opens — but new profiles are
// seeded to "now" server-side, so they start caught up).
function maybeAutoOpen() {
  const wn = profile.value?.whatsNew || {}
  optOutChecked.value = !!wn.optOut
  if (wn.optOut) return
  const latest = latestPublishedAt.value
  if (!latest) return
  if (!wn.lastSeenAt || new Date(latest) > new Date(wn.lastSeenAt)) open()
}

async function load() {
  try {
    const res = await authFetch('/api/auth/whats-new/feed')
    if (!res.ok) return
    const data = await res.json()
    announcements.value = data.announcements || []
    defaultLang.value = data.defaultLanguage || 'en-US'
  } catch {
    // Silent: a failed feed simply means no modal.
  } finally {
    loaded.value = true
    maybeAutoOpen()
  }
}

onMounted(load)

// ── Tabs (one per app that has entries, plus 'platform') ───────────────────────

// Distinct app ids across all announcements, ordered: platform first, then in
// registry order, then any leftover (e.g. an app since removed).
const tabs = computed(() => {
  const ids = new Set()
  for (const a of announcements.value)
    for (const e of a.entries || [])
      if ((e.features || []).length) ids.add(e.app)

  const order = ['platform', ...apps.value.map(a => a.id)]
  const sorted = [...ids].sort((x, y) => {
    const ix = order.indexOf(x), iy = order.indexOf(y)
    return (ix === -1 ? 999 : ix) - (iy === -1 ? 999 : iy)
  })

  return sorted.map(id => {
    if (id === 'platform') return { id, name: t('core.whatsNew.platformTab'), iconSvg: null }
    const app = apps.value.find(a => a.id === id)
    return { id, name: app?.name || id, iconSvg: app?.iconSvg || null }
  })
})

const activeTab = ref(null)
watch(tabs, (list) => {
  if (!list.some(tb => tb.id === activeTab.value)) activeTab.value = list[0]?.id || null
}, { immediate: true })

// For the active tab: each announcement that carries an entry for this app,
// newest first, as { version, publishedAt, features }.
const activeGroups = computed(() => {
  if (!activeTab.value) return []
  const out = []
  for (const a of announcements.value) {
    const entry = (a.entries || []).find(e => e.app === activeTab.value)
    if (entry && (entry.features || []).length)
      out.push({ version: entry.version || a.version, publishedAt: a.publishedAt, features: entry.features })
  }
  return out
})

function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' }) }
  catch { return '' }
}

// ── Dismiss ────────────────────────────────────────────────────────────────────

async function dismiss() {
  close()
  try {
    await authFetch('/api/auth/whats-new/seen', { method: 'POST' })
    // Always send the checkbox state so it can both opt out and re-enable.
    await authFetch('/api/auth/whats-new/opt-out', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ optOut: optOutChecked.value }),
    })
  } catch { /* best effort */ }
}

function onKeydown(e) { if (e.key === 'Escape' && isOpen.value) dismiss() }
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="wn-fade">
      <div v-if="isOpen" class="wn-overlay" @click.self="dismiss">
        <div class="wn-panel" role="dialog" aria-modal="true">
          <!-- Header -->
          <div class="wn-header">
            <div class="wn-spark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3l1.9 4.8L18.7 9.7 13.9 11.6 12 16.4 10.1 11.6 5.3 9.7 10.1 7.8z" />
                <path d="M19 15l.7 1.8L21.5 17.5 19.7 18.2 19 20l-.7-1.8L16.5 17.5 18.3 16.8z" />
              </svg>
            </div>
            <div class="min-w-0">
              <div class="wn-title-row">
                <h2 class="wn-title">{{ t('core.whatsNew.heading') }}</h2>
                <span v-if="latestNucleusVersion" class="wn-nucleus-badge">Nucleus {{ latestNucleusVersion }}</span>
              </div>
              <p class="wn-sub">{{ t('core.whatsNew.subheading') }}</p>
            </div>
            <button class="wn-x" @click="dismiss" :aria-label="t('core.whatsNew.close')">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Tabs — always shown (even for a single app) so each update is
               visually tied to the app it belongs to. -->
          <div v-if="tabs.length" class="wn-tabs">
            <button
              v-for="tb in tabs" :key="tb.id"
              class="wn-tab" :class="{ 'wn-tab-active': tb.id === activeTab }"
              @click="activeTab = tb.id"
            >
              <span v-if="tb.id === 'platform'" class="wn-tab-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3l1.9 4.8L18.7 9.7 13.9 11.6 12 16.4 10.1 11.6 5.3 9.7 10.1 7.8z" />
                </svg>
              </span>
              <AppIcon v-else :svg="tb.iconSvg" class="wn-tab-icon" />
              {{ tb.name }}
            </button>
          </div>

          <!-- Body -->
          <div class="wn-body">
            <p v-if="loaded && !activeGroups.length" class="wn-empty">{{ t('core.whatsNew.emptyState') }}</p>

            <div v-for="(g, gi) in activeGroups" :key="g.version" class="wn-group" :class="{ 'wn-group-latest': gi === 0 }">
              <div class="wn-version-row">
                <span class="wn-version">{{ g.version }}</span>
                <span v-if="gi === 0" class="wn-latest-badge">{{ t('core.whatsNew.latestBadge') }}</span>
                <span v-if="g.publishedAt" class="wn-date">{{ fmtDate(g.publishedAt) }}</span>
              </div>
              <ul class="wn-features">
                <li v-for="(f, i) in g.features" :key="i" class="wn-feature">
                  <span v-if="f.icon" class="wn-feature-icon" aria-hidden="true">{{ f.icon }}</span>
                  <div class="min-w-0">
                    <p class="wn-feature-title">{{ pick(f.title) }}</p>
                    <p v-if="pick(f.body)" class="wn-feature-body">{{ pick(f.body) }}</p>
                  </div>
                </li>
              </ul>
            </div>
          </div>

          <!-- Footer -->
          <div class="wn-footer">
            <label class="wn-optout">
              <input type="checkbox" v-model="optOutChecked" />
              {{ t('core.whatsNew.dontShowAgain') }}
            </label>
            <button class="wn-close-btn" @click="dismiss">{{ t('core.whatsNew.close') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.wn-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147482000; /* above app UI, below the maintenance banner */
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(15, 23, 42, 0.5);
  backdrop-filter: blur(6px);
}

.wn-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 32rem;
  max-height: min(85vh, 44rem);
  border-radius: 1.25rem;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 24px 60px -12px rgba(30, 41, 59, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.25) inset;
  backdrop-filter: blur(20px) saturate(1.3);
  color: #0f172a;
}

.wn-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1.1rem 1.25rem 0.9rem;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}
.wn-spark {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.75rem;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
}
.wn-title-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.wn-title { font-weight: 700; font-size: 1.02rem; line-height: 1.2; }
.wn-nucleus-badge {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  padding: 0.1rem 0.45rem;
  border-radius: 0.4rem;
}
.wn-sub { font-size: 0.8rem; opacity: 0.6; margin-top: 1px; }
.wn-x {
  margin-left: auto;
  flex: none;
  padding: 0.35rem;
  border-radius: 0.6rem;
  color: rgba(15, 23, 42, 0.45);
  cursor: pointer;
  transition: background 0.13s, color 0.13s;
}
.wn-x:hover { background: rgba(15, 23, 42, 0.06); color: #0f172a; }

/* Underline tabs — mirrors the Admin Console nav tab bar. */
.wn-tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0 1rem;
  overflow-x: auto;
  border-bottom: 1px solid rgba(15, 23, 42, 0.1);
}
.wn-tab {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.65rem 0.55rem;
  margin-bottom: -1px;
  border-bottom: 2px solid transparent;
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
  color: rgba(15, 23, 42, 0.55);
  cursor: pointer;
  transition: color 0.13s, border-color 0.13s;
}
.wn-tab:hover { color: #1e293b; }
.wn-tab-active { color: #4f46e5; border-bottom-color: #6366f1; }
.wn-tab-icon { width: 1rem; height: 1rem; flex: none; }

.wn-body {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.25rem 0.5rem;
}
.wn-empty { text-align: center; font-size: 0.9rem; opacity: 0.55; padding: 2.5rem 0; }

.wn-group { margin-bottom: 1.25rem; }
/* The newest update for the active app tab gets a highlighted card. */
.wn-group-latest {
  position: relative;
  margin: 0 -0.75rem 1.25rem;
  padding: 0.85rem 0.9rem 0.95rem;
  border-radius: 0.85rem;
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.09), rgba(139, 92, 246, 0.06));
  border: 1px solid rgba(99, 102, 241, 0.22);
  box-shadow: 0 1px 3px rgba(99, 102, 241, 0.12);
}
.wn-version-row { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.6rem; }
.wn-latest-badge {
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #fff;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  padding: 0.12rem 0.45rem;
  border-radius: 0.4rem;
}
.wn-version {
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #4f46e5;
  background: rgba(99, 102, 241, 0.12);
  padding: 0.15rem 0.5rem;
  border-radius: 0.4rem;
}
.wn-date { font-size: 0.72rem; opacity: 0.5; }

.wn-features { display: flex; flex-direction: column; gap: 0.7rem; }
.wn-feature { display: flex; gap: 0.7rem; align-items: flex-start; }
.wn-feature-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 0.55rem;
  font-size: 1rem;
  background: rgba(15, 23, 42, 0.05);
}
.wn-feature-title { font-weight: 600; font-size: 0.9rem; line-height: 1.3; }
.wn-feature-body { font-size: 0.82rem; opacity: 0.7; line-height: 1.4; margin-top: 1px; }

.wn-footer {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1.25rem;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
}
.wn-optout {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.8rem;
  opacity: 0.7;
  cursor: pointer;
}
.wn-optout input { cursor: pointer; accent-color: #6366f1; }
.wn-close-btn {
  margin-left: auto;
  padding: 0.5rem 1.1rem;
  border-radius: 0.7rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: #fff;
  background: #4f46e5;
  cursor: pointer;
  transition: background 0.13s;
}
.wn-close-btn:hover { background: #4338ca; }

/* Dark theme */
.dark .wn-panel {
  background: rgba(15, 23, 42, 0.9);
  border-color: rgba(255, 255, 255, 0.1);
  color: #f1f5f9;
  box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
}
.dark .wn-header,
.dark .wn-tabs,
.dark .wn-footer { border-color: rgba(255, 255, 255, 0.1); }
.dark .wn-sub,
.dark .wn-date,
.dark .wn-empty,
.dark .wn-feature-body,
.dark .wn-optout { opacity: 0.6; }
.dark .wn-x { color: rgba(255, 255, 255, 0.5); }
.dark .wn-x:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
.dark .wn-tabs { border-bottom-color: rgba(255, 255, 255, 0.1); }
.dark .wn-tab { color: rgba(255, 255, 255, 0.55); }
.dark .wn-tab:hover { color: #fff; }
.dark .wn-tab-active { color: #a5b4fc; border-bottom-color: #818cf8; }
.dark .wn-version { color: #a5b4fc; background: rgba(99, 102, 241, 0.2); }
.dark .wn-group-latest {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.18), rgba(139, 92, 246, 0.12));
  border-color: rgba(129, 140, 248, 0.35);
  box-shadow: none;
}
.dark .wn-feature-icon { background: rgba(255, 255, 255, 0.08); }

.wn-fade-enter-active, .wn-fade-leave-active { transition: opacity 0.2s ease; }
.wn-fade-enter-active .wn-panel, .wn-fade-leave-active .wn-panel { transition: transform 0.2s ease, opacity 0.2s ease; }
.wn-fade-enter-from, .wn-fade-leave-to { opacity: 0; }
.wn-fade-enter-from .wn-panel, .wn-fade-leave-to .wn-panel { transform: translateY(12px) scale(0.98); opacity: 0; }
</style>
