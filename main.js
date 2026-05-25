// ─────────────────────────────────────────────────────────────────────────────
//  Discord Overlay — main process
//
//  Key design (rewritten to fix multi-monitor leaks):
//    • The discord window is ALWAYS positioned at its final on-screen position
//      (inside the primary display). We never move it off-screen.
//    • Showing/hiding is done with discordWin.show() / discordWin.hide(), so the
//      OS window can never bleed onto a monitor sitting above the primary one.
//    • The slide-down / slide-up effect is now CSS-driven inside discord.html:
//      we IPC-trigger "slideIn" / "slideOut" and the renderer animates a
//      transform on the inner panel.
// ─────────────────────────────────────────────────────────────────────────────

const {
  app, BrowserWindow, ipcMain, screen, session,
  desktopCapturer, globalShortcut, Menu, Tray
} = require('electron')
const path = require('path')
const fs   = require('fs')

// ── State ─────────────────────────────────────────────────────────────────────
let tabWin, discordWin
let discordWebContents = null   // webContents of the Discord <webview>
let isExpanded   = false
let isAnimating  = false
let lastMuteState   = false
let muteStateSynced = false
let lastUsername    = null

// ── Settings (themes, hotkeys, behaviour) ────────────────────────────────────
const SETTINGS_PATH = () =>
  path.join(app.getPath('userData'), 'overlay-settings.json')

const DEFAULT_SETTINGS = {
  theme:           'blurple',
  alwaysOnTop:     true,
  panelOpacity:    1.0,     // 0.65 – 1.0
  slideMs:         260,     // animation duration
  gameDimming:     true,    // dim tab when overlay loses focus
  hotkeyToggle:    'Control+Shift+D',
  hotkeyMute:      'Control+Shift+M',
  invertMute:      false,   // escape hatch if Discord changes selectors again
}

let settings = { ...DEFAULT_SETTINGS }

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH(), 'utf8')
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch (_) {
    settings = { ...DEFAULT_SETTINGS }
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH()), { recursive: true })
    fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(settings, null, 2))
  } catch (_) {}
}

// ── Window sizing ────────────────────────────────────────────────────────────
// 3 buttons (mute, discord, leave) + 2 dividers + small padding.
const TAB_W_BASE = 132
const TAB_H      = 38

// Username detection is still wired (for future use) but no longer affects
// the tab width — the username is no longer displayed on the tab.
function currentTabW() { return TAB_W_BASE }

function primary() { return screen.getPrimaryDisplay() }

function winSize() {
  const { bounds } = primary()
  return {
    w: Math.round(bounds.width  * 0.86),
    h: Math.round(bounds.height * 0.86)
  }
}

function tabPos(w) {
  const tw = w || currentTabW()
  const { bounds } = primary()
  return {
    x: bounds.x + Math.round((bounds.width - tw) / 2),
    y: bounds.y
  }
}

function discordX() {
  const { bounds } = primary()
  const { w } = winSize()
  return bounds.x + Math.round((bounds.width - w) / 2)
}

// The discord window LIVES at this final position. We never move it elsewhere.
// (Top edge sits just below the tab so the slide-in feels anchored to the tab.)
function discordY() {
  const { bounds, workArea } = primary()
  const { h } = winSize()
  return bounds.y + TAB_H + Math.round((workArea.height - TAB_H - h) / 2)
}

// ── Always-on-top safety ─────────────────────────────────────────────────────
function pin(win) {
  if (!win || win.isDestroyed()) return
  try {
    if (settings.alwaysOnTop) {
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    } else {
      win.setAlwaysOnTop(false)
    }
  } catch (_) {}
}

function assertAlwaysOnTop() {
  pin(tabWin)
  if (discordWin && !discordWin.isDestroyed() && discordWin.isVisible()) {
    pin(discordWin)
    try { discordWin.moveTop() } catch (_) {}
  }
}

// ── Show / hide with CSS-driven slide ────────────────────────────────────────
function expand() {
  if (isExpanded || isAnimating) return
  if (!discordWin || discordWin.isDestroyed()) return

  isAnimating = true

  // Ensure window is at its final on-screen position BEFORE showing.
  const { w, h } = winSize()
  discordWin.setBounds({ x: discordX(), y: discordY(), width: w, height: h })

  // Make sure opacity is 1 — we use CSS transforms now, not OS opacity.
  discordWin.setOpacity(1)

  // Tell the renderer to set its content OFF-SCREEN before we make the window
  // visible, so the first frame is invisible.
  if (discordWin.webContents) {
    discordWin.webContents.send('panel:prepareShow')
  }

  // Show after a microtask so the renderer's prepareShow takes effect first.
  setTimeout(() => {
    if (!discordWin || discordWin.isDestroyed()) return
    discordWin.showInactive()
    pin(discordWin)
    try { discordWin.moveTop() } catch (_) {}

    // Kick off the CSS slide-in
    setTimeout(() => {
      if (discordWin && !discordWin.isDestroyed()) {
        discordWin.webContents.send('panel:slideIn', settings.slideMs)
      }
    }, 16)

    // Mark expanded a tick later, after CSS settles
    setTimeout(() => {
      isExpanded  = true
      isAnimating = false
      if (tabWin && !tabWin.isDestroyed()) {
        tabWin.webContents.send('state', 'open')
      }
    }, settings.slideMs + 40)
  }, 16)
}

