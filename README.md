# Discord Overlay v2.2.1

A premium drop-down Discord desktop overlay built with Electron — sits in a small tab at the top of your screen and slides Discord in/out on demand.

## What's new in v2.2.1

### Premium Visual Enhancements
- **Glassmorphism design**: Both tab and panel feature translucent backgrounds with backdrop blur, subtle reflections, and layered shadows
- **Animated gradient borders**: Live gradient animations on the panel frame that shift colors smoothly
- **Shimmer effects**: Top-edge shimmer lines that animate on both tab and panel
- **Enhanced hover states**: Buttons lift slightly on hover with smoother transitions

### Micro-Interactions
- **Ripple effect**: Click ripple animation on all action buttons (mute, leave)
- **Icon animations**: Discord icon rotates and scales on hover with glow effect
- **Mic pulse**: Active mic icon has a subtle breathing animation
- **Divider animations**: Dividers grow taller and brighter on tab hover
- **Button press**: Enhanced press animations with scale transforms

### Improved Transitions
- **Elastic slide-in**: Panel slides in with an elastic bounce effect (cubic-bezier with overshoot)
- **Smooth fade**: Opacity fades timed independently for fluid movement
- **Enhanced loading**: Larger loader ring with smoother conic gradient animation
- **Error states**: Connection failures show a shake animation and clearer error styling

### Accessibility
- **Focus states**: Clear focus outlines on all interactive elements
- **Keyboard navigation**: Proper focus-visible states with enhanced visibility
- **Tooltips**: Smooth tooltip animations with 0.4s delay, fade-in, and backdrop blur
- **Better contrast**: Improved text color contrast across all 8 themes

### Loader Improvements
- Larger loader ring (80px)
- Enhanced conic gradient with 3-color transition
- Pulsing logo with shadow expansion
- Bouncing text animation

## What's new in 2.1.0

### Bug fixes
- **Multi-monitor leak fixed.** The panel no longer flashes onto a monitor positioned above the primary display when sliding in or out. The OS window now stays put — the slide animation is CSS-driven inside the window.
- **Mute button sync rewritten.** The self-mute selector is now scoped to Discord's user-area panel and matches the `aria-label` exactly (`Mute` / `Unmute` with optional shortcut suffix), so it no longer picks up `Mute conversation`, `Mute notifications`, `Server Mute`, etc. The stale "muteState" push on every panel-open has been removed — clicking the center button can no longer flip the mute UI.
- **Optimistic mute flip is debounced.** The UI flips immediately, but only if no other click is already in flight; the 500ms safety poll restores the real state if the click missed.
- **Critical packaging bug fixed.** `preload-discord.js` and `preload-webview.js` were missing from `package.json`'s `files` array, meaning the built `.exe` would silently fail to inject the mute/username detector. Now bundled correctly.

### New features
- **8 themes**: Blurple (default), Midnight, Aurora, Ember, Forest, Sakura, Cyber, Mono. Right-click the tab → pick a swatch.
- **Settings menu**: theme picker, "Always on top" toggle, "Dim when idle" toggle, opacity slider — all persist to `userData/overlay-settings.json`.
- **Global hotkeys**: `Ctrl+Shift+D` toggles the overlay, `Ctrl+Shift+M` toggles mute.
- **System tray icon** with quick toggle + quit (so you can always close it even if the tab gets stuck).
- **Single-instance lock** — running the app twice focuses the existing instance instead of spawning a duplicate.
- **Cleaner UI**: bigger tab (38 px), Outfit font, theme-aware borders, pulsing status dot, smoother slide easing.

## How it works

- A small **tab** sits at the top-center of your primary display, always on top.
- **Click the Discord button** in the tab → Discord panel slides down and centers on the screen.
- **Click again (or press Esc)** → Discord slides back up and hides.
- Discord session is persisted between launches (uses `partition="persist:discord"` on the embedded webview).

## Setup

### Requirements
- [Node.js](https://nodejs.org) v18 or newer.

### Install & run

```bash
yarn install      # (or: npm install)
yarn start        # (or: npm start)
```

### Build a Windows installer

```bash
yarn dist         # produces dist\win-unpacked\
build.bat         # also compiles the Inno Setup installer (requires Inno Setup 6)
```

The installer lands in `dist\installer\DiscordOverlay-Setup-2.2.1.exe`.

## Files

| File                  | Purpose |
|-----------------------|---------|
| `main.js`             | Electron main process — windows, IPC, slide control, hotkeys, tray |
| `tab.html`            | The always-on-top tab with mute / discord / leave / settings menu |
| `discord.html`        | The drop-down panel that hosts the Discord webview |
| `preload.js`          | Renderer bridge for the tab |
| `preload-discord.js`  | Renderer bridge for the panel host page |
| `preload-webview.js`  | Injected into Discord — detects mute / username, sends to host |
| `installer.iss`       | Inno Setup script for the Windows installer |
| `build.bat`           | One-shot build script (yarn install → electron-builder → Inno Setup) |

## Hotkeys

| Shortcut          | Action               |
|-------------------|----------------------|
| `Ctrl+Shift+D`    | Toggle overlay       |
| `Ctrl+Shift+M`    | Toggle Discord mute  |
| `Esc`             | Close the panel      |
| `Right-click tab` | Open settings menu   |

## Themes

Right-click the tab → **Theme** section → click any of the 8 color swatches. Both the tab and the panel border/accents update instantly and the choice is saved.

## Customisation

Most behaviour now lives in the settings menu, but if you want to change defaults edit the `DEFAULT_SETTINGS` object at the top of `main.js`.

## Notes

- The overlay stays **always on top** of games and other apps (uses Electron's `screen-saver` level + `visibleOnFullScreen`).
- Screen-share / video / mic permissions are auto-granted for the Discord webview.
- On a multi-monitor setup the panel renders strictly within the primary display's bounds — it can no longer paint on monitors above the primary one.
