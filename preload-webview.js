// preload-webview.js — runs inside Discord's own page (the <webview>)
//
// Detects mute state and username and pushes them up to discord.html via
// sendToHost, where they are forwarded to the main process.
//
// Stricter selectors than the previous version:
//   • The self-mute button is matched ONLY inside a user-area / panels container
//   • aria-label must EXACTLY equal "Mute" or "Unmute" (optionally with a
//     " (M)" / " (Ctrl+Shift+M)" shortcut suffix). This rejects
//     "Mute conversation", "Mute notifications", "Mute server", "Mute role", etc.
//   • aria-pressed is preferred when present; otherwise we use the label

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
  for (const p of getUserPanels()) {
    const buttons = p.querySelectorAll('button[aria-label]')
    for (const b of buttons) {
      const lbl = b.getAttribute('aria-label')
      if (lbl && MUTE_LABEL_RE.test(lbl)) return b
    }
  }
  // Last resort: any exact-match Mute/Unmute on page (avoids the loose
  // contains() check that previously matched the wrong buttons).
  for (const b of document.querySelectorAll('button[aria-label]')) {
    const lbl = b.getAttribute('aria-label')
    if (lbl && MUTE_LABEL_RE.test(lbl)) return b
  }
  return null
}

function getMuteState() {
  const btn = findSelfMuteButton()
  if (!btn) return null

  // Prefer aria-pressed when available — Discord sets it on toggle buttons.
  if (btn.hasAttribute('aria-pressed')) {
    return btn.getAttribute('aria-pressed') === 'true'
  }
  // Otherwise infer from label: "Unmute" means currently muted.
  const lbl = btn.getAttribute('aria-label').trim().toLowerCase()
  return lbl.startsWith('unmute')
}

function sendMuteIfChanged() {
  const s = getMuteState()
  if (s !== null && s !== lastSentMute) {
    lastSentMute = s
    try { ipcRenderer.sendToHost('muteChanged', s) } catch (_) {}
  }
}

// ── Username detection ────────────────────────────────────────────────────────
// Returns the Discord USERNAME (not the display name).
function looksLikeUsername(text) {
  return typeof text === 'string' && /^[a-z0-9_.]{2,32}$/.test(text)
}

function getUsername() {
  try {
    for (const panel of getUserPanels()) {
      // Try the dedicated handle elements first
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
      // Pass 2: any short text node in the panel matching the username pattern
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

// Periodic safety polls in case the MutationObserver misses something
setInterval(sendMuteIfChanged,     500)
setInterval(sendUsernameIfChanged, 8000)