function collapse() {
  if (!isExpanded || isAnimating) return
  if (!discordWin || discordWin.isDestroyed()) return

  isAnimating = true

  // Trigger CSS slide-out
  discordWin.webContents.send('panel:slideOut', settings.slideMs)

  // After the animation ends, hide the OS window (so it can't leak anywhere)
  setTimeout(() => {
    if (discordWin && !discordWin.isDestroyed()) {
      try { discordWin.hide() } catch (_) {}
    }
    isExpanded  = false
    isAnimating = false
    if (tabWin && !tabWin.isDestroyed()) {
      tabWin.webContents.send('state', 'closed')
    }
  }, settings.slideMs + 30)
}

// ── Focus / blur (game-mode dimming) ─────────────────────────────────────────
function onAppFocus() {
  if (tabWin && !tabWin.isDestroyed()) tabWin.setOpacity(1.0)
}

function onAppBlur() {
  if (tabWin && !tabWin.isDestroyed()) {
    tabWin.setOpacity(settings.gameDimming ? 0.82 : 1.0)
  }
}

// ── Mute & leave control scripts (run inside Discord's webview) ──────────────
//
//   Strict self-mute selector:
//     • Search ONLY inside the user-area panel
//     • aria-label must exactly equal "Mute" or "Unmute"  (optional " (M)" suffix)
//   This avoids matching "Mute conversation", "Mute notifications", "Mute role",
//   "Server Mute", "Stage Mute", etc.
const CLICK_MUTE_JS = `
  (() => {
    const re = /^\\s*(Mute|Unmute)\\s*(\\([^)]*\\))?\\s*$/i
    const panels = document.querySelectorAll(
      'section[aria-label="User area" i], [class*="panels_"], [class*="panels-"]'
    )
    let btn = null
    for (const p of panels) {
      for (const b of p.querySelectorAll('button[aria-label]')) {
        if (re.test(b.getAttribute('aria-label'))) { btn = b; break }
      }
      if (btn) break
    }
    if (!btn) {
      // Fallback: very strict global search if no panel was found
      for (const b of document.querySelectorAll('button[aria-label]')) {
        if (re.test(b.getAttribute('aria-label'))) { btn = b; break }
      }
    }
    if (!btn) return false
    btn.click()
    return true
  })()
`

const LEAVE_CALL_JS = `
  (() => {
    const btn = Array.from(document.querySelectorAll('button[aria-label]')).find(b => {
      const l = b.getAttribute('aria-label').toLowerCase()
      return l.includes('disconnect') || l.includes('leave call') || l.includes('leave voice')
    })
    if (btn) { btn.click(); return true }
    return false
  })()
`

// ── IPC ──────────────────────────────────────────────────────────────────────
ipcMain.on('toggle',    () => isExpanded ? collapse() : expand())
ipcMain.on('expand',    () => !isExpanded && expand())
ipcMain.on('collapse',  () => isExpanded && collapse())
ipcMain.on('quit',      () => app.quit())

ipcMain.on('mute', () => {
  if (!discordWebContents || discordWebContents.isDestroyed()) return
  discordWebContents.executeJavaScript(CLICK_MUTE_JS).catch(() => {})
})

ipcMain.on('leaveCall', () => {
  if (!discordWebContents || discordWebContents.isDestroyed()) return
  discordWebContents.executeJavaScript(LEAVE_CALL_JS).catch(() => {})
})

// Mute state pushed up from preload-webview.js
ipcMain.on('muteChanged', (_e, isMuted) => {
  const m = !!isMuted
  lastMuteState   = settings.invertMute ? !m : m
  muteStateSynced = true
  if (tabWin && !tabWin.isDestroyed()) {
    tabWin.webContents.send('muteState', lastMuteState)
  }
})

// Username (still tracked but no longer resizes the tab)
ipcMain.on('setUsername', (_e, name) => {
  if (!name || typeof name !== 'string' || name === lastUsername) return
  lastUsername = name
  if (tabWin && !tabWin.isDestroyed()) {
    tabWin.webContents.send('username', name)
  }
})

// Theme & settings
ipcMain.handle('settings:get', () => settings)

ipcMain.on('settings:update', (_e, patch) => {
  const prevInvert = settings.invertMute
  settings = { ...settings, ...patch }
  saveSettings()
  // Broadcast to both renderers
  if (tabWin && !tabWin.isDestroyed()) {
    tabWin.webContents.send('settings:changed', settings)
  }
  if (discordWin && !discordWin.isDestroyed()) {
    discordWin.webContents.send('settings:changed', settings)
  }
  // If invertMute changed, re-apply current mute reading with new interpretation
  if (muteStateSynced && prevInvert !== settings.invertMute) {
    lastMuteState = !lastMuteState
    if (tabWin && !tabWin.isDestroyed()) {
      tabWin.webContents.send('muteState', lastMuteState)
    }
  }
  // Re-pin if alwaysOnTop changed
  pin(tabWin)
  pin(discordWin)
  // Re-register hotkeys
  registerHotkeys()
})

