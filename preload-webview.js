// preload-webview.js — runs inside Discord's own page (the <webview>)
//
// Detects mute state and username and pushes them up to discord.html via
// sendToHost, where they are forwarded to the main process.
//
// Bug fix v2.1.1 — mute detection was inverted:
//   • Previously trusted aria-pressed first. Discord appears to use
//     aria-pressed="true" to mean "the mic toggle is in the ON position"
//     (i.e. mic active, NOT muted) — the opposite of what we assumed.
//   • Now we trust the aria-LABEL first. ARIA convention says the label
//     describes the action the button will perform when clicked:
//         "Mute"   → clicking mutes  → currently UNMUTED
//         "Unmute" → clicking unmutes → currently MUTED
//     aria-pressed is only used as a last-resort tiebreaker.
//   • A diagnostic mode (window.__overlayDebug = true) prints what we're
//     reading so future selector breakage is easy to spot.

const { ipcRenderer } = require('electron')

let lastSentMute = null
let lastSentUser = null

const MUTE_LABEL_RE = /^\s*(Mute|Unmute)\s*(\([^)]*\))?\s*$/i

const USER_PANEL_SELECTORS = [
  'section[aria-label="User area" i]',
  '[class*="panels_"]',
  '[class*="panels-"]'
]

function getUserPanels() {
  const out = []
  for (const sel of USER_PANEL_SELECTORS) {
    document.querySelectorAll(sel).forEach(el => out.push(el))
  }
  return out
}

function findSelfMuteButton() {
  // First, look inside the user-area panel (most reliable scope)
  for (const p of getUserPanels()) {
    const buttons = p.querySelectorAll('button[aria-label]')
    for (const b of buttons) {
      const lbl = b.getAttribute('aria-label')
      if (lbl && MUTE_LABEL_RE.test(lbl)) return b
    }
  }
  // Fallback: very strict global search (exact "Mute"/"Unmute" only)
  for (const b of document.querySelectorAll('button[aria-label]')) {
    const lbl = b.getAttribute('aria-label')
    if (lbl && MUTE_LABEL_RE.test(lbl)) return b
  }
  return null
}

// ── Mute state detection ──────────────────────────────────────────────────────
//
// Returns true (muted), false (unmuted), or null (unknown).
//
//   PRIMARY signal: aria-label
//     "Mute"   → clicking will mute   → currently UNMUTED → false
//     "Unmute" → clicking will unmute → currently MUTED   → true
//
//   FALLBACK: aria-pressed (only if label doesn't clearly indicate state).
//     Note Discord's aria-pressed appears inverted from spec — we treat
//     aria-pressed="true" as UNMUTED (mic toggle in ON position).
function getMuteState() {
  const btn = findSelfMuteButton()
  if (!btn) return null

  const lbl = (btn.getAttribute('aria-label') || '').trim().toLowerCase()

  // Primary signal: label.
  // We split on the first word because Discord sometimes appends " (M)"
  // or " (Ctrl+Shift+M)" to indicate the keyboard shortcut.
  const firstWord = lbl.split(/[\s(]/)[0]
  if (firstWord === 'unmute') return true   // action = unmute → currently muted
  if (firstWord === 'mute')   return false  // action = mute   → currently unmuted

  // Fallback: aria-pressed.
  // Empirically Discord uses aria-pressed="true" to mean "mic on" (unmuted),
  // so we INVERT here vs. the prior version.
  if (btn.hasAttribute('aria-pressed')) {
    return btn.getAttribute('aria-pressed') !== 'true'
  }

  return null
}

function debugSnapshot() {
  const btn = findSelfMuteButton()
  if (!btn) {
    return { found: false }
  }
  const svg = btn.querySelector('svg')
  return {
    found: true,
    ariaLabel:   btn.getAttribute('aria-label'),
    ariaPressed: btn.getAttribute('aria-pressed'),
    ariaChecked: btn.getAttribute('aria-checked'),
    svgPaths:    svg ? svg.querySelectorAll('path').length : 0,
    svgLines:    svg ? svg.querySelectorAll('line').length : 0,
    computedMute: getMuteState()
  }
}
// Expose so the user can paste `window.__overlayMuteDebug()` in the panel's
// devtools to see exactly what the detector is reading.
window.__overlayMuteDebug = debugSnapshot

function sendMuteIfChanged() {
  const s = getMuteState()
  if (s !== null && s !== lastSentMute) {
    lastSentMute = s
    try { ipcRenderer.sendToHost('muteChanged', s) } catch (_) {}
    if (window.__overlayDebug) {
      try { console.log('[overlay] mute →', s, debugSnapshot()) } catch (_) {}
    }
  }
}

// ── Username detection ────────────────────────────────────────────────────────
function looksLikeUsername(text) {
  return typeof text === 'string' && /^[a-z0-9_.]{2,32}$/.test(text)
}

function getUsername() {
  try {
    for (const panel of getUserPanels()) {
      const handles = [
        '[class*="usernameInner"]',
        '[class*="panelSubtext"]',
        '[class*="discriminator"]',
        '[class*="usernameTag"]'
      ]
      for (const sel of handles) {
        const el = panel.querySelector(sel)
        if (el) {
          const text = el.textContent.trim().split('\n')[0].trim()
          if (looksLikeUsername(text)) return text
        }
      }
      const cands = Array.from(panel.querySelectorAll('[class]'))
        .map(el => (el.firstChild?.nodeType === 3
          ? el.firstChild.textContent
          : el.textContent || ''
        ).trim().split('\n')[0].trim())
        .filter(t => t.length >= 2 && t.length <= 32)

      const handle = cands.find(looksLikeUsername)
      if (handle) return handle

      const statusWords = new Set(['online', 'idle', 'dnd', 'offline', 'invisible', 'do not disturb'])
      const fallback = cands.find(t => !statusWords.has(t.toLowerCase()))
      if (fallback) return fallback
    }
  } catch (_) {}
  return null
}

function sendUsernameIfChanged() {
  const n = getUsername()
  if (n && n !== lastSentUser) {
    lastSentUser = n
    try { ipcRenderer.sendToHost('username', n) } catch (_) {}
  }
}

// ── Observer ─────────────────────────────────────────────────────────────────
const observer = new MutationObserver(() => {
  sendMuteIfChanged()
  sendUsernameIfChanged()
})

function startObserving() {
  try {
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: false,
      attributeFilter: ['aria-label', 'aria-pressed', 'aria-checked']
    })
  } catch (_) {}
  sendMuteIfChanged()
  ;[800, 1800, 3500, 6000, 10000, 16000].forEach(ms =>
    setTimeout(sendUsernameIfChanged, ms)
  )
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserving)
} else {
  startObserving()
}

setInterval(sendMuteIfChanged,     500)
setInterval(sendUsernameIfChanged, 8000)
