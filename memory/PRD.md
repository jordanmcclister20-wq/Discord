# Discord Overlay — Product Requirements Document

## Original Problem Statement
> "make this way better and fix the bugs"

**Reported bugs** (from user follow-up):
1. Mute button isn't in sync with the actual mute state.
2. Clicking the middle of the bar at the top causes it to unmute.
3. When sliding out, the panel briefly shows on the top monitor (multi-monitor leak).
4. When clicking the close button, the panel briefly shows on the top monitor too.

**User-requested improvements**: "all of the above" — UI, performance, features. Themes specifically requested.

**Platform**: Electron desktop app (Windows). Acts as a Discord replacement / overlay.

## App Architecture
- **Type**: Electron desktop application (NOT React/FastAPI — this is a desktop overlay)
- **Stack**: Electron 28 + vanilla JS + HTML/CSS
- **Process model**:
  - `main.js` — Electron main process: window/IPC/hotkeys/tray/settings persistence
  - `tab.html` + `preload.js` — always-on-top tab UI (top of screen)
  - `discord.html` + `preload-discord.js` — drop-down panel hosting the Discord webview
  - `preload-webview.js` — injected into Discord, detects mute & username via DOM observation
- **Settings persistence**: `userData/overlay-settings.json`

## User Persona
A power user who wants a non-intrusive, themeable Discord that hides on top of games / other apps without taking over an entire alt-tab slot.

## Core Requirements (static)
1. A small tab sits at the top of the primary display, always on top.
2. Clicking the tab toggles a Discord panel that slides down.
3. Embedded Discord webview persists login across launches.
4. Self-mute and leave-call work from the tab without opening the panel.
5. Multi-monitor safe (no rendering bleed onto monitors above the primary).

## Implemented in v2.1.0 (2026-01)
### Bug fixes
- Rewrote slide animation to be **CSS-driven inside the renderer** instead of moving the OS window. The window now stays at its final position; only the inner `#shell` div animates `translateY(-100%) → 0`. Eliminates all multi-monitor leak issues.
- Replaced position-based `expand()`/`collapse()` with `show()`/`hide()` + IPC `panel:slideIn` / `panel:slideOut`.
- Removed the stale `muteState` re-push on every panel-open (was overwriting the real state with last-known on every center-click).
- Tightened self-mute selector: scoped to user-area panel, exact `aria-label` regex `/^(Mute|Unmute)( \([^)]*\))?$/i`. No more matches on "Mute conversation", "Mute notifications", "Server Mute", etc.
- Debounced the optimistic mute flip — single in-flight click at a time; 500ms safety poll restores real state.
- **Fixed missing preload files in package.json `build.files`** — `preload-discord.js` and `preload-webview.js` were not bundled, meaning the built `.exe` would silently fail to detect mute/username.

### New features
- 8 themes: Blurple, Midnight, Aurora, Ember, Forest, Sakura, Cyber, Mono. Switchable via right-click → swatch.
- Settings menu: theme picker, always-on-top toggle, dim-when-idle toggle, opacity slider.
- Settings persistence (JSON in userData).
- Global hotkeys: `Ctrl+Shift+D` toggle, `Ctrl+Shift+M` mute.
- System tray icon with quick toggle / quit.
- Single-instance lock.
- Larger tab (38px), Outfit font, pulsing status dot, smoother easing.
- Escape closes the panel.
- `setVisibleOnAllWorkspaces` for stronger always-on-top over fullscreen games.

## Backlog (P1 — next session)
- Custom hotkey rebinding UI (currently hard-coded `Ctrl+Shift+D` / `Ctrl+Shift+M`).
- Drag the tab horizontally to reposition (with persistence).
- Optional auto-collapse when overlay loses focus.
- Per-monitor selection (pick which display the tab/panel uses).
- Optional click-through mode (overlay ignores mouse when not hovered).

## Backlog (P2)
- Push-to-talk hotkey passthrough.
- Compact / mini mode (icon-only tab, no username).
- Per-theme audio cue (open/close click sound).
- macOS / Linux builds (currently Windows-only via electron-builder).

## v2.1.1 — Inverted-mute hotfix (2026-01)
### Bug
User reported that clicking the tab's mute button **unmuted** Discord, and clicking it to unmute **muted** Discord. Screenshot showed the tab displaying "muted" (red icon) while Discord's actual state was unmuted — the detection was reading Discord's state inversely.

### Root cause
`preload-webview.js` preferred `aria-pressed` over `aria-label` when reading Discord's self-mute button. Empirically Discord uses `aria-pressed="true"` to mean "mic toggle is in the ON position" (mic active = unmuted), which is the opposite of the ARIA spec assumption the code made.

### Fix
1. `preload-webview.js` — `getMuteState()` now trusts `aria-label` first ("Mute" → unmuted, "Unmute" → muted). `aria-pressed` is only used as a last-resort tiebreaker and is now read inverted.
2. `main.js` — added `invertMute` setting (default false); when toggled, re-emits the current mute state with the new interpretation so the tab updates instantly.
3. `tab.html` — added "Invert mute state" toggle in the right-click settings menu as an escape hatch.
4. `preload-webview.js` — added `window.__overlayMuteDebug()` and `window.__overlayDebug = true` diagnostic hooks (paste into the panel devtools to inspect what the detector is reading).