// ── Window creation ──────────────────────────────────────────────────────────
const ICON = path.join(__dirname, 'assets', 'icon.ico')

function createWindows() {
  const tp = tabPos()
  const { w, h } = winSize()

  // ── Tab ────────────────────────────────────────────────────────────────────
  tabWin = new BrowserWindow({
    width: TAB_W_BASE, height: TAB_H,
    x: tp.x, y: tp.y,
    frame: false, transparent: true,
    icon: ICON,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, hasShadow: false,
    movable: false, focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true,
      backgroundThrottling: false
    }
  })
  pin(tabWin)
  tabWin.loadFile('tab.html')

  tabWin.webContents.on('did-finish-load', () => {
    tabWin.webContents.send('settings:changed', settings)
    if (muteStateSynced) tabWin.webContents.send('muteState', lastMuteState)
    if (lastUsername)    tabWin.webContents.send('username',  lastUsername)
  })

  tabWin.on('blur',  onAppBlur)
  tabWin.on('focus', onAppFocus)

  // ── Screen-share permissions ───────────────────────────────────────────────
  const discordSession = session.fromPartition('persist:discord')
  discordSession.setPermissionRequestHandler((_wc, permission, cb) => {
    const allowed = ['media', 'display-capture', 'mediaKeySystem', 'geolocation', 'notifications']
    cb(allowed.includes(permission))
  })
  discordSession.setDisplayMediaRequestHandler((_request, cb) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then(sources => cb({ video: sources[0], audio: 'loopback' }))
      .catch(() => cb({}))
  })

  // ── Discord panel ──────────────────────────────────────────────────────────
  discordWin = new BrowserWindow({
    width: w, height: h,
    x: discordX(), y: discordY(),
    frame: false, transparent: true,
    icon: ICON,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, hasShadow: false,
    movable: false, show: false,
    webPreferences: {
      webviewTag: true,
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload-discord.js'),
      backgroundThrottling: false
    }
  })
  pin(discordWin)
  discordWin.setSkipTaskbar(true)

  // Inject preload-webview.js into the <webview> before navigation
  discordWin.webContents.on('will-attach-webview', (_e, webPreferences) => {
    webPreferences.preload         = path.join(__dirname, 'preload-webview.js')
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = false  // required for sendToHost
  })

  discordWin.webContents.on('did-attach-webview', (_e, wc) => {
    discordWebContents = wc
  })

  discordWin.webContents.on('did-finish-load', () => {
    discordWin.webContents.send('settings:changed', settings)
  })

  discordWin.on('blur',  onAppBlur)
  discordWin.on('focus', onAppFocus)

  discordWin.loadFile('discord.html')

  setInterval(assertAlwaysOnTop, 1500)

  screen.on('display-added',           repin)
  screen.on('display-removed',         repin)
  screen.on('display-metrics-changed', repin)
}

function repin() {
  const tp = tabPos()
  const { w, h } = winSize()
  if (tabWin && !tabWin.isDestroyed()) tabWin.setPosition(tp.x, tp.y)
  if (discordWin && !discordWin.isDestroyed()) {
    discordWin.setBounds({ x: discordX(), y: discordY(), width: w, height: h })
  }
}

// ── Global hotkeys ───────────────────────────────────────────────────────────
function registerHotkeys() {
  try { globalShortcut.unregisterAll() } catch (_) {}
  try {
    if (settings.hotkeyToggle) {
      globalShortcut.register(settings.hotkeyToggle, () => {
        isExpanded ? collapse() : expand()
      })
    }
    if (settings.hotkeyMute) {
      globalShortcut.register(settings.hotkeyMute, () => {
        if (discordWebContents && !discordWebContents.isDestroyed()) {
          discordWebContents.executeJavaScript(CLICK_MUTE_JS).catch(() => {})
        }
      })
    }
  } catch (_) {}
}

// ── Tray (single quit option, so the user can always close) ──────────────────
let tray = null
function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'assets', 'icon.ico'))
    tray.setToolTip('Discord Overlay')
    const menu = Menu.buildFromTemplate([
      { label: 'Toggle Overlay', click: () => isExpanded ? collapse() : expand() },
      { label: 'Quit',           click: () => app.quit() }
    ])
    tray.setContextMenu(menu)
    tray.on('click', () => isExpanded ? collapse() : expand())
  } catch (_) {
    // Tray is optional — silently ignore if icon missing on non-Win platforms
  }
}

// ── Single-instance lock ─────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (tabWin && !tabWin.isDestroyed()) {
      tabWin.show()
      tabWin.focus()
    }
  })
}

app.setAppUserModelId('com.discord.overlay')

app.whenReady().then(() => {
  loadSettings()
  createWindows()
  createTray()
  registerHotkeys()
})

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll() } catch (_) {}
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
